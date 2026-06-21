import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  type ColorValue,
} from 'react-native';

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

// TODO: replace with SwiftUI Alert (presented via Alert.Trigger / isPresented).
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[styles.card, containerColor ? { backgroundColor: containerColor } : null]}
          onPress={() => {}}
        >
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            {dismissLabel ? (
              <Pressable
                style={styles.button}
                onPress={onDismissAction ?? onDismiss}
              >
                <Text style={styles.buttonText}>{dismissLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.button} onPress={onConfirm}>
              <Text style={[styles.buttonText, styles.confirmText]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    minWidth: 280,
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 13,
    textAlign: 'center',
    color: '#3C3C43',
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  confirmText: {
    fontWeight: '600',
  },
});
