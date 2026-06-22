import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ellipsis } from 'lucide-react-native';
import { Menu, Button as SwiftUIButton, Host } from '@expo/ui/swift-ui';
import { GlassContainer } from '@/components/ui';
import { iosDimensions } from '@/theme/iosDesignTokens';
import type { DefaultTopBarProps, SelectModeTopBarProps } from './HomeTopBar.types';

const BTN = iosDimensions.floatingButtonSize;

export function DefaultTopBar({ serverLabel, isConnected, onSettings, onSelectMode, theme }: DefaultTopBarProps) {
  return (
    <View style={s.row}>
      <View style={s.serverStatus}>
        <View style={[s.dot, { backgroundColor: isConnected ? '#34C759' : '#9E9E9E' }]} />
        <Text style={[s.label, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {serverLabel}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }} />

      <View style={s.actions}>
        <Pressable onPress={onSelectMode}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{ height: BTN, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.onSurface }}>选择</Text>
          </GlassContainer>
        </Pressable>

        <Host style={{ width: BTN, height: BTN }}>
          <Menu
            label={
              <GlassContainer
                shape="circle"
                interactive
                style={{ width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center' }}
              >
                <Ellipsis size={22} color={theme.colors.onSurface} />
              </GlassContainer>
            }
          >
            <SwiftUIButton systemImage="gearshape" label="设置" onPress={onSettings} />
          </Menu>
        </Host>
      </View>
    </View>
  );
}

export function SelectModeTopBar({ count, allSelected, onSelectAll, onDone, theme }: SelectModeTopBarProps) {
  return (
    <View style={s.row}>
      <Text style={[s.selectCount, { color: theme.colors.onSurface }]}>已选择 {count} 项</Text>
      <View style={{ flex: 1, minWidth: 0 }} />
      <View style={s.actions}>
        <Pressable onPress={onSelectAll}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{ height: BTN, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.onSurface }}>
              {allSelected ? '取消全选' : '全选'}
            </Text>
          </GlassContainer>
        </Pressable>
        <Pressable onPress={onDone}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{ height: BTN, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.onSurface }}>完成</Text>
          </GlassContainer>
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
});
