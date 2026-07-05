/**
 * BackgroundUploadManager
 *
 * 「上传 = 保存本地 + 后台推送」里的后台推送段。前台(HomeView FAB / ShareReceiveScreen)
 * 把内容 import*ToHistory 落库(LocalOnly)后立即返回,把 profileHash 丢进这里异步推送:
 *
 * - fire-and-forget:enqueue 立即返回,不阻塞界面。
 * - 有限退避重试:服务端离线/瞬时错误时自动重试若干次;耗尽后保持 LocalOnly(卡片显示
 *   待上传角标),不再打扰用户。
 * - 幂等:同一 profileHash 正在推送时重复 enqueue 忽略。
 * - 可取消:cancel(profileHash) 中断底层请求(暂无 UI 入口,预留给卡片「取消上传」)。
 * - 不依赖 enableHistorySync:直接读当前服务器 + putContent,与旧前台上传语义一致
 *   (uploadRecord + putClipboard,即推送为服务器当前剪贴板)。
 */

import { pushHistoryRecord } from '@/utils/uploadFile';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMessageStore } from '@/stores/messageStore';
import { log } from './Logger';
import i18n from '@/i18n';

/** 退避序列(ms):约 2→4→8→16→30s,总计约 1 分钟后放弃,保持 LocalOnly 等下次同步。 */
const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

/** 正在后台推送的任务:profileHash → 该次推送的 AbortController。 */
const active = new Map<string, AbortController>();

/** 可中断的延时:signal abort 时立即 resolve(用于取消等待中的重试)。 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(onDone, ms);
    function onDone() {
      signal.removeEventListener('abort', onDone);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onDone, { once: true });
  });
}

async function runUpload(profileHash: string, controller: AbortController): Promise<void> {
  const signal = controller.signal;
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) return;

    const server = useSettingsStore.getState().getActiveServer();
    if (!server) {
      // 未配置服务器:内容已落本地,无处可推,直接结束(保持 LocalOnly)。
      log.info(`[BackgroundUpload] No active server, keep local: ${profileHash}`);
      return;
    }

    try {
      await pushHistoryRecord(profileHash, server, { signal });
      log.info(`[BackgroundUpload] Pushed: ${profileHash}`);
      return; // 成功(或已 Synced)
    } catch (error) {
      if (signal.aborted) return;
      const isLast = attempt === maxAttempts - 1;
      log.warn(
        `[BackgroundUpload] Push failed (attempt ${attempt + 1}/${maxAttempts}): ${profileHash}`,
        error
      );
      if (isLast) {
        // 耗尽重试:内容仍在本地(LocalOnly),卡片角标已表明「待上传」,给一次轻提示即可。
        useMessageStore.getState().showMessage(i18n.t('errors:upload.failedSavedLocal'), 'error');
        return;
      }
      await delay(RETRY_BACKOFF_MS[attempt], signal);
    }
  }
}

export const BackgroundUploadManager = {
  /**
   * 入队一条已落库记录的后台推送。立即返回;同 hash 正在推送时忽略。
   */
  enqueue(profileHash: string): void {
    if (active.has(profileHash)) return;
    const controller = new AbortController();
    active.set(profileHash, controller);
    // fire-and-forget:内部自带重试与错误处理,不向调用方抛出。
    void runUpload(profileHash, controller).finally(() => {
      // 仅当仍是本次 controller 时才删除,避免竞态误删后续入队。
      if (active.get(profileHash) === controller) active.delete(profileHash);
    });
  },

  /** 取消某条记录的后台推送(中断底层请求与等待中的重试)。 */
  cancel(profileHash: string): void {
    const controller = active.get(profileHash);
    if (!controller) return;
    controller.abort();
    active.delete(profileHash);
  },

  /** 是否有该记录的推送正在进行。 */
  isPending(profileHash: string): boolean {
    return active.has(profileHash);
  },
};
