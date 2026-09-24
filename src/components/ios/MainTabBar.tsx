import React, { useEffect } from 'react';
import { PlatformColor, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Clipboard, MonitorSmartphone, Search, Settings, type LucideIcon } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { GlassContainer } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { MainTabParamList } from '@/navigation/AppNavigator.types';

/** 标签栏胶囊与搜索圆钮的高度 */
export const MAIN_TAB_BAR_HEIGHT = 62;
/** 胶囊底边距安全区底边的距离(安全区不足时的下限) */
const MIN_BOTTOM_GAP = 12;

const ICONS: Record<keyof MainTabParamList, LucideIcon> = {
  Clipboard,
  Devices: MonitorSmartphone,
  Preferences: Settings,
};

/** 标签栏底边到屏幕底边的距离:贴近 home indicator,与系统 iOS 26 标签栏位置一致。 */
export function mainTabBarBottom(safeBottom: number): number {
  return Math.max(MIN_BOTTOM_GAP, safeBottom - 6);
}

/** 内容需要为标签栏留出的底部空间(含与内容之间的间隔) */
export function mainTabBarClearance(safeBottom: number): number {
  return mainTabBarBottom(safeBottom) + MAIN_TAB_BAR_HEIGHT + 16;
}

interface MainTabBarProps extends BottomTabBarProps {
  /** 首页搜索 / 多选时收起标签栏,底部让给搜索框或多选操作栏。 */
  hidden: boolean;
  /** 搜索圆钮:iOS 26 标签栏里独立于标签的搜索入口。 */
  onSearch: () => void;
}

/**
 * iOS 顶级导航(剪贴板 / 设备 / 设置):左侧 Liquid Glass 标签胶囊 + 右侧独立搜索圆钮,
 * 浮在内容之上、不占布局。作为 bottom-tabs 的自定义 tabBar,标签文字取各 Tab.Screen 的 `title`。
 */
export function MainTabBar({ state, descriptors, navigation, insets, hidden, onSearch }: MainTabBarProps) {
  const { t } = useTranslation('home');
  const { colors } = useTheme().theme;
  const visible = useSharedValue(hidden ? 0 : 1);

  useEffect(() => {
    visible.value = withTiming(hidden ? 0 : 1, { duration: 220 });
  }, [hidden, visible]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * 24 }],
  }));

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.container, { bottom: mainTabBarBottom(insets.bottom) }, containerStyle]}
    >
      <GlassContainer shape="capsule" interactive style={styles.pill}>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const name = route.name as keyof MainTabParamList;
            const Icon = ICONS[name];
            const label = descriptors[route.key].options.title ?? route.name;
            const color = focused ? colors.accent : colors.textSecondary;
            return (
              <Pressable
                key={route.key}
                testID={`main-tab-${name}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (focused || event.defaultPrevented) return;
                  Haptics.selectionAsync().catch(() => {});
                  navigation.navigate(route.name, route.params);
                }}
                style={[styles.tab, focused && styles.tabActive]}
              >
                <Icon size={24} strokeWidth={focused ? 1.9 : 1.7} color={color} />
                <Text style={[styles.label, { color }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassContainer>
      <Pressable
        testID="main-tab-search"
        accessibilityRole="button"
        accessibilityLabel={t('a11y.search')}
        onPress={onSearch}
      >
        <GlassContainer shape="circle" interactive style={styles.search}>
          <Search size={24} strokeWidth={2} color={colors.textPrimary} />
        </GlassContainer>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pill: { flex: 1, height: MAIN_TAB_BAR_HEIGHT, padding: 4 },
  tabs: { flex: 1, flexDirection: 'row', gap: 2 },
  tab: {
    flex: 1,
    borderRadius: 27,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabActive: { backgroundColor: PlatformColor('secondarySystemFill') },
  label: { fontSize: 10, lineHeight: 12, fontWeight: '600' },
  search: {
    width: MAIN_TAB_BAR_HEIGHT,
    height: MAIN_TAB_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
