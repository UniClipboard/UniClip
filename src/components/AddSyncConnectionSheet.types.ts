export type AddSyncConnectionMode = 'choose' | 'create' | 'join';

export interface AddSyncConnectionSheetProps {
  visible: boolean;
  initialMode?: AddSyncConnectionMode;
  embeddedInHost?: boolean;
  onClose: () => void;
  onConnected?: () => boolean | Promise<boolean>;
}
