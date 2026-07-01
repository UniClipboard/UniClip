import React from 'react';
import { View, Text, Image, StyleSheet, Pressable, PlatformColor } from 'react-native';
import {
  Copy,
  TextCursor,
  ClipboardType,
  ExternalLink,
  ImageDown,
  FileDown,
  Share2,
  CircleCheck,
  Trash2,
  File,
  FolderOpen,
  Globe,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react-native';
import { AppBottomSheet } from '@/components/ui';
import { getDisplayKindLabel } from '@/utils/displayKind';
import { iosColors, iosKindTints, hexToRgba } from '@/theme/iosDesignTokens';
import type { ClipboardCardActionSheetProps } from './ClipboardCardActionSheet.types';

const ACTION_ICONS: Record<string, LucideIcon> = {
  copy: Copy,
  selectText: TextCursor,
  copyPlain: ClipboardType,
  openBrowser: ExternalLink,
  saveImage: ImageDown,
  saveFile: FileDown,
  share: Share2,
  select: CircleCheck,
  delete: Trash2,
};

const KIND_ICONS = {
  text: FileText,
  url: Globe,
  image: ImageIcon,
  file: File,
  group: FolderOpen,
} as const;

export function ClipboardCardActionSheet({
  visible,
  item,
  displayKind,
  onDismiss,
  actions,
}: ClipboardCardActionSheetProps) {
  if (!visible || !item || !displayKind) return null;

  const kindLabel = getDisplayKindLabel(displayKind);
  const kindColor = iosKindTints[displayKind];
  const KindIcon = KIND_ICONS[displayKind];
  const isImage = displayKind === 'image' && item.isLocalFileReady && item.fileUri;

  return (
    <AppBottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={s.previewRow}>
        {isImage ? (
          <Image source={{ uri: item.fileUri }} style={s.previewImage} resizeMode="cover" />
        ) : (
          <View style={[s.previewIconBox, { backgroundColor: hexToRgba(kindColor, 0.12) }]}>
            <KindIcon size={20} color={kindColor} />
          </View>
        )}
        <View style={s.previewInfo}>
          <Text style={[s.previewKind, { color: iosColors!.secondaryLabel }]}>{kindLabel}</Text>
          <Text style={[s.previewText, { color: iosColors!.label }]} numberOfLines={1}>
            {item.dataName || item.text || '(空)'}
          </Text>
        </View>
      </View>

      <View style={[s.divider, { backgroundColor: iosColors!.separator }]} />

      {actions.map((action) => {
        if (action.key === 'divider') {
          return (
            <View key="divider" style={[s.divider, { backgroundColor: iosColors!.separator }]} />
          );
        }
        const Icon = ACTION_ICONS[action.key] ?? Copy;
        const color = action.destructive ? PlatformColor('systemRed') : iosColors!.label;
        return (
          <Pressable
            key={action.key}
            onPress={() => {
              onDismiss();
              action.onPress();
            }}
            style={({ pressed }) => [
              s.actionRow,
              pressed && { backgroundColor: iosColors!.tertiarySystemFill },
            ]}
          >
            <Icon size={22} color={color} />
            <Text style={[s.actionLabel, { color }]}>{action.label}</Text>
          </Pressable>
        );
      })}
    </AppBottomSheet>
  );
}

const s = StyleSheet.create({
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 8,
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
    marginVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionLabel: {
    fontSize: 16,
  },
});
