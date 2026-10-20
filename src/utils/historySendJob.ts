import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { historyStorage } from '@/features/history/commands';
import type { PendingShareJob } from '@/features/transfer';
import type { ClipboardItem } from '@/types/clipboard';
import type { DisplayKind } from '@/utils/displayKind';
import { readHistoryItemText } from '@/utils/historyItemText';

/** Each File/Image job owns a payload copy until its presenting screen closes. */
const SEND_TO_DIR = new Directory(Paths.cache, 'temp_files', 'send_to');

/** 这条历史当前能否发送到其他设备:文本总是可以,图片/文件需要本机已有内容。 */
export function canSendHistoryItem(item: ClipboardItem, displayKind: DisplayKind): boolean {
  if (displayKind === 'text' || displayKind === 'url') return item.text.length > 0;
  if (displayKind === 'group') return false;
  return !!item.fileUri && item.isLocalFileReady;
}

/**
 * 把一条历史转换成发送页(ShareSendSheet)的 job。带 `historyProfileHash`,
 * Each job keeps its payload until the presenting screen releases it.
 */
export async function createHistorySendJob(
  item: ClipboardItem,
  displayKind: DisplayKind
): Promise<PendingShareJob | null> {
  if (!canSendHistoryItem(item, displayKind)) return null;
  const id = `history-${item.profileHash}-${item.timestamp}`;
  const createdAtMs = Date.now();

  if (displayKind === 'text' || displayKind === 'url') {
    SEND_TO_DIR.create({ intermediates: true, idempotent: true });
    const file = new File(SEND_TO_DIR, `${item.profileHash}.txt`);
    if (!file.exists) file.create();
    file.write(await readHistoryItemText(item));
    return {
      id,
      kind: 'text',
      displayName: item.dataName || 'text.txt',
      byteCount: file.size,
      mimeType: 'text/plain',
      fileUri: file.uri,
      createdAtMs,
      historyProfileHash: item.profileHash,
    };
  }

  SEND_TO_DIR.create({ intermediates: true, idempotent: true });
  const suffix = item.dataName?.match(/\.[^.]{1,16}$/)?.[0] ?? '';
  const file = new File(SEND_TO_DIR, `${randomUUID()}${suffix}`);
  try {
    const current = await historyStorage.copyItemPayload(item.profileHash, file.uri);
    if (!current) return null;
    return {
      id,
      kind: displayKind === 'image' ? 'image' : 'file',
      displayName: current.dataName || current.text,
      byteCount: file.size ?? current.size ?? 0,
      mimeType: null,
      fileUri: file.uri,
      createdAtMs,
      historyProfileHash: current.profileHash,
    };
  } catch (error) {
    // A failed copy may have created part of the destination.
    try {
      if (file.exists) file.delete();
    } catch {
      // Keep the original copy error.
    }
    throw error;
  }
}

const SNIPPET_JOB_PREFIX = 'snippet-';

/**
 * 把一段任意文本(如分词选择的结果)转换成发送页的 job。不带 `historyProfileHash`,
 * 发送时先导入历史再投递,与外部分享进来的文本同一路径。空白文本返回 null。
 */
export function createTextSendJob(text: string): PendingShareJob | null {
  if (!text.trim()) return null;
  const createdAtMs = Date.now();
  const id = `${SNIPPET_JOB_PREFIX}${createdAtMs}`;
  SEND_TO_DIR.create({ intermediates: true, idempotent: true });
  const file = new File(SEND_TO_DIR, `${id}.txt`);
  if (!file.exists) file.create();
  file.write(text);
  return {
    id,
    kind: 'text',
    displayName: 'text.txt',
    byteCount: file.size,
    mimeType: 'text/plain',
    fileUri: file.uri,
    createdAtMs,
  };
}

/** Release only temporary files owned by this module. */
export function releaseHistorySendJob(job: PendingShareJob): void {
  if (!job.historyProfileHash && !job.id.startsWith(SNIPPET_JOB_PREFIX)) return;
  if (!job.fileUri.startsWith(`${SEND_TO_DIR.uri.replace(/\/$/, '')}/`)) return;
  try {
    const file = new File(job.fileUri);
    if (file.exists) file.delete();
  } catch {
    // 缓存目录由系统回收,删除失败不影响功能。
  }
}
