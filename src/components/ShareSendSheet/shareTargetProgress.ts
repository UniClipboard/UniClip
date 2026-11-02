import type { OutboundProgress } from '@/platform/engine';
import type { ShareJobView } from './useShareSendController';

export interface ShareTargetProgress {
  state: 'preparing' | 'sending' | 'confirming' | 'success' | 'failed' | 'unconfirmed';
  /** Null means that the transport has not supplied complete byte counts. */
  fraction: number | null;
}

/** Project only this Share session's entries, one aggregate per selected destination. */
export function shareTargetProgress(
  jobs: ShareJobView[],
  targetId: string,
  progress: OutboundProgress[],
  available: boolean,
  sending: boolean,
): ShareTargetProgress {
  let completed = BigInt(0);
  let total = BigInt(0);
  let known = true;
  const states = jobs.map((view): ShareTargetProgress['state'] => {
    const p = available && view.entryId
      ? progress.find((item) => item.entryId === view.entryId && item.targetDeviceId === targetId)
      : undefined;
    const result = view.targetResults?.[targetId];
    const settled = p && p.itemsRunning === 0 && p.itemsWaiting === 0 && p.itemsUnconfirmed === 0;
    const success = result === 'delivered' || view.sendState === 'success' || (settled && p.freshnessAvailable && p.freshness !== 'unconfirmed' && p.state === 'completed');
    if (p && p.items.length > 0 && p.items.every((item) => item.totalBytes !== null && item.completedBytes !== null)) {
      for (const item of p.items) {
        const size = BigInt(item.totalBytes!);
        const sent = BigInt(item.completedBytes!);
        total += size;
        completed += sent > size ? size : sent;
      }
    } else if (success || view.sendState === 'idle') {
      const size = BigInt(view.job.byteCount);
      total += size;
      if (success) completed += size;
    } else {
      known = false;
    }
    if (success) return 'success';
    if (result === 'failed' || result === 'offline') return 'failed';
    if (p && settled && ['failed', 'partially_failed', 'cancelled', 'partially_cancelled'].includes(p.state)) return 'failed';
    if (p && (!p.freshnessAvailable || ['unconfirmed', 'partially_unconfirmed'].includes(p.state))) return 'unconfirmed';
    if (p?.itemsRunning || p?.itemsWaiting) return 'sending';
    if (result === 'pending') return 'unconfirmed';
    if (view.sendState === 'failed') return view.deliveryState === 'pending' ? 'unconfirmed' : 'failed';
    return view.sendState === 'idle' ? 'preparing' : 'sending';
  });
  const fraction = known && total > BigInt(0)
    ? Number(completed * BigInt(10000) / total) / 10000
    : null;
  const state = states.every((value) => value === 'success') ? 'success'
    : sending && states.some((value) => value === 'sending' || value === 'preparing') ? 'sending'
    : states.includes('failed') ? 'failed'
    : states.includes('unconfirmed') ? 'unconfirmed'
    : 'confirming';
  return { state: state === 'sending' && fraction === 1 ? 'confirming' : state, fraction: state === 'success' ? 1 : fraction };
}
