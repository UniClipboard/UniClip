import { useEffect, useState } from 'react';
import type { ClipboardItem } from '@/types/clipboard';
import { readHistoryItemText } from '@/utils/historyItemText';

/** 条目正文:先同步给出 `item.text`(预览),长文本在全文文件读出后替换为全文。 */
export function useHistoryItemText(item: ClipboardItem): string {
  const { type, text, hasData, fileUri, dataName, profileHash, timestamp, isLocalFileReady } = item;
  const key = `${profileHash}:${timestamp}:${fileUri ?? ''}:${dataName ?? ''}:${isLocalFileReady}`;
  const [full, setFull] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (type !== 'Text' || !hasData) return;
    let cancelled = false;
    void readHistoryItemText({ type, text, hasData, fileUri, dataName, profileHash }).then(
      (resolved) => {
        if (!cancelled) setFull({ key, text: resolved });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, type, text, hasData, fileUri, dataName, profileHash]);
  return full?.key === key ? full.text : text;
}
