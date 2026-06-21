import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  type ColorValue,
} from 'react-native';

export interface AppBottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  containerColor?: ColorValue;
}

export function AppBottomSheet({
  visible,
  onDismiss,
  children,
  containerColor,
}: AppBottomSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          style={[styles.sheet, containerColor ? { backgroundColor: containerColor } : null]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C6C6C8',
    marginBottom: 12,
  },
});
