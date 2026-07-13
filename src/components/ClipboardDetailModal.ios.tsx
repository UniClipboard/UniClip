import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { ClipboardDetailPane } from './ClipboardDetailPane';
import type { ClipboardDetailModalProps } from './ClipboardDetailModal.types';

export function ClipboardDetailModal({
  visible,
  onDismiss,
  c,
  containerColor,
}: ClipboardDetailModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onDismiss}
    >
      <View
        style={[styles.container, { backgroundColor: containerColor ?? c.theme.colors.background }]}
      >
        <ClipboardDetailPane c={c} onClose={onDismiss} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
