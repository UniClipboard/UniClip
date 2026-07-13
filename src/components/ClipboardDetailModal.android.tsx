import React from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ClipboardDetailPane } from './ClipboardDetailPane';
import type { ClipboardDetailModalProps } from './ClipboardDetailModal.types';

const HORIZONTAL_MARGIN = 32;
const VERTICAL_MARGIN = 48;
const MAX_DIALOG_WIDTH = 560;
const MAX_DIALOG_HEIGHT = 720;
const BACKDROP_COLOR = 'rgba(0,0,0,0.42)';

export function ClipboardDetailModal({
  visible,
  onDismiss,
  c,
  containerColor,
}: ClipboardDetailModalProps) {
  const { width, height } = useWindowDimensions();
  const dialogWidth = Math.min(width - HORIZONTAL_MARGIN * 2, MAX_DIALOG_WIDTH);
  const dialogHeight = Math.min(height - VERTICAL_MARGIN * 2, MAX_DIALOG_HEIGHT);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onDismiss}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={c.t('detail.close')}
        />
        <View
          style={[
            styles.dialog,
            {
              width: dialogWidth,
              height: dialogHeight,
              backgroundColor: containerColor ?? c.theme.colors.surfaceHigh,
            },
          ]}
          accessibilityViewIsModal
        >
          <ClipboardDetailPane c={c} onClose={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BACKDROP_COLOR,
  },
  dialog: {
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 12,
  },
});
