/** ShareSendSheet 双端共享 Props(平台分文件约定)。
 * 弹层由 Home 层挂载,`visible` 由 useShareSheetStore 驱动;
 * 「取消/完成/下滑关闭」统一经 onClose(走 controller 的平台出队语义)。 */
export interface ShareSendSheetProps {
  visible: boolean;
  onClose: () => void;
}
