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
import { createLogger } from '@/support/observability';
import { useLanMySpaceSheet } from '../useLanMySpaceSheet';

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
}

export interface ShareTarget {
  id: string;
  displayName: string;
  detail?: string;
}

const TEXT_PREVIEW_MAX_CHARS = 80;
const SUCCESS_CLOSE_DELAY_MS = 600;

/** 与处理租约一致的陈旧判定:超过该时长的 job 只可能是中断会话的残留。 */
const STALE_JOB_AGE_MS = 15 * 60 * 1_000;

export function formatBytes(byteCount: number): string {
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KB`;
  if (byteCount < 1024 * 1024 * 1024) return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
  return `${(byteCount / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

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
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');
  const spaceDevices = useUnifiedSpaceStore((s) => s.devices);
  const lan = useLanMySpaceSheet(active && syncChannel === 'lan');
  const targets = useMemo<ShareTarget[]>(
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
  const [jobViews, setJobViews] = useState<ShareJobView[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [isRefreshingP2pTargets, setIsRefreshingP2pTargets] = useState(false);
  const sendingRef = useRef(false);
  const hasAppliedDefaultSelectionRef = useRef(false);
  const successCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // App-provided files belong to the presenting screen, not the external share queue.
  const completeJob = useCallback(async (jobId: string) => {
    if (!jobs) await getOutboundShareHandoffManager().completeJob(jobId);
  }, [jobs]);

  const updateJob = useCallback((jobId: string, patch: Partial<ShareJobView>) => {
    setJobViews((views) =>
      views.map((view) => (view.job.id === jobId ? { ...view, ...patch } : view))
    );
  }, []);

  // 认领全部 pending job(单次认领守卫:并发由管理器 running 锁合并,
  // 重入由 claim 的稳定引用 + active 驱动的 effect 保证)。
  const claim = useCallback(async () => {
    try {
      // 打开时刷新一次设备快照;失败沿用现有快照,不阻断弹层(§8.4)
      if (syncChannel === 'p2p') {
        void getUnifiedSpaceService()
          .refreshDevices()
          .catch(() => undefined);
      }
      if (jobs) {
        setJobViews(await Promise.all(jobs.map(loadPreview)));
        setPhase({ kind: 'ready' });
        return;
      }
      const store = createPendingShareStore();
      await store.cleanup();
      const pendingJobs = await getOutboundShareHandoffManager().claimPending();

      // 两端在入队前都已把内容写入主页历史。超过处理租约的 job 只可能是
      // 中断会话的残留,直接出队,保证每次分享都是崭新的一次。
      const now = Date.now();
      for (const job of pendingJobs) {
        if (now - job.createdAtMs > STALE_JOB_AGE_MS) {
          await getOutboundShareHandoffManager().completeJob(job.id);
        }
      }
      const freshJobs = pendingJobs.filter((job) => now - job.createdAtMs <= STALE_JOB_AGE_MS);
      const views = await Promise.all(freshJobs.map(loadPreview));
      setJobViews(views);
      setPhase({ kind: 'ready' });
    } catch (error) {
      log.warn('Failed to claim pending share jobs', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      setPhase({ kind: 'error', message: t('send.claimFailed') });
    }
  }, [jobs, syncChannel, t]);

  // 会话开关:active=false 结束会话(重置发送锁);true 开始新会话,
  // 重置状态并重新认领(组件常驻挂载,不依赖 mount)。lastActiveRef 保证
  // 只在「非活跃 → 活跃」转换时启动,依赖变化(如 t 引用)不会重复触发。
  const lastActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = lastActiveRef.current;
    lastActiveRef.current = active;
    if (!active) {
      sendingRef.current = false;
      hasAppliedDefaultSelectionRef.current = false;
      return;
    }
    if (wasActive) return;
    setPhase({ kind: 'claiming' });
    setJobViews([]);
    setSelectedTargetIds(new Set());
    void claim();
  }, [active, claim]);

  useEffect(() => {
    if (!active) return;
    hasAppliedDefaultSelectionRef.current = false;
    setSelectedTargetIds(new Set());
  }, [active, syncChannel]);

  useEffect(() => {
    if (active || !successCloseTimerRef.current) return;
    clearTimeout(successCloseTimerRef.current);
    successCloseTimerRef.current = null;
  }, [active]);

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
    async (jobId: string, send: () => Promise<{ state: string; success: boolean }>) => {
      const result = await send();
      const delivered = result.success && result.state === 'delivered';
      void recordShareDiagnosticStage(
        jobId,
        delivered ? 'sent' : 'failed',
        delivered ? undefined : result.state
      );
      if (delivered) {
        await completeJob(jobId);
        updateJob(jobId, { sendState: 'success' });
        return { jobId, success: true, deliveryState: result.state };
      }
      const offline = result.state === 'offline';
      const message = t(offline ? 'send.offline' : 'send.failed');
      if (offline) {
        Alert.alert(t('send.offlineTitle'), message);
      }
      updateJob(jobId, { sendState: 'failed', errorMessage: message });
      return { jobId, success: false, deliveryState: result.state, errorMessage: message };
    },
    [completeJob, updateJob, t]
  );

  // 发送单个 job(串行;不自动重试)
  const sendOne = useCallback(
    async (view: ShareJobView, targetIds: string[]): Promise<SendResult> => {
      const { job } = view;
      updateJob(job.id, { sendState: 'sending', errorMessage: undefined });
      setPhase({ kind: 'sending', jobId: job.id, stage: 'importing' });
      try {
        if (job.kind === 'text') {
          const text = await new File(job.fileUri).text();
          const { profileHash } = await importTextToHistory(text);
          setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
          return await finishSend(job.id, () =>
            getUnifiedSyncRuntime().sendImportedText(text, profileHash, {
              targetIds,
            })
          );
        }
        const imported = await importFileToHistory(
          job.fileUri,
          job.displayName,
          job.mimeType,
          job.byteCount,
          { skipInitialCopyOnIOS: !jobs && job.kind === 'file' }
        );
        setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
        return await finishSend(job.id, () =>
          getUnifiedSyncRuntime().sendImportedAsset(
            {
              kind: job.kind === 'image' ? 'image' : 'file',
              uri: imported.fileUri,
              fileName: imported.fileName,
              mimeType: job.mimeType,
            },
            imported.profileHash,
            { targetIds }
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : t('send.failed');
        updateJob(job.id, { sendState: 'failed', errorMessage: message });
        return { jobId: job.id, success: false, deliveryState: 'failed', errorMessage: message };
      }
    },
    [finishSend, jobs, updateJob, t]
  );

  // 发送全部 job(串行,每项独立展示状态)
  const sendAll = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const selectedTargets = [...selectedTargetIds];
    const results: SendResult[] = [];
    try {
      for (const view of jobViews) {
        if (view.sendState === 'success') continue;
        results.push(await sendOne(view, selectedTargets));
      }
      setPhase({ kind: 'done', results });
      if (results.every((result) => result.success)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        successCloseTimerRef.current = setTimeout(() => {
          successCloseTimerRef.current = null;
          onClose();
        }, SUCCESS_CLOSE_DELAY_MS);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [jobViews, onClose, selectedTargetIds, sendOne]);

  // 重试单个 job(无需重新认领)
  const retryJob = useCallback(
    async (jobId: string) => {
      if (sendingRef.current) return;
      const view = jobViews.find((v) => v.job.id === jobId);
      if (!view) return;
      sendingRef.current = true;
      try {
        await sendOne(view, [...selectedTargetIds]);
      } finally {
        sendingRef.current = false;
      }
    },
    [jobViews, selectedTargetIds, sendOne]
  );

  // 删除(显式):二次确认后清除记录 + payload,不可恢复
  const deleteJob = useCallback(async (jobId: string) => {
    await completeJob(jobId);
    setJobViews((views) => views.filter((view) => view.job.id !== jobId));
  }, [completeJob]);

  const toggleTarget = useCallback((targetId: string) => {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
  }, []);

  const refreshTargets = useCallback(async () => {
    if (syncChannel === 'lan') {
      await lan.refresh();
      return;
    }
    setIsRefreshingP2pTargets(true);
    try {
      await getUnifiedSpaceService().refreshDevices();
    } finally {
      setIsRefreshingP2pTargets(false);
    }
  }, [lan.refresh, syncChannel]);

  // 取消 / 完成:内容已保存,未发送 job 直接出队,返回上一页
  const handleClose = useCallback(() => {
    if (sendingRef.current) return;
    const unsent = jobViews.filter((view) => view.sendState !== 'success');
    for (const view of unsent) {
      void completeJob(view.job.id);
    }
    onClose();
  }, [completeJob, jobViews, onClose]);

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
    isLoadingTargets: syncChannel === 'lan' ? lan.isRefreshing : isRefreshingP2pTargets,
    selectedTargetIds,
    isSending,
    isDone,
    canSend,
    sendAll,
    retryJob,
    deleteJob,
    toggleTarget,
    refreshTargets,
    handleClose,
    handleRetryClaim,
    t,
  };
}
