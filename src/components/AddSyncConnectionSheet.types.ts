export type AddSyncConnectionMode = 'choose' | 'create' | 'join';

export interface AddSyncConnectionSheetProps {
  visible: boolean;
  legacyLanEligible: boolean;
  initialMode?: AddSyncConnectionMode;
  onClose: () => void;
  onOpenLegacyLan: () => void;
  onConnected?: () => boolean | Promise<boolean>;
}
