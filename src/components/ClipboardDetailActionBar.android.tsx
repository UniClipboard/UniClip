import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { ClipboardDetailActionBarProps } from './ClipboardDetailActionBar.types';
import { useDetailActionBarBehavior } from './useDetailActionBarBehavior';
import { usePopoverTransition } from './usePopoverTransition';

export function ClipboardDetailActionBar({
  primary,
  quick,
  overflow,
  quickLabels,
  moreLabel,
  theme,
  popoverOpen = false,
  onPopoverOpenChange,
}: ClipboardDetailActionBarProps) {
  const { colors } = theme;
  const { compact, handleLayout } = useDetailActionBarBehavior();
  const { mounted, progress } = usePopoverTransition(popoverOpen);

  // 从三点按钮上方弹出:淡入 + 轻微上移 + 缩放(锚点右下,见 transformOrigin)。
  const popoverStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }, { scale: 0.92 + progress.value * 0.08 }],
  }));

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.container,
        { backgroundColor: colors.surfaceHigh, borderTopColor: colors.separator },
      ]}
    >
      {primary ? (
        <Pressable
          onPress={primary.onPress}
          accessibilityRole="button"
          accessibilityLabel={primary.label}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.accent, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Ionicons name={primary.icon as never} size={19} color={colors.onAccent} />
          <Text style={[styles.primaryLabel, { color: colors.onAccent }]} numberOfLines={1}>
            {primary.label}
          </Text>
        </Pressable>
      ) : null}

      {quick.map((action) => (
        <Pressable
          key={action.key}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [
            styles.secondary,
            !compact && styles.secondaryExpanded,
            { backgroundColor: colors.surfaceHighest, opacity: pressed ? 0.68 : 1 },
          ]}
        >
          <Ionicons name={action.icon as never} size={20} color={colors.textPrimary} />
          {!compact ? (
            <Text style={[styles.secondaryLabel, { color: colors.textPrimary }]} numberOfLines={1}>
              {quickLabels[action.key] ?? action.label}
            </Text>
          ) : null}
        </Pressable>
      ))}

      {overflow.length > 0 ? (
        <Pressable
          onPress={() => onPopoverOpenChange?.(!popoverOpen)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ expanded: popoverOpen }}
          accessibilityLabel={moreLabel}
          style={({ pressed }) => [
            styles.secondary,
            { backgroundColor: colors.surfaceHighest, opacity: pressed ? 0.68 : 1 },
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
        </Pressable>
      ) : null}

      {mounted ? (
        <Animated.View
          testID="detail-overflow-popover"
          style={[
            styles.overflowMenu,
            { backgroundColor: colors.surfaceHighest, borderColor: colors.separator },
            popoverStyle,
          ]}
        >
          {overflow.map((action) => {
            const color = action.destructive ? colors.error : colors.textPrimary;
            return (
              <Pressable
                key={action.key}
                onPress={() => {
                  onPopoverOpenChange?.(false);
                  action.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [styles.overflowRow, pressed && styles.rowPressed]}
              >
                <Ionicons name={action.icon as never} size={20} color={color} />
                <Text style={[styles.overflowLabel, { color }]} numberOfLines={1}>
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 3,
  },
  primary: {
    flex: 1,
    minWidth: 104,
    height: 50,
    borderRadius: 14,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryLabel: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    width: 50,
    height: 50,
    borderRadius: 14,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  secondaryExpanded: {
    width: 94,
    paddingHorizontal: 12,
  },
  secondaryLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  overflowMenu: {
    position: 'absolute',
    right: 16,
    bottom: 68,
    width: 220,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    elevation: 12,
    transformOrigin: 'bottom right',
  },
  overflowRow: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  overflowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  rowPressed: {
    opacity: 0.62,
  },
});
