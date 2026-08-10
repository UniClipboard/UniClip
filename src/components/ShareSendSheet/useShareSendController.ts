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
import { getOutboundShareHandoffManager, getUnifiedContentService } from '@/features/transfer';
import { createPendingShareStore, type PendingShareJob } from '@/features/transfer';
import { importFileToHistory, importTextToHistory } from '@/utils/uploadFile';
import { getUnifiedSpaceService, useUnifiedSpaceStore } from '@/features/space';
import { createLogger } from '@/support/observability';

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

export function useShareSendController(onClose: () => void, active: boolean) {
  const { t } = useTranslation('share');
  const spaceDevices = useUnifiedSpaceStore((s) => s.devices);
  const devices = useMemo(() => spaceDevices.filter((device) => !device.isLocal), [spaceDevices]);

  const [phase, setPhase] = useState<Phase>({ kind: 'claiming' });
  const [jobViews, setJobViews] = useState<ShareJobView[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const sendingRef = useRef(false);
  const hasAppliedDefaultSelectionRef = useRef(false);
  const successCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      void getUnifiedSpaceService()
        .refreshDevices()
        .catch(() => undefined);
      const store = createPendingShareStore();
      await store.cleanup();
      const jobs = await getOutboundShareHandoffManager().claimPending();

      // 两端在入队前都已把内容写入主页历史。超过处理租约的 job 只可能是
      // 中断会话的残留,直接出队,保证每次分享都是崭新的一次。
      const now = Date.now();
      for (const job of jobs) {
        if (now - job.createdAtMs > STALE_JOB_AGE_MS) {
          await getOutboundShareHandoffManager().completeJob(job.id);
        }
      }
      const freshJobs = jobs.filter((job) => now - job.createdAtMs <= STALE_JOB_AGE_MS);
      const views = await Promise.all(freshJobs.map(loadPreview));
      setJobViews(views);
      setPhase({ kind: 'ready' });
    } catch (error) {
      log.warn('Failed to claim pending share jobs', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      setPhase({ kind: 'error', message: t('send.claimFailed') });
    }
  }, [t]);

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
    setSelectedDeviceIds(new Set());
    void claim();
  }, [active, claim]);

  useEffect(() => {
    if (active || !successCloseTimerRef.current) return;
    clearTimeout(successCloseTimerRef.current);
    successCloseTimerRef.current = null;
  }, [active]);

  useEffect(() => {
    if (!active || hasAppliedDefaultSelectionRef.current || devices.length === 0) return;
    hasAppliedDefaultSelectionRef.current = true;
    if (devices.length === 1) {
      setSelectedDeviceIds(new Set([devices[0].deviceId]));
    }
  }, [active, devices]);

  // 发送投递后的统一收尾:只有所有目标确认送达才出队;其他结果保留重试。
  const finishSend = useCallback(
    async (jobId: string, send: () => Promise<{ deliveryState: string; success: boolean }>) => {
      const result = await send();
      const delivered = result.success && result.deliveryState === 'delivered';
      void recordShareDiagnosticStage(
        jobId,
        delivered ? 'sent' : 'failed',
        delivered ? undefined : result.deliveryState
      );
      if (delivered) {
        await getOutboundShareHandoffManager().completeJob(jobId);
        updateJob(jobId, { sendState: 'success' });
        return { jobId, success: true, deliveryState: result.deliveryState };
      }
      const offline = result.deliveryState === 'offline';
      const message = t(offline ? 'send.offline' : 'send.failed');
      if (offline) {
        Alert.alert(t('send.offlineTitle'), message);
      }
      updateJob(jobId, { sendState: 'failed', errorMessage: message });
      return { jobId, success: false, deliveryState: result.deliveryState, errorMessage: message };
    },
    [updateJob, t]
  );

  // 发送单个 job(串行;不自动重试)
  const sendOne = useCallback(
    async (view: ShareJobView, targetDeviceIds: string[]): Promise<SendResult> => {
      const { job } = view;
      updateJob(job.id, { sendState: 'sending', errorMessage: undefined });
      setPhase({ kind: 'sending', jobId: job.id, stage: 'importing' });
      try {
        if (job.kind === 'text') {
          const text = await new File(job.fileUri).text();
          const { profileHash } = await importTextToHistory(text);
          setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
          return await finishSend(job.id, () =>
            getUnifiedContentService().sendImportedText(text, profileHash, { targetDeviceIds })
          );
        }
        const imported = await importFileToHistory(
          job.fileUri,
          job.displayName,
          job.mimeType,
          job.byteCount,
          { skipInitialCopyOnIOS: job.kind === 'file' }
        );
        setPhase({ kind: 'sending', jobId: job.id, stage: 'sending' });
        return await finishSend(job.id, () =>
          getUnifiedContentService().sendImportedAsset(
            {
              kind: job.kind === 'image' ? 'image' : 'file',
              uri: imported.fileUri,
              fileName: imported.fileName,
              mimeType: job.mimeType,
            },
            imported.profileHash,
            { targetDeviceIds }
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : t('send.failed');
        updateJob(job.id, { sendState: 'failed', errorMessage: message });
        return { jobId: job.id, success: false, deliveryState: 'failed', errorMessage: message };
      }
    },
    [finishSend, updateJob, t]
  );

  // 发送全部 job(串行,每项独立展示状态)
  const sendAll = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    const targets = [...selectedDeviceIds];
    const results: SendResult[] = [];
    try {
      for (const view of jobViews) {
        if (view.sendState === 'success') continue;
        results.push(await sendOne(view, targets));
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
  }, [jobViews, onClose, selectedDeviceIds, sendOne]);

  // 重试单个 job(无需重新认领)
  const retryJob = useCallback(
    async (jobId: string) => {
      if (sendingRef.current) return;
      const view = jobViews.find((v) => v.job.id === jobId);
      if (!view) return;
      sendingRef.current = true;
      try {
        await sendOne(view, [...selectedDeviceIds]);
      } finally {
        sendingRef.current = false;
      }
    },
    [jobViews, selectedDeviceIds, sendOne]
  );

  // 删除(显式):二次确认后清除记录 + payload,不可恢复
  const deleteJob = useCallback(async (jobId: string) => {
    await getOutboundShareHandoffManager().completeJob(jobId);
    setJobViews((views) => views.filter((view) => view.job.id !== jobId));
  }, []);

  const toggleDevice = useCallback((deviceId: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }, []);

  // 取消 / 完成:内容已保存,未发送 job 直接出队,返回上一页
  const handleClose = useCallback(() => {
    const unsent = jobViews.filter((view) => view.sendState !== 'success');
    for (const view of unsent) {
      void getOutboundShareHandoffManager().completeJob(view.job.id);
    }
    onClose();
  }, [jobViews, onClose]);

  const handleRetryClaim = useCallback(() => {
    setPhase({ kind: 'claiming' });
    setJobViews([]);
    void claim();
  }, [claim]);

  const isSending = phase.kind === 'sending';
  const isDone = phase.kind === 'done';
  const canSend =
    phase.kind === 'ready' && selectedDeviceIds.size > 0 && jobViews.length > 0 && !isSending;

  return {
    phase,
    jobViews,
    devices,
    selectedDeviceIds,
    isSending,
    isDone,
    canSend,
    sendAll,
    retryJob,
    deleteJob,
    toggleDevice,
    handleClose,
    handleRetryClaim,
    t,
  };
}
