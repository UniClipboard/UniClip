import { create } from 'zustand';
import type { ReceiveResultsSnapshot } from '@/features/transfer';

export function createInitialReceiveResultsSnapshot(): ReceiveResultsSnapshot {
  return { entries: {}, stale: false, error: null };
}

export const useReceiveResultsStore = create<ReceiveResultsSnapshot>(() =>
  createInitialReceiveResultsSnapshot()
);

export function publishReceiveResultsSnapshot(snapshot: ReceiveResultsSnapshot): void {
  useReceiveResultsStore.setState(snapshot, true);
}
