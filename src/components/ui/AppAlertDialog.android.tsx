import { AlertDialog, TextButton, Text as ComposeText } from '@expo/ui/jetpack-compose';
import type { ColorValue } from 'react-native';

export interface AppAlertDialogProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  dismissLabel?: string;
  onDismissAction?: () => void;
  containerColor?: ColorValue;
}

export function AppAlertDialog({
  visible,
  onDismiss,
  title,
  message,
  confirmLabel,
  onConfirm,
  dismissLabel,
  onDismissAction,
  containerColor,
}: AppAlertDialogProps) {
  if (!visible) return null;
  return (
    <AlertDialog
      onDismissRequest={onDismiss}
      colors={containerColor ? { containerColor } : undefined}
    >
      <AlertDialog.Title>
        <ComposeText>{title}</ComposeText>
      </AlertDialog.Title>
      {message ? (
        <AlertDialog.Text>
          <ComposeText>{message}</ComposeText>
        </AlertDialog.Text>
      ) : null}
      <AlertDialog.ConfirmButton>
        <TextButton onClick={onConfirm}>
          <ComposeText>{confirmLabel}</ComposeText>
        </TextButton>
      </AlertDialog.ConfirmButton>
      {dismissLabel ? (
        <AlertDialog.DismissButton>
          <TextButton onClick={onDismissAction ?? onDismiss}>
            <ComposeText>{dismissLabel}</ComposeText>
          </TextButton>
        </AlertDialog.DismissButton>
      ) : null}
    </AlertDialog>
  );
}
