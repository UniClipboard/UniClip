export type MessageType = 'success' | 'error' | 'info';

export interface Message {
  text: string;
  type: MessageType;
}

export interface MessageToastProps {
  message: Message | null;
  /** 动画播完(或被打断)后回调,宿主借此清空 message 状态 */
  onMessageShown: () => void;
  /**
   * toast 顶边距所在容器顶部的距离。不传时按「无导航头的全屏场景」自取平台默认
   * (含状态栏高度);设置页等 scene 在原生导航头下方的场景应传入小偏移。
   */
  topOffset?: number;
}
