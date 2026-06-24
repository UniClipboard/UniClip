/**
 * 设置页共享 Toast 上下文
 *
 * 拆分后每个 section 子组件需要弹 Toast，但不能各自持有 message 状态。
 * Provider 统一持有 message 状态并渲染单个 <MessageToast>，对外暴露一个
 * 引用恒定的 showMessage（用 ref 持最新实现），这样：
 *   - Toast 出现/消失只重渲 Provider 与 MessageToast，不波及订阅了 context 的 section。
 *   - section 子组件可安全地 memo 化，showMessage 永不变。
 */
import React, { createContext, useCallback, useContext, useRef } from 'react';
import { MessageToast, type MessageType } from '@/components';
import { useMessageToast } from '@/hooks/useMessageToast';

type ShowMessage = (text: string, type?: MessageType) => void;

const SettingsToastContext = createContext<ShowMessage>(() => {});

/** 在 section 子组件中获取稳定的 showMessage */
export function useSettingsToast(): ShowMessage {
  return useContext(SettingsToastContext);
}

export function SettingsToastProvider({ children }: { children: React.ReactNode }) {
  const { message, showMessage, handleMessageShown } = useMessageToast();

  // 用 ref 持最新 showMessage，对外暴露恒定引用，避免 toast 状态变化引起 consumer 重渲。
  const showRef = useRef(showMessage);
  showRef.current = showMessage;
  const stableShow = useCallback<ShowMessage>((text, type) => showRef.current(text, type), []);

  return (
    <SettingsToastContext.Provider value={stableShow}>
      {children}
      <MessageToast message={message} onMessageShown={handleMessageShown} />
    </SettingsToastContext.Provider>
  );
}
