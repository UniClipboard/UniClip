import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { History, ChevronsUpDown, RefreshCw, Copy, Share2, Trash2 } from 'lucide-react-native';
import { GlassContainer } from '@/components/ui';
import { iosDimensions } from '@/theme/iosDesignTokens';
import type { DefaultBottomBarProps, SelectModeBottomBarProps } from './HomeBottomBar.types';

const BTN = iosDimensions.floatingButtonSize;

export function DefaultBottomBar({ serverLabel, isSyncing, onServerPicker, onSync, theme }: DefaultBottomBarProps) {
  const c = theme.colors.onSurface;
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }} />

      <Pressable onPress={onServerPicker}>
        <GlassContainer shape="capsule" interactive style={s.capsule}>
          <History size={18} color={c} />
          <Text style={[s.pillText, { color: c }]} numberOfLines={1}>{serverLabel}</Text>
          <ChevronsUpDown size={12} color={theme.colors.onSurfaceVariant} />
        </GlassContainer>
      </Pressable>

      <View style={{ flex: 1 }} />

      <Pressable onPress={onSync} disabled={isSyncing}>
        <GlassContainer shape="circle" interactive style={s.circle}>
          {isSyncing ? (
            <ActivityIndicator size="small" color={theme.colors.onSurfaceVariant} />
          ) : (
            <RefreshCw size={22} color={c} />
          )}
        </GlassContainer>
      </Pressable>
    </View>
  );
}

export function SelectModeBottomBar({ disabled, onCopy, onShare, onDelete, theme }: SelectModeBottomBarProps) {
  const c = disabled ? theme.colors.outline : theme.colors.onSurface;
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
          <Trash2 size={22} color={disabled ? theme.colors.outline : '#F44336'} />
        </GlassContainer>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  circle: { width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center' },
  capsule: { height: BTN, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 6 },
  pillText: { fontSize: 15, fontWeight: '500' },
  selectRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
});
