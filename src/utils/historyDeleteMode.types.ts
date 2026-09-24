/**
 * 历史删除的交互策略:
 * - undo:立即从列表隐藏,Snackbar 提供「撤销」,超时后才真正软删除(Android / M3)。
 * - immediate:直接软删除,无确认、无撤销(iOS 现状)。
 */
export type HistoryDeleteMode = 'undo' | 'immediate';
