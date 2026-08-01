import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { SelectModeBottomBarProps } from './HomeBottomBar.types';

export function SelectModeBottomBar({
  disabled,
  onCopy,
  onShare,
  onDelete,
  theme,
}: SelectModeBottomBarProps) {
  const bg = { backgroundColor: theme.colors.surfaceHigh };
  const ic = disabled ? theme.colors.border : theme.colors.textPrimary;
  return (
    <View style={s.selectRow}>
      <Pressable onPress={onCopy} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons name="copy-outline" size={20} color={ic} />
      </Pressable>
      <Pressable onPress={onShare} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons name="share-outline" size={20} color={ic} />
      </Pressable>
      <Pressable onPress={onDelete} disabled={disabled} style={[s.circle, bg]}>
        <Ionicons
          name="trash-outline"
          size={20}
          color={disabled ? theme.colors.border : '#F44336'}
        />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  selectRow: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
});
