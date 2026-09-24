/**
 * 首页卡片长按的平台语义:
 * - select:进入多选并选中该卡(Android 惯例,配合上下文操作栏)。
 * - contextMenu:弹出锚定的预览 + 菜单浮层(iOS Context Menu 惯例)。
 */
export type HomeLongPressMode = 'select' | 'contextMenu';
