import type { ClipboardItem } from '@/types/clipboard';

export interface ClipboardCardMenuProps {
  item: ClipboardItem;
  cardSize: number;
  onAction: (key: string) => void;
  children: React.ReactNode;
}
