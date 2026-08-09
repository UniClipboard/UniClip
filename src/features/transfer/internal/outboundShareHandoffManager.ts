import { createLogger } from '@/support/observability';
import type { PendingShareJob, PendingShareStore } from './pendingShareStore';

const log = createLogger('OutboundShareHandoff');

/**
 * 统一分享队列的处理器级守卫(§8.7):
 * - `claimPending()` 提供单次认领守卫(页面双开 / 重复 intent 不会重复认领);
 * - `completeJob` / `releaseJob` 是分享页发送完成后的生命周期封装;
 * - 自动发送循环已移除 —— 发送统一由分享页触发。
 */
export class OutboundShareHandoffManager {
  private running: Promise<PendingShareJob[]> | null = null;

  constructor(private readonly store: PendingShareStore) {}

  claimPending(): Promise<PendingShareJob[]> {
    if (this.running) return this.running;
    this.running = this.store.claimPending().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async completeJob(id: string): Promise<void> {
    try {
      await this.store.completeJob(id);
    } catch (error) {
      log.error('Failed to complete pending share job', {
        jobId: id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async releaseJob(id: string): Promise<void> {
    try {
      await this.store.releaseJob(id);
    } catch (error) {
      log.error('Failed to release pending share job', {
        jobId: id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}

let manager: OutboundShareHandoffManager | null = null;

export function configureOutboundShareHandoffManager(store: PendingShareStore): void {
  if (manager) throw new Error('The outbound share handoff manager has already been created');
  manager = new OutboundShareHandoffManager(store);
}

export function getOutboundShareHandoffManager(): OutboundShareHandoffManager {
  if (!manager) throw new Error('The outbound share handoff manager is not configured');
  return manager;
}

/** 仅供测试重置单例。 */
export function resetOutboundShareHandoffManagerForTest(): void {
  manager = null;
}
