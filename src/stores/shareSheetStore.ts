import { create } from 'zustand';

interface ShareSheetState {
  visible: boolean;
  isParsing: boolean;
  sessionId: number;
  open: () => void;
  beginParsing: () => number;
  completeParsing: (sessionId: number) => void;
  failParsing: (sessionId: number) => void;
  close: () => void;
}

/**
 * 分享弹层的跨层开关:分享扩展深链(uniclipboard://share)与 Android
 * redirector 在 Android 上先调用 `beginParsing()`,页面显示解析状态；转存完成
 * 后只允许同一会话调用 `completeParsing()` 展示内容，避免旧解析重新打开新页面。
 */
export const useShareSheetStore = create<ShareSheetState>((set, get) => ({
  visible: false,
  isParsing: false,
  sessionId: 0,
  open: () => set((state) => ({ visible: true, isParsing: false, sessionId: state.sessionId + 1 })),
  beginParsing: () => {
    const sessionId = get().sessionId + 1;
    set({ visible: true, isParsing: true, sessionId });
    return sessionId;
  },
  completeParsing: (sessionId) =>
    set((state) =>
      state.sessionId === sessionId && state.visible && state.isParsing ? { isParsing: false } : {}
    ),
  failParsing: (sessionId) =>
    set((state) => (state.sessionId === sessionId ? { visible: false, isParsing: false } : {})),
  close: () =>
    set((state) => ({ visible: false, isParsing: false, sessionId: state.sessionId + 1 })),
}));
