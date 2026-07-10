export type OnboardingSlideKey = 'welcome' | 'companion' | 'lan' | 'action';

export const ONBOARDING_SLIDES: OnboardingSlideKey[] = ['welcome', 'companion', 'lan', 'action'];

export interface OnboardingScreenProps {
  /**
   * 用户结束引导时调用(无论是否扫码配对):落库 onboardingCompleted 并进入主界面。
   * 若扫码成功,凭据已由 QrScannerModal 写入 pendingConnectStore,HomeView 挂载后自行消费并弹出预填表单
   * ——是否配对不再影响导航,因此这里不需要区分。
   */
  onComplete: () => void;
}
