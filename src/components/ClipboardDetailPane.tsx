import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getDisplayKind, formatRelativeTime, DisplayKind } from '@/utils/displayKind';
import { formatFileSize } from '@/utils';
import type { ActionMenuItem } from '@/utils/actionMenuItems';
import type { HomeController } from '@/screens/useHomeController';
import type { ClipboardItem } from '@/types/clipboard';

const KIND_ICON: Record<DisplayKind, string> = {
  text: 'document-text-outline',
  url: 'link-outline',
  image: 'image-outline',
  file: 'document-outline',
  group: 'albums-outline',
};

/**
 * Expanded 布局的详情面板。展示显式传入的 item,未传时回落到 `c.detailItem`。
 * 动作与长按上下文浮层同源(`c.makeActionGroups`),因此两处入口的可用动作与判定完全一致。
 * 面板本身用 theme.colors 中性 token 着色 —— iOS/Android 各自的色板在 token 层解析,
 * 不在此写 Platform.OS 分支。
 */
export function ClipboardDetailPane({
  c,
  item = c.detailItem,
  onClose,
}: {
  c: HomeController;
  item?: ClipboardItem | null;
  onClose?: () => void;
}) {
  const { theme } = c;
  const { colors } = theme;

  const displayKind = useMemo(() => (item ? getDisplayKind(item.type, item.text) : null), [item]);

  const actions = useMemo<ActionMenuItem[]>(() => {
    if (!item || !displayKind) return [];
    return c.makeActionGroups(item, displayKind, null).flat();
  }, [item, displayKind, c]);

  if (!item || !displayKind) {
    return (
      <View style={[styles.container, styles.placeholder]}>
        <Ionicons name="clipboard-outline" size={44} color={colors.textTertiary} />
        <Text style={[styles.placeholderTitle, { color: colors.textPrimary }]}>
          {c.t('detail.placeholderTitle')}
        </Text>
        <Text style={[styles.placeholderDesc, { color: colors.textSecondary }]}>
          {c.t('detail.placeholderDesc')}
        </Text>
      </View>
    );
  }

  const primary = actions.find((a) => a.key === 'copy');
  const secondary = actions.filter((a) => a.key !== 'copy');
  const deviceLabel = item.deviceName
    ? c.t('detail.fromDevice', { device: item.deviceName })
    : c.t('detail.unknownDevice');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.kindChip, { backgroundColor: colors.accentContainer }]}>
            <Ionicons
              name={KIND_ICON[displayKind] as never}
              size={18}
              color={colors.onAccentContainer}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.headerDevice, { color: colors.textPrimary }]} numberOfLines={1}>
              {deviceLabel}
            </Text>
            <Text style={[styles.headerMeta, { color: colors.textSecondary }]} numberOfLines={1}>
              {formatRelativeTime(item.timestamp)}
              {item.size ? ` · ${formatFileSize(item.size)}` : ''}
            </Text>
          </View>
          {onClose && (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={c.t('detail.close')}
              hitSlop={8}
              style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Preview */}
        {displayKind === 'image' && item.fileUri && item.isLocalFileReady ? (
          <View style={[styles.preview, { backgroundColor: colors.surface }]}>
            <Image source={{ uri: item.fileUri }} style={styles.image} resizeMode="contain" />
          </View>
        ) : displayKind === 'file' || displayKind === 'group' ? (
          <View style={[styles.preview, styles.filePreview, { backgroundColor: colors.surface }]}>
            <Ionicons name="document-outline" size={40} color={colors.textSecondary} />
            <Text style={[styles.fileName, { color: colors.textPrimary }]} numberOfLines={2}>
              {item.dataName || item.text}
            </Text>
          </View>
        ) : (
          <View style={[styles.preview, { backgroundColor: colors.surface }]}>
            <Text selectable style={[styles.text, { color: colors.textPrimary }]}>
              {item.text}
            </Text>
          </View>
        )}

        {/* Actions */}
        {primary && (
          <Pressable
            onPress={primary.onPress}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name={primary.icon as never} size={18} color={colors.onAccent} />
            <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>{primary.label}</Text>
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
          {c.t('detail.sectionActions')}
        </Text>
        <View style={styles.actionList}>
          {secondary.map((a) => (
            <Pressable
              key={a.key}
              onPress={a.onPress}
              style={({ pressed }) => [
                styles.actionRow,
                pressed && { backgroundColor: colors.surface },
              ]}
            >
              <Ionicons
                name={a.icon as never}
                size={20}
                color={a.destructive ? colors.error : colors.textSecondary}
              />
              <Text
                style={[
                  styles.actionLabel,
                  { color: a.destructive ? colors.error : colors.textPrimary },
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  placeholderTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  placeholderDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  kindChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  closeButtonPressed: {
    opacity: 0.55,
  },
  headerDevice: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  preview: {
    borderRadius: 14,
    padding: 16,
    minHeight: 120,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  image: {
    width: '100%',
    height: 240,
  },
  filePreview: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 4,
    marginLeft: 4,
  },
  actionList: {
    gap: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 12,
  },
  actionLabel: {
    fontSize: 15,
  },
});
