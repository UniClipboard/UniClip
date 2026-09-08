export interface SyncChannelConfirmationSheetProps {
  visible: boolean;
  isConfirming?: boolean;
  onDismiss: () => void;
  onConfirm: () => void | Promise<void>;
}
