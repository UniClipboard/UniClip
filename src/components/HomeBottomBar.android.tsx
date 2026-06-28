import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { DefaultBottomBarProps, SelectModeBottomBarProps } from './HomeBottomBar.types';

export function DefaultBottomBar({ serverLabel, isSyncing, onServerPicker, onSync, theme }: DefaultBottomBarProps) {
  const bg = { backgroundColor: theme.colors.surfaceContainerHigh };
  return (
    <View style={s.row}>
      <Pressable onPress={onServerPicker} style={[s.pill, bg]}>
        <Ionicons name="time-outline" size={16} color={theme.colors.onSurface} />
        <Text style={[s.pillText, { color: theme.colors.onSurface }]} numberOfLines={1}>{serverLabel}</Text>
        <Ionicons name="chevron-expand-outline" size={12} color={theme.colors.onSurfaceVariant} />
      </Pressable>
      <Pressable onPress={onSync} disabled={isSyncing} style={[s.circle, bg]}>
        <Ionicons name="sync" size={20} color={isSyncing ? theme.colors.onSurfaceVariant : theme.colors.onSurface} />
      </Pressable>
    </View>
  );
}

export function SelectModeBottomBar({ disabled, onCopy, onShare, onDelete, theme }: SelectModeBottomBarProps) {
  const bg = { backgroundColor: theme.colors.surfaceContainerHigh };
  const ic = disabled ? theme.colors.outline : theme.colors.onSurface;
  return (
    <View style={s.selectRow}>
      <Pressable onPress={onCopy} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons name="copy-outline" size={20} color={ic} />
      </Pressable>
      <Pressable onPress={onShare} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons name="share-outline" size={20} color={ic} />
      </Pressable>
      <Pressable onPress={onDelete} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons name="trash-outline" size={20} color={disabled ? theme.colors.outline : '#F44336'} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  pill: { flex: 1, height: 44, borderRadius: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  pillText: { fontSize: 14, fontWeight: '500' },
  selectRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
});
