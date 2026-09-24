import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { m3Type } from '@/theme/m3Typography';
import type { ColorScheme } from '@/theme/colors';
import { FAB_SIZE, type AddActionsFabProps } from './AddActionsFab.types';

type Item = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

// M3 Expressive FAB menu:菜单项为 56dp 高的胶囊按钮,项间距 4dp,与 FAB 间距 8dp
const ITEM_HEIGHT = 56;
const ITEM_GAP = 4;

/**
 * 首页「添加内容」FAB(Android)——M3 Expressive FAB menu。
 *
 * 收起态:primaryContainer 底的 56dp FAB(16dp 圆角)。展开态:FAB 变为 primary 底的关闭按钮
 * (+ 旋转成 ×),其上方按次序弹出胶囊形菜单项(图标 + 文字,primaryContainer 底)。
 * 同步不在添加菜单里——下拉刷新已触发同步,与「添加内容」语义无关。
 * 同层浮层实现(非独立 Modal 窗口),FAB 在展开态仍可见可点;硬件返回键优先收起。
 */
export function AddActionsFab({
  open,
  onOpenChange,
  onTakePhoto,
  onPickImage,
  onPickFile,
  onUploadClipboard,
  theme,
  anchor = 'end',
  horizontalInset = 16,
}: AddActionsFabProps) {
  const { t } = useTranslation('home');
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const anchorEnd = anchor === 'end';
  const anchorStyle = anchorEnd ? { right: horizontalInset } : { left: horizontalInset };
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withSpring(1, { damping: 22, stiffness: 260, mass: 0.8 });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (f) => {
        if (f) scheduleOnRN(unmount);
      });
    }
    // mounted 不入依赖:开→挂载,关→播完退场再卸载
  }, [open, progress, unmount]);

  useEffect(() => {
    if (!open) return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => h.remove();
  }, [open, onOpenChange]);

  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 45}deg` }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.32 }));

  const toggleOpen = useCallback(() => {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => {});
    onOpenChange(!open);
  }, [open, onOpenChange]);

  const runItem = useCallback(
    (fn: () => void) => {
      onOpenChange(false);
      // 收起动画同时触发系统 picker;Android intent 是新 activity,短延迟即可
      setTimeout(fn, 130);
    },
    [onOpenChange]
  );

  // 自下而上的视觉顺序:离 FAB 最近的是最常用的「上传剪贴板」
  const items: Item[] = [
    { key: 'photo', icon: 'camera-outline', label: t('fab.takePhoto'), onPress: onTakePhoto },
    { key: 'image', icon: 'image-outline', label: t('fab.pickImage'), onPress: onPickImage },
    { key: 'file', icon: 'document-outline', label: t('fab.pickFile'), onPress: onPickFile },
    {
      key: 'clip',
      icon: 'clipboard-outline',
      label: t('fab.uploadClipboard'),
      onPress: onUploadClipboard,
    },
  ];

  const fabBottom = insets.bottom + 12;
  const menuBottom = fabBottom + FAB_SIZE + 8;

  return (
    <>
      {mounted && (
        <>
          <Animated.View
            style={[StyleSheet.absoluteFill, s.scrim, scrimStyle]}
            pointerEvents="none"
          />
          <Pressable
            style={[StyleSheet.absoluteFill, s.scrimTouch]}
            onPress={() => onOpenChange(false)}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.closeMenu')}
          />
          <View
            accessibilityRole="menu"
            style={[
              s.menu,
              anchorStyle,
              { bottom: menuBottom, alignItems: anchorEnd ? 'flex-end' : 'flex-start' },
            ]}
            pointerEvents="box-none"
          >
            {items.map((item, index) => (
              <MenuItem
                key={item.key}
                item={item}
                // 越靠近 FAB 越先出现
                order={items.length - 1 - index}
                progress={progress}
                colors={colors}
                onPress={() => runItem(item.onPress)}
              />
            ))}
          </View>
        </>
      )}

      <View style={[s.fabWrap, anchorStyle, { bottom: fabBottom }]}>
        <Pressable
          testID="home-add-fab"
          onPress={toggleOpen}
          android_ripple={{ color: colors.fillSecondary as string }}
          style={[s.fab, { backgroundColor: open ? colors.accent : colors.accentContainer }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? t('a11y.closeMenu') : t('a11y.addContent')}
        >
          <Animated.View style={fabIconStyle}>
            <Ionicons
              name="add"
              size={24}
              color={open ? colors.onAccent : colors.onAccentContainer}
            />
          </Animated.View>
        </Pressable>
      </View>
    </>
  );
}

function MenuItem({
  item,
  order,
  progress,
  colors,
  onPress,
}: {
  item: Item;
  order: number;
  progress: SharedValue<number>;
  colors: ColorScheme;
  onPress: () => void;
}) {
  // 逐项错峰:每项占用 progress 的一段区间
  const style = useAnimatedStyle(() => {
    const start = order * 0.12;
    const local = Math.min(1, Math.max(0, (progress.value - start) / (1 - start)));
    return {
      opacity: local,
      transform: [{ translateY: (1 - local) * 16 }, { scale: 0.92 + local * 0.08 }],
    };
  });
  return (
    <Animated.View style={[s.itemWrap, style]}>
      <Pressable
        testID={`home-add-${item.key}`}
        onPress={onPress}
        android_ripple={{ color: colors.fillSecondary as string }}
        accessibilityRole="menuitem"
        accessibilityLabel={item.label}
        style={[s.item, { backgroundColor: colors.accentContainer }]}
      >
        <Ionicons name={item.icon} size={24} color={colors.onAccentContainer} />
        <Text style={[s.itemLabel, { color: colors.onAccentContainer }]} numberOfLines={1}>
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: '#000000', zIndex: 15 },
  scrimTouch: { zIndex: 16 },
  menu: {
    position: 'absolute',
    gap: ITEM_GAP,
    zIndex: 21,
  },
  itemWrap: {
    borderRadius: ITEM_HEIGHT / 2,
    overflow: 'hidden',
    elevation: 3,
  },
  item: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 24,
  },
  itemLabel: {
    ...m3Type.titleMedium,
  },
  fabWrap: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 3,
    zIndex: 20,
  },
  fab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
