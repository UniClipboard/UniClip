export type OnboardingSlideKey = 'welcome' | 'companion' | 'lan' | 'action';

export const ONBOARDING_SLIDES: OnboardingSlideKey[] = ['welcome', 'companion', 'lan', 'action'];

export interface OnboardingScreenProps {
  /**
   * 用户结束引导时调用。
   * - `paired: true`  已扫码成功(凭据已写入 pendingConnectStore),调用方应落库 onboardingCompleted
   *   并导航到配置消费页(iOS: Settings / Android: SettingsSub{sync})以弹出预填表单。
   * - `paired: false` 用户选择「暂不配对」,直接进入主界面。
   */
  onComplete: (result: { paired: boolean }) => void;
}
