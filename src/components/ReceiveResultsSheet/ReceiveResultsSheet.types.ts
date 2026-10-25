/** ReceiveResultsSheet 双端共享 Props(平台分文件约定)。
 * 弹层由 Home 层挂载(稳定宿主),`visible` 由 HomeController 驱动。 */
export interface ReceiveResultsSheetProps {
  visible: boolean;
  onClose: () => void;
}
