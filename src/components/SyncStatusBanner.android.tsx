import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { SyncStatusBannerProps, SyncStatusBannerVariant } from './SyncStatusBanner.types';

const ICON_NAME: Record<SyncStatusBannerVariant, keyof typeof Ionicons.glyphMap> = {
  staged: 'cloud-download-outline',
  loop: 'warning-outline',
};

export function SyncStatusBanner({
  variant,
  title,
  subtitle,
  actionLabel,
  onAction,
  isActionBusy,
  theme,
}: SyncStatusBannerProps) {
  const tint = variant === 'staged' ? theme.colors.infoContainer : theme.colors.warningContainer;
  const border =
    variant === 'staged' ? theme.colors.infoContainerBorder : theme.colors.warningContainerBorder;
  const fg = variant === 'staged' ? theme.colors.onInfoContainer : theme.colors.onWarningContainer;

  return (
    <View
      style={[
        s.container,
        {
          backgroundColor: tint,
          borderColor: border,
          borderRadius: theme.radius.lg,
          marginHorizontal: theme.spacing.base,
          ...theme.elevation.sm,
        },
      ]}
    >
      <Ionicons name={ICON_NAME[variant]} size={22} color={fg} />
      <View style={s.textCol}>
        <Text style={[s.title, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.subtitle, { color: fg }]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onAction}
        disabled={isActionBusy}
        style={({ pressed }) => [
          s.actionBtn,
          { backgroundColor: fg, opacity: pressed ? 0.8 : isActionBusy ? 0.6 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
      >
        {isActionBusy ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Text style={[s.actionText, { color: tint }]}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12.5 },
  actionBtn: {
    height: 32,
    minWidth: 64,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { fontSize: 13, fontWeight: '600' },
});
