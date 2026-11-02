import { recordHistoryLatency } from '@/support/diagnostics/historyLatency';
import { recordOutboundResend } from '@/stores/outboundResendStore';
import { getUnifiedEngineService } from '@/platform/engine';
import { p2pDeliveryStateFromResend } from '@/features/transfer';
/**
 * useShareSendController — 分享弹层状态机与发送逻辑(§8.2/§8.5/§8.6,双端共用)
 *
 * `active` 由弹层可见性驱动:false → 会话结束(重置守卫);true → 新会话,
 * 重置状态并重新认领队列(组件常驻挂载,不能依赖 mount 触发)。
 *
 * 状态机:
 *   claiming → ready(展示与选择)→ sending(job 逐个串行)→ done(全部结束)
 *            ↘ error(认领失败,空态可重试)
 *
 * 生命周期语义:
 *   - 取消 / 完成:两端都会在创建待发送记录前写入主页历史,未发送 job 直接
 *     completeJob 出队,保证每次分享页都是崭新的一次分享;
 *   - 删除:二次确认后 completeJob(记录 + payload 一并清除,不可恢复);
 *   - 发送成功:completeJob;
 *   - 认领时的陈旧清理:超过处理租约(15 分钟)的 job 只可能是中断会话的残留
 *     (两端内容均已在主页历史),认领后立即出队。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { File } from 'expo-file-system';
import { recordShareDiagnosticStage } from 'app-group-store';
import { getOutboundShareHandoffManager } from '@/features/transfer';
import { createPendingShareStore, type PendingShareJob } from '@/features/transfer';
import { getUnifiedSyncRuntime } from '@/features/sync';
import { importFileToHistory, importTextToHistory } from '@/utils/uploadFile';
import { getUnifiedSpaceService, useUnifiedSpaceStore } from '@/features/space';
import { useSettingsStore } from '@/features/settings';
import { getAppRuntime } from '@/app/runtime/composition';
import { createLogger } from '@/support/observability';
import { useLanMySpaceSheet } from '../useLanMySpaceSheet';
import { formatBytes } from '@/utils/formatBytes';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import type { SyncDeliveryState, SyncSendOptions } from '@/features/sync';
import { shareTargetProgress } from './shareTargetProgress';

const log = createLogger('ShareSendSheet');

export type SendStage = 'importing' | 'sending';

export type Phase =
  | { kind: 'claiming' }
  | { kind: 'ready' }
  | { kind: 'sending'; jobId: string; stage: SendStage }
  | { kind: 'done'; results: SendResult[] }
  | { kind: 'error'; message: string };

export interface SendResult {
  jobId: string;
  success: boolean;
  deliveryState: string;
  errorMessage?: string;
}

export type JobSendState = 'idle' | 'sending' | 'success' | 'failed';

/** 分享页展示的 job:基础 job + 预览派生数据 + 发送状态 */
export interface ShareJobView {
  job: PendingShareJob;
  /** kind=text:payload 前 80 字预览 */
  previewText?: string;
  sendState: JobSendState;
  errorMessage?: string;
  entryId?: string;
  deliveryState?: string;
  targetResults?: Record<string, SyncDeliveryState>;
}

export interface ShareTarget {
  id: string;
  displayName: string;
  detail?: string;
}

const TEXT_PREVIEW_MAX_CHARS = 80;

/** 与处理租约一致的陈旧判定:超过该时长的 job 只可能是中断会话的残留。 */
const STALE_JOB_AGE_MS = 15 * 60 * 1_000;

interface ShareSession {
  closed: boolean;
  preparing: boolean;
  preparation?: Promise<unknown>;
  unsettledJobs: Set<string>;
}

function assertSessionOpen(session: ShareSession) {
  if (session.closed) throw new Error('Share session closed');
}

async function prepareShareJob<T>(session: ShareSession, task: Promise<T>): Promise<T> {
  session.preparation = task;
  try {
    return await task;
  } finally {
    session.preparation = undefined;
  }
}

export { formatBytes };

async function loadPreview(job: PendingShareJob): Promise<ShareJobView> {
  if (job.kind !== 'text') return { job, sendState: 'idle' };
  try {
    const text = await new File(job.fileUri).text();
    const trimmed = text.trim();
    return {
      job,
      previewText:
        trimmed.length > TEXT_PREVIEW_MAX_CHARS
          ? `${trimmed.slice(0, TEXT_PREVIEW_MAX_CHARS)}…`
          : trimmed,
      sendState: 'idle',
    };
  } catch {
    return { job, sendState: 'idle' };
  }
}

