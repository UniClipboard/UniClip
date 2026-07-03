import type { CardAnchorRect } from './CardContextOverlay.types';

export interface WordPickerOverlayProps {
  /** 待分词的原文（超长会在内部截断展示） */
  text: string;
  /** 触发卡片在主窗口的位置，浮层从这里生长；null 时居中淡入 */
  anchor?: CardAnchorRect | null;
  onDismiss: () => void;
}
