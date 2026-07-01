import type { ClipboardItem } from '@/types/clipboard';

export interface ClipboardCardMenuProps {
  item: ClipboardItem;
  cardSize: number;
  children: React.ReactNode;
}
