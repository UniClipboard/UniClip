export type AddSyncConnectionMode = 'choose' | 'create' | 'join' | 'switch';

export interface AddSyncConnectionSheetProps {
  visible: boolean;
  initialMode?: AddSyncConnectionMode;
  embeddedInHost?: boolean;
  persistentPresentation?: boolean;
  onClose: () => void;
  onConnected?: () => boolean | Promise<boolean>;
}
