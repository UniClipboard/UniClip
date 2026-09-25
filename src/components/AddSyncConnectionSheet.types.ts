export type AddSyncConnectionMode = 'choose' | 'create' | 'join' | 'switch' | 'invite';

export type AddSyncConnectionPreviewScenarioId =
  | 'joinPending'
  | 'joinProcessing'
  | 'joinTakingLonger'
  | 'joinCancelling'
  | 'joinFailed'
  | 'deviceUpdating'
  | 'deviceRetrying'
  | 'deviceStateRejected'
  | 'deviceRelationshipConflict'
  | 'deviceSecurityUpdateRejected'
  | 'deviceUpgradeRequired'
  | 'localIdentityMismatch'
  | 'deviceUpdated'
  | 'inviterWaiting'
  | 'invitationExpired'
  | 'inviterConnected';

export interface AddSyncConnectionSheetProps {
  visible: boolean;
  initialMode?: AddSyncConnectionMode;
  embeddedInHost?: boolean;
  persistentPresentation?: boolean;
  previewScenario?: AddSyncConnectionPreviewScenarioId;
  onClose: () => void;
  onConnected?: () => boolean | Promise<boolean>;
}
