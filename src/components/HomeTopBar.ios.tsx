import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  PlatformColor,
  type ColorValue,
} from 'react-native';
import { ChevronDown, Ellipsis, ListFilter, Search, X, XCircle } from 'lucide-react-native';
import { Menu, Button as SwiftUIButton, Host } from '@expo/ui/swift-ui';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { GlassContainer } from '@/components/ui';
import { ServerStatusDot } from '@/components/ServerStatusDot';
import { iosDimensions } from '@/theme/iosDesignTokens';
import type {
  DefaultTopBarProps,
  SearchTopBarProps,
  SelectModeTopBarProps,
} from './HomeTopBar.types';
import { CONNECTION_STATUS_TEXT, type ConnectionStatus } from '@/utils/connectionStatus';
import { HistoryFilterTags } from '@/components/HistoryFilterTags';

const BTN = iosDimensions.floatingButtonSize;

// iOS 系统语义色：随浅/深色与辅助功能自动适配（记忆：iOS 必须用 PlatformColor）
const STATUS_STYLE: Record<ConnectionStatus, { color: ColorValue; pulse: boolean; glow: boolean }> =
  {
    online: { color: PlatformColor('systemGreen'), pulse: false, glow: true },
    connecting: { color: PlatformColor('systemOrange'), pulse: true, glow: false },
    offline: { color: PlatformColor('systemGray'), pulse: false, glow: false },
    error: { color: PlatformColor('systemRed'), pulse: true, glow: false },
    unconfigured: { color: PlatformColor('systemGray3'), pulse: false, glow: false },
  };

export function DefaultTopBar({
  serverLabel,
  connectionStatus,
  onSwitchServer,
  onSearch,
  onSettings,
  onSelectMode,
  theme,
}: DefaultTopBarProps) {
  const dot = STATUS_STYLE[connectionStatus];
  const dimmed = connectionStatus === 'unconfigured' || connectionStatus === 'offline';
  return (
    <View style={s.row}>
      <Pressable
        onPress={onSwitchServer}
        style={s.serverPress}
        accessibilityRole="button"
        accessibilityLabel={`切换服务器，当前${serverLabel}，${CONNECTION_STATUS_TEXT[connectionStatus]}`}
      >
        <GlassContainer shape="capsule" interactive style={s.serverPill}>
          <ServerStatusDot color={dot.color} pulse={dot.pulse} glow={dot.glow} />
          <Text
            style={[
              s.label,
              s.labelShrink,
              { color: dimmed ? theme.colors.textSecondary : theme.colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {serverLabel}
          </Text>
          <ChevronDown size={15} color={theme.colors.textSecondary} />
        </GlassContainer>
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }} />

      <View style={s.actions}>
        <Pressable onPress={onSelectMode}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{
              height: BTN,
              paddingHorizontal: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.textPrimary }}>
              选择
            </Text>
          </GlassContainer>
        </Pressable>

        <Pressable onPress={onSearch}>
          <GlassContainer
            shape="circle"
            interactive
            style={{ width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center' }}
          >
            <Search size={22} color={theme.colors.textPrimary} />
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
                <Ellipsis size={22} color={theme.colors.textPrimary} />
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
          <GlassContainer shape="capsule" style={s.searchCapsule}>
            <Search size={16} color={theme.colors.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: theme.colors.textPrimary }]}
              value={searchText}
              onChangeText={onChangeText}
              placeholder="搜索剪贴板"
              placeholderTextColor={theme.colors.textSecondary}
              autoFocus
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => onChangeText('')} hitSlop={8}>
                <XCircle size={14} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </GlassContainer>
        </Animated.View>
        <Animated.View style={closeStyle}>
          <Pressable onPress={onOpenFilters}>
            <GlassContainer shape="circle" interactive style={s.circle}>
              <ListFilter
                size={21}
                color={hasActiveFilters ? theme.colors.accent : theme.colors.textPrimary}
              />
            </GlassContainer>
          </Pressable>
        </Animated.View>
        <Animated.View style={closeStyle}>
          <Pressable onPress={onClose}>
            <GlassContainer shape="circle" interactive style={s.circle}>
              <X size={22} color={theme.colors.textPrimary} />
            </GlassContainer>
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
      <Text style={[s.selectCount, { color: theme.colors.textPrimary }]}>已选择 {count} 项</Text>
      <View style={{ flex: 1, minWidth: 0 }} />
      <View style={s.actions}>
        <Pressable onPress={onSelectAll}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{
              height: BTN,
              paddingHorizontal: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.textPrimary }}>
              {allSelected ? '取消全选' : '全选'}
            </Text>
          </GlassContainer>
        </Pressable>
        <Pressable onPress={onDone}>
          <GlassContainer
            shape="capsule"
            interactive
            style={{
              height: BTN,
              paddingHorizontal: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '500', color: theme.colors.textPrimary }}>
              完成
            </Text>
          </GlassContainer>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52 },
  serverPress: { flexShrink: 1 },
  serverPill: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  label: { fontSize: 14, fontWeight: '600' },
  labelShrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectCount: { fontSize: 14, fontWeight: '600' },
  searchWrap: { gap: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 8 },
  boxWrap: { flex: 1, transformOrigin: 'right' },
  searchCapsule: {
    height: BTN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  circle: { width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center' },
});
