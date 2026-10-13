import { File } from 'expo-file-system';
import type { ClipboardItem } from '@/types/clipboard';
import { createLogger } from '@/support/observability';

const log = createLogger('HistoryItemText');

type TextItem = Pick<ClipboardItem, 'type' | 'text' | 'hasData' | 'fileUri' | 'dataName' | 'profileHash'>;

/**
 * 长文本在历史里是「全文文件 + 200 字符预览」:`item.text` 只是预览(以 `...` 结尾)。
 * 返回全文;不是外部文本或文件读不到时返回 null。
 * 先试 `fileUri`(采集时在临时目录,入库后会被移动到历史目录而失效),再试历史目录里的文件。
 */
export async function readExternalText(item: TextItem): Promise<string | null> {
  if (item.type !== 'Text' || !item.hasData) return null;
  try {
    const candidates: string[] = [];
    if (item.fileUri) candidates.push(item.fileUri);
    if (item.dataName && item.profileHash) {
      const { getHistoryFileUri } = await import('@/platform/files');
      const historyUri = await getHistoryFileUri('Text', item.profileHash, item.dataName);
      if (historyUri) candidates.push(historyUri);
    }
    for (const uri of candidates) {
      const file = new File(uri);
      if (file.exists) return await file.text();
    }
  } catch (error) {
    log.error('Failed to read full history text:', error);
  }
  return null;
}

/** 条目正文(全文);读不到全文时退回预览,不抛错。 */
export async function readHistoryItemText(item: TextItem): Promise<string> {
  return (await readExternalText(item)) ?? item.text;
}
