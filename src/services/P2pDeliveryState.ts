import type { SendReport } from 'uc-engine';
import type { ResendEntryOutcome } from './UnifiedSpaceService';
import {
  HistorySyncStatus,
  type ClipboardItem,
  type P2pDeliveryCounts,
  type P2pDeliveryState,
} from '@/types/clipboard';
import { historyRepository } from './db/historyRepository';
import { historyStorage } from './HistoryStorage';

export function p2pDeliveryStateFromReport(report: SendReport): P2pDeliveryState {
  return p2pDeliveryStateFromCounts(p2pDeliveryCountsFromReport(report));
}

export function p2pDeliveryStateFromResend(outcome: ResendEntryOutcome): P2pDeliveryState {
  if (outcome.kind !== 'completed') return 'failed';
  return p2pDeliveryStateFromCounts(p2pDeliveryCountsFromResend(outcome));
}

export function p2pDeliveryCountsFromReport(report: SendReport): P2pDeliveryCounts {
  return {
    accepted: report.totalAccepted,
    duplicate: report.totalDuplicate,
    offline: report.totalOffline,
    errored: report.totalErrored,
    pending: report.totalPending,
  };
}

export function p2pDeliveryCountsFromResend(
  outcome: Extract<ResendEntryOutcome, { kind: 'completed' }>
): P2pDeliveryCounts {
  return {
    accepted: outcome.accepted,
    duplicate: outcome.duplicate,
    offline: outcome.offline,
    errored: outcome.errored,
    pending: outcome.pending,
  };
}

export function p2pDeliveryTranslationOptions(
  counts: P2pDeliveryCounts | undefined
): Record<string, number> {
  return counts ? { ...counts } : {};
}

function p2pDeliveryStateFromCounts(counts: P2pDeliveryCounts): P2pDeliveryState {
  const delivered = counts.accepted + counts.duplicate;
  const remaining = counts.offline + counts.errored + counts.pending;
  if (delivered > 0 && remaining > 0) return 'partial';
  if (delivered > 0) return 'delivered';
  if (counts.errored > 0) return 'failed';
  if (counts.offline > 0) return 'offline';
  if (counts.pending > 0) return 'pending';
  return 'failed';
}

export function p2pDeliveryUpdates(
  entryId: string,
  state: P2pDeliveryState,
  counts?: P2pDeliveryCounts
): Pick<ClipboardItem, 'p2pEntryId' | 'p2pDeliveryState' | 'p2pDeliveryCounts' | 'syncStatus'> {
  return {
    p2pEntryId: entryId,
    p2pDeliveryState: state,
    p2pDeliveryCounts: counts,
    syncStatus: state === 'delivered' ? HistorySyncStatus.Synced : HistorySyncStatus.NeedSync,
  };
}

export async function persistP2pDeliveryReport(
  profileHash: string | undefined,
  report: SendReport
): Promise<void> {
  if (!profileHash) return;
  const item = await historyRepository.getByProfileHash(profileHash);
  if (!item) return;
  await historyStorage.updateItem(
    item.profileHash,
    p2pDeliveryUpdates(
      report.entryId,
      p2pDeliveryStateFromReport(report),
      p2pDeliveryCountsFromReport(report)
    )
  );
}
