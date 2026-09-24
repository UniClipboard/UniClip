import { Directory, File, Paths } from 'expo-file-system';
import type { PendingShareJob } from '@/features/transfer';
import type { ClipboardItem } from '@/types/clipboard';
import type { DisplayKind } from '@/utils/displayKind';

/** 应用内「发送到」为文本历史写出的临时 payload,发送页关闭后删除。 */
const SEND_TO_DIR = new Directory(Paths.cache, 'temp_files', 'send_to');

/** 这条历史当前能否发送到其他设备:文本总是可以,图片/文件需要本机已有内容。 */
export function canSendHistoryItem(item: ClipboardItem, displayKind: DisplayKind): boolean {
  if (displayKind === 'text' || displayKind === 'url') return item.text.length > 0;
  if (displayKind === 'group') return false;
  return !!item.fileUri && item.isLocalFileReady;
}

/**
 * 把一条历史转换成发送页(ShareSendSheet)的 job。带 `historyProfileHash`,
 * 发送时按原条目投递,不会重复导入历史。文本写成临时 UTF-8 文件供预览与发送读取。
 */
export function createHistorySendJob(
  item: ClipboardItem,
  displayKind: DisplayKind
): PendingShareJob | null {
  if (!canSendHistoryItem(item, displayKind)) return null;
  const id = `history-${item.profileHash}-${item.timestamp}`;
  const createdAtMs = Date.now();

  if (displayKind === 'text' || displayKind === 'url') {
    SEND_TO_DIR.create({ intermediates: true, idempotent: true });
    const file = new File(SEND_TO_DIR, `${item.profileHash}.txt`);
    if (!file.exists) file.create();
    file.write(item.text);
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

  return {
    id,
    kind: displayKind === 'image' ? 'image' : 'file',
    displayName: item.dataName || item.text,
    byteCount: item.size ?? 0,
    mimeType: null,
    fileUri: item.fileUri!,
    createdAtMs,
    historyProfileHash: item.profileHash,
  };
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

/** 删除本模块为文本写出的临时文件;图片/文件指向历史本身,不删。 */
export function releaseHistorySendJob(job: PendingShareJob): void {
  if (job.kind !== 'text') return;
  if (!job.historyProfileHash && !job.id.startsWith(SNIPPET_JOB_PREFIX)) return;
  try {
    const file = new File(job.fileUri);
    if (file.exists) file.delete();
  } catch {
    // 缓存目录由系统回收,删除失败不影响功能。
  }
}
