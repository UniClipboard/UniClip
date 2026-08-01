import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Copy, Share2, Trash2 } from 'lucide-react-native';
import { GlassContainer } from '@/components/ui';
import { iosDimensions } from '@/theme/iosDesignTokens';
import type { SelectModeBottomBarProps } from './HomeBottomBar.types';

const BTN = iosDimensions.floatingButtonSize;

export function SelectModeBottomBar({
  disabled,
  onCopy,
  onShare,
  onDelete,
  theme,
}: SelectModeBottomBarProps) {
  const c = disabled ? theme.colors.border : theme.colors.textPrimary;
  return (
    <View style={s.selectRow}>
      <Pressable onPress={onCopy} disabled={disabled}>
        <GlassContainer shape="circle" interactive style={s.circle}>
          <Copy size={22} color={c} />
        </GlassContainer>
      </Pressable>
      <Pressable onPress={onShare} disabled={disabled}>
        <GlassContainer shape="circle" interactive style={s.circle}>
          <Share2 size={22} color={c} />
        </GlassContainer>
      </Pressable>
      <Pressable onPress={onDelete} disabled={disabled}>
        <GlassContainer shape="circle" interactive style={s.circle}>
          <Trash2 size={22} color={disabled ? theme.colors.border : '#F44336'} />
        </GlassContainer>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  circle: { width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center' },
  selectRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
});
