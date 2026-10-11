import {
  clearActivate,
  clipboardManager,
  clipboardMonitor,
  noteApplied,
  useClipboardStore,
} from '@/features/clipboard';
import { File } from 'expo-file-system';
import { useHistoryStore } from '@/features/history';
import type { ApplyLanRemoteContentInput } from './internal/lanSyncAdapter';
import { LanRemoteContentApplier } from './internal/lanRemoteContentApplier';

const productionApplier = new LanRemoteContentApplier({
  pauseClipboardMonitoring: () => clipboardMonitor.pausePolling(),
  resumeClipboardMonitoring: () => clipboardMonitor.resumePolling(),
  setClipboardContent: (content) => clipboardManager.setClipboardContent(content),
  readClipboardContent: () => clipboardManager.getClipboardContent(),
  setClipboardWatermark: (content) => clipboardMonitor.setLastContent(content),
  noteApplied,
  clearActivate,
  // A failed save must surface so the adapter can retry it; the store would otherwise hide it.
  addHistoryItem: (item) => useHistoryStore.getState().addItem(item, { throwOnFailure: true }),
  setCurrentContentDisplay: (content) =>
    useClipboardStore.getState().setCurrentContentDisplay(content),
  readTextFile: (uri) => new File(uri).text(),
});

export function applyLanRemoteContent(input: ApplyLanRemoteContentInput): Promise<void> {
  return productionApplier.apply(input);
}
