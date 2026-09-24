/** ShareSendSheet 双端共享 Props(平台分文件约定)。
 * 弹层由 Home 层挂载,`visible` 由 useShareSheetStore 驱动;
 * 「取消/完成/下滑关闭」统一经 onClose(走 controller 的平台出队语义)。 */
import type { PendingShareJob } from '@/features/transfer';

export interface ShareSendSheetProps {
  visible: boolean;
  onClose: () => void;
  /** App-provided files are retained and cleaned up by the presenting screen. */
  jobs?: PendingShareJob[];
  /** 页面标题;默认「分享」。应用内「发送到」传入自己的标题。 */
  title?: string;
  /** iOS: reuse the stable screen's SwiftUI host. */
  embeddedInHost?: boolean;
}
