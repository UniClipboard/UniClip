import type { DeviceTrustDecisionView } from '@/features/space';

export type DeviceTrustDecisionChoice = DeviceTrustDecisionView['choices'][number]['choice'];
export type DeviceTrustDecisionOutcome =
  | 'applied'
  | 'keptCurrentDeviceGroup'
  | 'alreadyCompleted'
  | 'stateChanged'
  | 'localDeviceConfirmationRequired';

export interface DeviceTrustDecisionSession {
  view: DeviceTrustDecisionView | null;
  changeId: string | null;
  selectedChoice: DeviceTrustDecisionChoice | null;
  confirmingChoice: DeviceTrustDecisionChoice | null;
  submitting: boolean;
  error: string | null;
  outcome: DeviceTrustDecisionOutcome | null;
  choose: (choice: DeviceTrustDecisionChoice) => Promise<void>;
  proceed: () => Promise<void>;
  confirm: () => Promise<void>;
  cancelConfirmation: () => void;
  dismiss: (() => void) | null;
}
