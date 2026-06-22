import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { TopRightMenu } from './TopRightMenu';
import type { DefaultTopBarProps, SelectModeTopBarProps } from './HomeTopBar.types';

export function DefaultTopBar({ serverLabel, isConnected, onSettings, onSelectMode, theme }: DefaultTopBarProps) {
  return (
    <View style={s.row}>
      <View style={s.serverStatus}>
        <View style={[s.dot, { backgroundColor: isConnected ? '#4CAF50' : '#9E9E9E' }]} />
        <Text style={[s.label, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {serverLabel}
        </Text>
      </View>
      <View style={s.actions}>
        <Pressable
          onPress={onSelectMode}
          style={[s.pill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[s.pillText, { color: theme.colors.onSurface }]}>选择</Text>
        </Pressable>
        <TopRightMenu items={[{ label: '设置', onPress: onSettings }]} />
      </View>
    </View>
  );
}

export function SelectModeTopBar({ count, allSelected, onSelectAll, onDone, theme }: SelectModeTopBarProps) {
  return (
    <View style={s.row}>
      <Text style={[s.selectCount, { color: theme.colors.onSurface }]}>已选择 {count} 项</Text>
      <View style={s.actions}>
        <Pressable
          onPress={onSelectAll}
          style={[s.pill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[s.pillText, { color: theme.colors.onSurface }]}>
            {allSelected ? '取消全选' : '全选'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          style={[s.pill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[s.pillText, { color: theme.colors.onSurface }]}>完成</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52 },
  serverStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectCount: { fontSize: 14, fontWeight: '600' },
  pill: { height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
});
