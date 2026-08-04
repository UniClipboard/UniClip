import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardContent, ClipboardItem } from '@/types/clipboard';
import { historyStorage } from './internal/historyStorage';

export { historyStorage };

export async function ensureHistoryItem(content: ClipboardContent): Promise<ClipboardItem | null> {
  const profileHash = content.profileHash;
  if (!profileHash) return null;

  const existing = await historyStorage.getItem(profileHash);
  if (existing) return existing;

  return historyStorage.addItem(
    createDefaultClipboardItem({
      type: content.type,
      text: content.text ?? '',
      profileHash,
      hasData: content.hasData ?? false,
      dataName: content.fileName ?? undefined,
      size: content.fileSize ?? content.text?.length ?? undefined,
      fileUri: content.fileUri ?? undefined,
      localClipboardHash: content.localClipboardHash ?? undefined,
      timestamp: content.timestamp ?? Date.now(),
      syncStatus: HistorySyncStatus.LocalOnly,
      isLocalFileReady: !!content.fileUri || !(content.hasData ?? false),
      from: 'local',
    })
  );
}

export async function updateHistoryItem(
  profileHash: string,
  updates: Partial<ClipboardItem>
): Promise<boolean> {
  if (!(await historyStorage.getItem(profileHash))) return false;
  await historyStorage.updateItem(profileHash, updates);
  return true;
}
