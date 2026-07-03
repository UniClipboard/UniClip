import type { ClipboardItem } from '@/types/clipboard';
import type { CardAnchorRect } from './CardContextOverlay.types';

export interface ClipboardCardProps {
  item: ClipboardItem;
  isLatest: boolean;
  isSelected?: boolean;
  isSelectMode?: boolean;
  onPress: (item: ClipboardItem) => void;
  /** anchor 是长按瞬间卡片的窗口坐标，measure 失败时为 null */
  onLongPress?: (item: ClipboardItem, anchor: CardAnchorRect | null) => void;
  cardSize: number;
}
