import { create } from 'zustand';

interface ShareSheetState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

/**
 * 分享弹层的跨层开关:分享扩展深链(uniclipboard://share)与 Android
 * redirector 转存完成后调用 `open()`,Home 层挂载的 ShareSendSheet
 * 据此弹出(iOS SwiftUI BottomSheet / Android AppBottomSheet)。
 */
export const useShareSheetStore = create<ShareSheetState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}));
