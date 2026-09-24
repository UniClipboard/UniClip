/**
 * useMessageToast Hook
 * 用于管理消息提示的状态和显示逻辑
 */

import { useState } from 'react';
import type { Message, MessageType } from '@/components/MessageToast.types';
import type { ShowMessageOptions } from '@/stores/messageStore';

export function useMessageToast() {
  const [message, setMessage] = useState<Message | null>(null);

  /**
   * 显示消息提示
   * @param text 消息文本
   * @param type 消息类型
   */
  const showMessage = (text: string, type: MessageType = 'info', options?: ShowMessageOptions) => {
    setMessage({ text, type, ...options });
  };

  /**
   * 消息显示完成后的回调
   */
  const handleMessageShown = () => {
    setMessage(null);
  };

  return {
    message,
    showMessage,
    handleMessageShown,
  };
}
