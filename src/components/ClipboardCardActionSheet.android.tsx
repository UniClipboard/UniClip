import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/hooks/useTheme';
import { getDisplayKind, getDisplayKindLabel, getDisplayKindColor } from '@/utils/displayKind';
import type { ClipboardCardActionSheetProps } from './ClipboardCardActionSheet.types';

export function ClipboardCardActionSheet({
  visible,
  item,
  displayKind,
  onDismiss,
  actions,
}: ClipboardCardActionSheetProps) {
  const { theme } = useTheme();

  if (!visible || !item) return null;

  const kindLabel = displayKind ? getDisplayKindLabel(displayKind) : '';
  const kindColor = displayKind ? getDisplayKindColor(displayKind) : theme.colors.primary;
  const isImage = displayKind === 'image' && item.isLocalFileReady && item.fileUri;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={s.backdrop} onPress={onDismiss}>
        <View />
      </Pressable>
      <View style={[s.sheet, { backgroundColor: theme.colors.surface }]}>
        <View style={s.handleRow}>
          <View style={[s.handle, { backgroundColor: theme.colors.outlineVariant }]} />
        </View>

        {/* Preview header */}
        <View style={s.previewRow}>
          {isImage ? (
            <Image source={{ uri: item.fileUri }} style={s.previewImage} resizeMode="cover" />
          ) : (
            <View style={[s.previewIconBox, { backgroundColor: kindColor + '1A' }]}>
              <Ionicons
                name={displayKind === 'url' ? 'globe-outline' : displayKind === 'file' ? 'document' : displayKind === 'group' ? 'folder' : 'document-text'}
                size={20}
                color={kindColor}
              />
            </View>
          )}
          <View style={s.previewInfo}>
            <Text style={[s.previewKind, { color: theme.colors.onSurfaceVariant }]}>{kindLabel}</Text>
            <Text style={[s.previewText, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {item.dataName || item.text || '(空)'}
            </Text>
          </View>
        </View>

        <View style={[s.divider, { backgroundColor: theme.colors.outlineVariant }]} />

        {/* Action items */}
        {actions.map((action) => {
          if (action.key === 'divider') {
            return <View key="divider" style={[s.divider, { backgroundColor: theme.colors.outlineVariant }]} />;
          }
          const color = action.destructive ? theme.colors.error : theme.colors.onSurface;
          return (
            <Pressable
              key={action.key}
              onPress={() => {
                onDismiss();
                action.onPress();
              }}
              style={({ pressed }) => [s.actionRow, pressed && { backgroundColor: theme.colors.surfaceContainerHigh ?? 'rgba(0,0,0,0.05)' }]}
            >
              <Ionicons name={action.icon as any} size={22} color={color} />
              <Text style={[s.actionLabel, { color }]}>{action.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  previewImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  previewIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInfo: {
    flex: 1,
    gap: 2,
  },
  previewKind: {
    fontSize: 11,
  },
  previewText: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    marginHorizontal: 8,
  },
  actionLabel: {
    fontSize: 16,
  },
});
