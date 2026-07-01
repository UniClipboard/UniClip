import type { ClipboardItem } from '@/types/clipboard';

export interface ClipboardCardProps {
  item: ClipboardItem;
  isLatest: boolean;
  isSelected?: boolean;
  isSelectMode?: boolean;
  onPress: (item: ClipboardItem) => void;
  onLongPress?: (item: ClipboardItem) => void;
  cardSize: number;
}
