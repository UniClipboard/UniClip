export type OnboardingAction = 'create' | 'join';

export interface OnboardingScreenProps {
  /** Marks onboarding complete after P2P setup succeeds. */
  onComplete: () => void | Promise<void>;
}
