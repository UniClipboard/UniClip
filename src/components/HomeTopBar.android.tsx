import React from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { TopRightMenu } from './TopRightMenu';
import { ServerStatusDot } from './ServerStatusDot';
import type {
  DefaultTopBarProps,
  SearchTopBarProps,
  SelectModeTopBarProps,
} from './HomeTopBar.types';
import { CONNECTION_STATUS_TEXT, type ConnectionStatus } from '@/utils/connectionStatus';
import { HistoryFilterTags } from '@/components/HistoryFilterTags';

// Material 语义色板：在线绿 / 连接中橙 / 离线灰 / 异常红 / 未配置浅灰
const STATUS_STYLE: Record<ConnectionStatus, { color: string; pulse: boolean; glow: boolean }> = {
  online: { color: '#4CAF50', pulse: false, glow: true },
  connecting: { color: '#FB8C00', pulse: true, glow: false },
  offline: { color: '#9E9E9E', pulse: false, glow: false },
  error: { color: '#E53935', pulse: true, glow: false },
  unconfigured: { color: '#BDBDBD', pulse: false, glow: false },
};

export function DefaultTopBar({
  serverLabel,
  connectionStatus,
  onSearch,
  onSettings,
  onSelectMode,
  theme,
}: DefaultTopBarProps) {
  const dot = STATUS_STYLE[connectionStatus];
  const dimmed = connectionStatus === 'unconfigured' || connectionStatus === 'offline';
  return (
    <View style={s.row}>
      <View
        style={s.serverStatus}
        accessibilityRole="text"
        accessibilityLabel={`服务器${CONNECTION_STATUS_TEXT[connectionStatus]}，${serverLabel}`}
      >
        <ServerStatusDot color={dot.color} pulse={dot.pulse} glow={dot.glow} />
        <Text
          style={[
            s.label,
            { color: dimmed ? theme.colors.onSurfaceVariant : theme.colors.onSurface },
          ]}
          numberOfLines={1}
        >
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
        <Pressable
          onPress={onSearch}
          style={s.iconBtn}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <Ionicons name="search" size={22} color={theme.colors.onSurface} />
        </Pressable>
        <TopRightMenu items={[{ label: '设置', onPress: onSettings }]} />
      </View>
    </View>
  );
}

export function SearchTopBar({
  searchText,
  onChangeText,
  selectedKinds,
  selectedDate,
  hasActiveFilters,
  onOpenFilters,
  onRemoveKind,
  onClearDateFilter,
  onClose,
  theme,
}: SearchTopBarProps) {
  const bg = { backgroundColor: theme.colors.surfaceContainerHigh };
  const p = useSharedValue(0);

  React.useEffect(() => {
    p.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
  }, [p]);

  const boxStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scaleX: interpolate(p.value, [0, 1], [0.35, 1]) }],
  }));
  const closeStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 1]) }],
  }));

  return (
    <View style={s.searchWrap}>
      <View style={s.searchRow}>
        <Animated.View style={[s.boxWrap, boxStyle]}>
          <View style={[s.searchBox, bg]}>
            <Ionicons name="search" size={16} color={theme.colors.onSurfaceVariant} />
            <TextInput
              style={[s.searchInput, { color: theme.colors.onSurface }]}
              value={searchText}
              onChangeText={onChangeText}
              placeholder="搜索剪贴板"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoFocus
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => onChangeText('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
        </Animated.View>
        <Animated.View style={closeStyle}>
          <Pressable onPress={onOpenFilters} style={[s.circle, bg]}>
            <Ionicons
              name={hasActiveFilters ? 'filter-circle' : 'filter-circle-outline'}
              size={21}
              color={hasActiveFilters ? theme.colors.primary : theme.colors.onSurface}
            />
          </Pressable>
        </Animated.View>
        <Animated.View style={closeStyle}>
          <Pressable onPress={onClose} style={[s.circle, bg]}>
            <Ionicons name="close" size={20} color={theme.colors.onSurface} />
          </Pressable>
        </Animated.View>
      </View>

      <HistoryFilterTags
        selectedKinds={selectedKinds}
        selectedDate={selectedDate}
        onRemoveKind={onRemoveKind}
        onClearDateFilter={onClearDateFilter}
        theme={theme}
      />
    </View>
  );
}

export function SelectModeTopBar({
  count,
  allSelected,
  onSelectAll,
  onDone,
  theme,
}: SelectModeTopBarProps) {
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
  label: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { justifyContent: 'center', alignItems: 'center' },
  selectCount: { fontSize: 14, fontWeight: '600' },
  pill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: { fontSize: 14, fontWeight: '500' },
  searchWrap: { gap: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 8 },
  boxWrap: { flex: 1, transformOrigin: 'right' },
  searchBox: {
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
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
});
