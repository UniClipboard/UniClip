/**
 * 首页卡片单击 / 双击的平台语义:
 * - detail:单击打开详情,双击复制到系统剪贴板(Android)。
 * - copy:单击直接复制,不识别双击(iOS)。
 */
export type HomeCardTapMode = 'detail' | 'copy';