export function useShareSendController(onClose: () => void, active: boolean, jobs?: PendingShareJob[]) {
  const { t } = useTranslation('share');
  const outbound = useUnifiedEngineStore((state) => state.outbound);
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');
  const spaceDevices = useUnifiedSpaceStore((s) => s.devices);
  const isP2pTargetStateLoading = useUnifiedSpaceStore(
    (s) =>
      !s.hasResolvedDeviceList &&
      (s.status === 'idle' ||
        s.status === 'loading' ||
        s.deviceListRefreshStatus === 'refreshing')
  );
  const lan = useLanMySpaceSheet(active && syncChannel === 'lan');
  const availableTargets = useMemo<ShareTarget[]>(
    () =>
      syncChannel === 'lan'
        ? lan.servers
            .filter((server) => server.status === 'online')
            .map((server) => ({
              id: server.id,
              displayName: server.name,
              detail: server.address,
            }))
        : spaceDevices
            .filter((device) => !device.isLocal)
            .map((device) => ({ id: device.deviceId, displayName: device.displayName })),
    [lan.servers, spaceDevices, syncChannel]
  );

  const [phase, setPhase] = useState<Phase>({ kind: 'claiming' });
  const [sessionTargets, setSessionTargets] = useState<ShareTarget[]>([]);
  const targets = phase.kind === 'sending' || phase.kind === 'done' ? sessionTargets : availableTargets;
  const sessionRef = useRef<ShareSession>({
    closed: !active,
    preparing: false,
    unsettledJobs: new Set(),
  });
  const [jobViews, setJobViews] = useState<ShareJobView[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [isRefreshingP2pTargets, setIsRefreshingP2pTargets] = useState(false);
  const sendingRef = useRef(false);
  const sentEntries = useRef(new Map<string, string>());
  const hasAppliedDefaultSelectionRef = useRef(false);
  const refreshP2pTargets = useCallback(async () => {
    const session = sessionRef.current;
    const hadResolvedDeviceList = useUnifiedSpaceStore.getState().hasResolvedDeviceList;
    setIsRefreshingP2pTargets(true);
    try {
      await getAppRuntime().ensureStarted();
      if (session.closed) return;
      const current = useUnifiedSpaceStore.getState();
      if (hadResolvedDeviceList) {
        await getUnifiedSpaceService().refreshDevices();
      } else if (!current.hasResolvedDeviceList && current.status !== 'empty') {
        await getUnifiedSpaceService().refresh();
      }
    } catch (error) {
      log.warn('Failed to prepare share targets', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      if (!session.closed) setIsRefreshingP2pTargets(false);
    }
  }, []);
  // App-provided files belong to the presenting screen, not the external share queue.
  const completeJob = useCallback(async (jobId: string) => {
    if (!jobs) await getOutboundShareHandoffManager().completeJob(jobId);
  }, [jobs]);

  const updateJob = useCallback((jobId: string, patch: Partial<ShareJobView>) => {
    setJobViews((views) =>
      views.map((view) => (view.job.id === jobId ? { ...view, ...patch } : view))
    );
  }, []);

  const sendOptions = useCallback((session: ShareSession, jobId: string, targetIds: string[]): SyncSendOptions => {
    return {
      targetIds,
      onEntryCreated: (entryId) => {
        if (session.closed || session !== sessionRef.current) return;
        sentEntries.current.set(jobId, entryId);
        updateJob(jobId, { entryId });
        void getUnifiedEngineService().refreshOutboundProgress();
      },
      onTargetResult: (targetId, state) => {
        if (session.closed || session !== sessionRef.current) return;
        setJobViews((views) => views.map((view) => view.job.id === jobId
          ? { ...view, targetResults: { ...view.targetResults, [targetId]: state } }
          : view));
      },
    };
  }, [updateJob]);

  // Refresh while the session is visible. Events can be lost during recovery.
  useEffect(() => {
    if (!active || syncChannel !== 'p2p' || (phase.kind !== 'sending' && phase.kind !== 'done')) return;
    const refresh = () => { void getUnifiedEngineService().refreshOutboundProgress(); };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [active, phase.kind, syncChannel]);

  // 认领全部 pending job(单次认领守卫:并发由管理器 running 锁合并,
  // 重入由 claim 的稳定引用 + active 驱动的 effect 保证)。
  const claim = useCallback(async () => {
    const session = sessionRef.current;
    try {
      // 打开时刷新一次设备快照;失败沿用现有快照,不阻断弹层(§8.4)
      if (syncChannel === 'p2p') {
        void refreshP2pTargets();
      }
      if (jobs) {
        if (session.closed) return;
        const views = await Promise.all(jobs.map(loadPreview));
        if (session.closed) return;
        setJobViews(views);
        setPhase({ kind: 'ready' });
        return;
      }
      const store = createPendingShareStore();
      await store.cleanup();
      if (session.closed) return;
      const pendingJobs = await getOutboundShareHandoffManager().claimPending();
      if (session.closed) return;

      // 两端在入队前都已把内容写入主页历史。超过处理租约的 job 只可能是
      // 中断会话的残留,直接出队,保证每次分享都是崭新的一次。
      const now = Date.now();
      for (const job of pendingJobs) {
        if (now - job.createdAtMs > STALE_JOB_AGE_MS) {
          await getOutboundShareHandoffManager().completeJob(job.id);
        }
      }
      const freshJobs = pendingJobs.filter((job) => now - job.createdAtMs <= STALE_JOB_AGE_MS);
      if (session.closed) return;
      const views = await Promise.all(freshJobs.map(loadPreview));
      if (session.closed) return;
      setJobViews(views);
      setPhase({ kind: 'ready' });
    } catch (error) {
      if (session.closed) return;
      log.warn('Failed to claim pending share jobs', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      setPhase({ kind: 'error', message: t('send.claimFailed') });
    }
  }, [jobs, refreshP2pTargets, syncChannel, t]);

  // 会话开关:active=false 结束会话(重置发送锁);true 开始新会话,
  // 重置状态并重新认领(组件常驻挂载,不依赖 mount)。lastActiveRef 保证
  // 只在「非活跃 → 活跃」转换时启动,依赖变化(如 t 引用)不会重复触发。
  const lastActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = lastActiveRef.current;
    lastActiveRef.current = active;
    if (!active) {
      sessionRef.current.closed = true;
      sendingRef.current = false;
      hasAppliedDefaultSelectionRef.current = false;
      return;
    }
    if (wasActive) return;
    sessionRef.current.closed = true;
    sessionRef.current = { closed: false, preparing: false, unsettledJobs: new Set() };
    setPhase({ kind: 'claiming' });
    setJobViews([]);
    setIsRefreshingP2pTargets(false);
    sentEntries.current.clear();
    setSelectedTargetIds(new Set());
    void claim();
  }, [active, claim]);

  useEffect(() => () => {
    sessionRef.current.closed = true;
    lastActiveRef.current = false;
  }, []);

  useEffect(() => {
    if (!active) return;
    hasAppliedDefaultSelectionRef.current = false;
    setSelectedTargetIds(new Set());
  }, [active, syncChannel]);

  useEffect(() => {
    if (!active || hasAppliedDefaultSelectionRef.current || targets.length === 0) return;
    hasAppliedDefaultSelectionRef.current = true;
    if (targets.length === 1) {
      setSelectedTargetIds(new Set([targets[0].id]));
    }
  }, [active, targets]);

  useEffect(() => {
    const availableIds = new Set(targets.map((target) => target.id));
    setSelectedTargetIds((current) => {
      const next = new Set([...current].filter((targetId) => availableIds.has(targetId)));
      if (next.size === current.size) return current;
      return next;
    });
  }, [targets]);

  // 发送投递后的统一收尾:只有所有目标确认送达才出队;其他结果保留重试。
  const finishSend = useCallback(
    async (
      session: ShareSession,
      jobId: string,
      send: () => Promise<{
        state: string;
        success: boolean;
        entryId?: string;
      }>,
    ) => {
      assertSessionOpen(session);
      session.preparing = false;
      session.unsettledJobs.add(jobId);
      const previousEntry =
        syncChannel === "p2p" ? sentEntries.current.get(jobId) : undefined;
      let result: { state: string; success: boolean; entryId?: string };
      if (previousEntry) {
        const outcome = await getUnifiedSpaceService().resendEntry(
          previousEntry,
          [...selectedTargetIds],
        );
        assertSessionOpen(session);
        if (outcome.kind === "completed")
          recordOutboundResend(previousEntry, outcome.reconciled);
        await getUnifiedEngineService().refreshOutboundProgress();
        assertSessionOpen(session);
        const allCompleted =
          outcome.kind === "completed" &&
          outcome.reconciled.length > 0 &&
          outcome.reconciled.every(
            (target) =>
              target.current?.state === "completed" &&
              !target.newTransferRequested,
          );
        const state = allCompleted
          ? "delivered"
          : p2pDeliveryStateFromResend(outcome);
        result = {
          state,
          success: state === "delivered",
          entryId: previousEntry,
        };
      } else {
        result = await send();
        assertSessionOpen(session);
        if (result.entryId) {
          sentEntries.current.set(jobId, result.entryId);
          updateJob(jobId, { entryId: result.entryId });
        }
      }
      if (session.closed || session !== sessionRef.current) {
        return { jobId, success: false, deliveryState: result.state };
      }
      updateJob(jobId, { deliveryState: result.state });
      const delivered = result.success && result.state === "delivered";
      if (result.state !== 'pending' && result.state !== 'partial') {
        session.unsettledJobs.delete(jobId);
      }
      void recordShareDiagnosticStage(
        jobId,
        delivered ? "sent" : "failed",
        delivered ? undefined : result.state,
      );
      if (delivered) {
        await completeJob(jobId);
        assertSessionOpen(session);
        updateJob(jobId, { sendState: "success" });
        recordHistoryLatency('sender_ui_state', undefined, {
          outcome: 'observed', entryId: result.entryId, state: 'success',
        });
        return { jobId, success: true, deliveryState: result.state };
      }
      const offline = result.state === "offline";
      const message = t(
        result.state === "pending"
          ? "send.unconfirmed"
          : offline
            ? "send.offline"
            : "send.failed",
      );
      if (offline) {
        Alert.alert(t("send.offlineTitle"), message);
      }
      updateJob(jobId, { sendState: "failed", errorMessage: message });
      return {
        jobId,
        success: false,
        deliveryState: result.state,
        errorMessage: message,
      };
    },
    [completeJob, updateJob, t, syncChannel, selectedTargetIds],
  );

  // 已在历史里的内容(应用内「发送到」):跳过导入,按原 profileHash 投递到所选目标。
  const sendHistoryJob = useCallback(
    async (session: ShareSession, job: PendingShareJob, profileHash: string, targetIds: string[]) => {
      setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
      if (job.kind === 'text') {
        const text = await prepareShareJob(session, new File(job.fileUri).text());
        return finishSend(session, job.id, () =>
          getUnifiedSyncRuntime().sendImportedText(text, profileHash, sendOptions(session, job.id, targetIds))
        );
      }
      return finishSend(session, job.id, () =>
        getUnifiedSyncRuntime().sendImportedAsset(
          {
            kind: job.kind === 'image' ? 'image' : 'file',
            uri: job.fileUri,
            fileName: job.displayName,
            mimeType: job.mimeType,
          },
          profileHash,
          sendOptions(session, job.id, targetIds)
        )
      );
    },
    [finishSend, sendOptions]
  );

  // 发送单个 job(串行;不自动重试)
  const sendOne = useCallback(
    async (session: ShareSession, view: ShareJobView, targetIds: string[]): Promise<SendResult> => {
      const { job } = view;
      assertSessionOpen(session);
      session.preparing = true;
      updateJob(job.id, {
        sendState: 'sending',
        errorMessage: undefined,
        targetResults: undefined,
        deliveryState: undefined,
      });
      setPhase({ kind: 'sending', jobId: job.id, stage: 'importing' });
      try {
        if (job.historyProfileHash) {
          return await sendHistoryJob(session, job, job.historyProfileHash, targetIds);
        }
        if (job.kind === 'text') {
          const text = await prepareShareJob(session, new File(job.fileUri).text());
          assertSessionOpen(session);
          const { profileHash } = await prepareShareJob(session, importTextToHistory(text));
          assertSessionOpen(session);
          setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
          return await finishSend(session, job.id, () =>
            getUnifiedSyncRuntime().sendImportedText(text, profileHash, sendOptions(session, job.id, targetIds))
          );
        }
        const imported = await prepareShareJob(session, importFileToHistory(
          job.fileUri,
          job.displayName,
          job.mimeType,
          job.byteCount,
          { skipInitialCopyOnIOS: !jobs && job.kind === 'file' }
        ));
        assertSessionOpen(session);
        setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
        return await finishSend(session, job.id, () =>
          getUnifiedSyncRuntime().sendImportedAsset(
            {
              kind: job.kind === 'image' ? 'image' : 'file',
              uri: imported.fileUri,
              fileName: imported.fileName,
              mimeType: job.mimeType,
            },
            imported.profileHash,
            sendOptions(session, job.id, targetIds)
          )
        );
      } catch (error) {
        if (session.closed || session !== sessionRef.current) {
          return { jobId: job.id, success: false, deliveryState: 'cancelled' };
        }
        session.preparing = false;
        const message = error instanceof Error ? error.message : t('send.failed');
        updateJob(job.id, { sendState: 'failed', errorMessage: message, deliveryState: 'failed' });
        return { jobId: job.id, success: false, deliveryState: 'failed', errorMessage: message };
      }
    },
    [finishSend, jobs, sendHistoryJob, sendOptions, updateJob, t]
  );

  // Stop first. Remove queued payloads only after the runtime releases its readers.
  const handleClose = useCallback(() => {
    const session = sessionRef.current;
    if (session.closed) return;
    session.closed = true;
    sendingRef.current = false;
    const unsent = jobViews.filter((view) => view.sendState !== 'success');
    const stopped = session.preparing || session.unsettledJobs.size > 0
      ? getUnifiedSyncRuntime().stop()
      : Promise.resolve();
    void Promise.all([stopped, session.preparation?.catch(() => undefined)])
      .then(() => Promise.all(unsent.map((view) => completeJob(view.job.id))))
      .catch((error) => {
        log.warn('Failed to stop or clean up dismissed share session', {
          reason: error instanceof Error ? error.name : 'unknown',
        });
      });
    onClose();
  }, [completeJob, jobViews, onClose]);

  // 发送全部 job(串行,每项独立展示状态)
  const sendAll = useCallback(async () => {
    const session = sessionRef.current;
    if (session.closed || sendingRef.current || selectedTargetIds.size === 0 || jobViews.length === 0) return;
    sendingRef.current = true;
    setSessionTargets(targets);
    const selectedTargets = [...selectedTargetIds];
    const results: SendResult[] = [];
    try {
      session.preparing = true;
      await getUnifiedSyncRuntime().switchTo(syncChannel);
      if (session.closed) return;
      for (const view of jobViews) {
        if (session.closed || session !== sessionRef.current) return;
        if (view.sendState === 'success') continue;
        results.push(await sendOne(session, view, selectedTargets));
      }
      if (session.closed || session !== sessionRef.current) return;
      session.preparing = false;
      setPhase({ kind: 'done', results });
      if (results.every((result) => result.success)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (error) {
      if (!session.closed) {
        session.preparing = false;
        setPhase({ kind: 'error', message: error instanceof Error ? error.message : t('send.failed') });
      }
    } finally {
      if (sessionRef.current === session) sendingRef.current = false;
    }
  }, [jobViews, selectedTargetIds, sendOne, syncChannel, t, targets]);

  // 删除(显式):二次确认后清除记录 + payload,不可恢复
  const deleteJob = useCallback(async (jobId: string) => {
    await completeJob(jobId);
    setJobViews((views) => views.filter((view) => view.job.id !== jobId));
  }, [completeJob]);

  const toggleTarget = useCallback((targetId: string) => {
    if (sendingRef.current) return;
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  }, []);

  const refreshTargets = useCallback(async () => {
    if (sendingRef.current) return;
    if (syncChannel === 'lan') {
      await lan.refresh();
      return;
    }
    await refreshP2pTargets();
  }, [lan.refresh, refreshP2pTargets, syncChannel]);

  const handleRetryClaim = useCallback(() => {
    setPhase({ kind: 'claiming' });
    setJobViews([]);
    void claim();
  }, [claim]);

  const isSending = phase.kind === 'sending';
  const isDone = phase.kind === 'done';
  const canSend =
    phase.kind === 'ready' && selectedTargetIds.size > 0 && jobViews.length > 0 && !isSending;

  return {
    phase,
    jobViews,
    targets,
    targetKind: syncChannel === 'lan' ? ('server' as const) : ('device' as const),
    isLoadingTargets:
      syncChannel === 'lan'
        ? lan.isRefreshing
        : isRefreshingP2pTargets || isP2pTargetStateLoading,
    selectedTargetIds,
    targetProgress: new Map(
      phase.kind === 'sending' || phase.kind === 'done'
        ? [...selectedTargetIds].map((targetId) => [targetId, shareTargetProgress(jobViews, targetId, outbound.progress, outbound.available, isSending)] as const)
        : []
    ),
    isSending,
    isDone,
    canSend,
    sendAll,
    deleteJob,
    toggleTarget,
    refreshTargets,
    handleClose,
    handleRetryClaim,
    t,
  };
}
