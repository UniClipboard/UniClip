export type OnboardingAction = 'create' | 'join' | 'skip';

export interface OnboardingScreenProps {
  /** Marks onboarding complete after P2P setup or an explicit skip. */
  onComplete: () => void | Promise<void>;
}
