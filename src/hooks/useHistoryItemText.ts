import { useEffect, useState } from 'react';
import type { ClipboardItem } from '@/types/clipboard';
import { readHistoryItemText } from '@/utils/historyItemText';

/** 条目正文:先同步给出 `item.text`(预览),长文本在全文文件读出后替换为全文。 */
export function useHistoryItemText(item: ClipboardItem): string {
  const [full, setFull] = useState<{ key: string; text: string } | null>(null);
  const key = `${item.profileHash}:${item.timestamp}:${item.fileUri ?? ''}`;
  useEffect(() => {
    if (item.type !== 'Text' || !item.hasData) return;
    let cancelled = false;
    void readHistoryItemText(item).then((text) => {
      if (!cancelled) setFull({ key, text });
    });
    return () => {
      cancelled = true;
    };
  }, [key, item.type, item.hasData]);
  return full?.key === key ? full.text : item.text;
}
