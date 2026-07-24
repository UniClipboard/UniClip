import type { SendReport } from 'uc-engine';
import type { ResendEntryOutcome } from './UnifiedSpaceService';
import { HistorySyncStatus, type ClipboardItem, type P2pDeliveryState } from '@/types/clipboard';
import { historyRepository } from './db/historyRepository';
import { historyStorage } from './HistoryStorage';

export function p2pDeliveryStateFromReport(report: SendReport): P2pDeliveryState {
  if (report.totalErrored > 0) return 'failed';
  if (report.totalOffline > 0) return 'offline';
  if (report.totalPending > 0) return 'pending';
  if (report.totalAccepted + report.totalDuplicate > 0) return 'delivered';
  return 'failed';
}

export function p2pDeliveryStateFromResend(outcome: ResendEntryOutcome): P2pDeliveryState {
  if (outcome.kind !== 'completed') return 'failed';
  if (outcome.errored > 0) return 'failed';
  if (outcome.offline > 0) return 'offline';
  if (outcome.pending > 0) return 'pending';
  if (outcome.accepted + outcome.duplicate > 0) return 'delivered';
  return 'failed';
}

export function p2pDeliveryUpdates(
  entryId: string,
  state: P2pDeliveryState
): Pick<ClipboardItem, 'p2pEntryId' | 'p2pDeliveryState' | 'syncStatus'> {
  return {
    p2pEntryId: entryId,
    p2pDeliveryState: state,
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
    p2pDeliveryUpdates(report.entryId, p2pDeliveryStateFromReport(report))
  );
}
