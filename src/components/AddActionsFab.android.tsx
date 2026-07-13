import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, BackHandler, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getDisplayKindColor } from '@/utils/displayKind';
import { FAB_SIZE, type AddActionsFabProps } from './AddActionsFab.types';

type Row = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
};

/**
 * 右下角融合操作按钮:+ 与「立即同步」合并为单一入口。
 * 点击弹出锚定悬浮菜单(同层浮层,非全屏 sheet,也非独立 Modal 窗口——
 * 这样按钮本身在展开态仍可见:+ 旋转成 ×,可再点收起)。网格在其后仍可见。
 */
export function AddActionsFab({
  open,
  onOpenChange,
  onTakePhoto,
  onPickImage,
  onPickFile,
  onUploadClipboard,
  onSync,
  theme,
  anchor = 'end',
  horizontalInset = 16,
}: AddActionsFabProps) {
  const { t } = useTranslation('home');
  const insets = useSafeAreaInsets();
  const anchorEnd = anchor === 'end';
  // 贴右→菜单向左上展开;贴左→向右上展开(缩放锚点随之翻转)。
  const anchorStyle = anchorEnd ? { right: horizontalInset } : { left: horizontalInset };
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withSpring(1, { damping: 18, stiffness: 240, mass: 0.7 });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (f) => {
        if (f) scheduleOnRN(unmount);
      });
    }
    // mounted 不入依赖:开→挂载,关→播完退场再卸载
  }, [open, progress, unmount]);

  // 展开时硬件返回键优先收起菜单
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
  const popStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.9 + progress.value * 0.1 }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.28 }));

  const toggleOpen = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onOpenChange(!open);
  }, [open, onOpenChange]);

  const runItem = useCallback(
    (fn: () => void) => {
      Haptics.selectionAsync().catch(() => {});
      onOpenChange(false);
      // 收起动画同时触发系统 picker;Android intent 是新 activity,短延迟即可
      setTimeout(fn, Platform.OS === 'ios' ? 350 : 130);
    },
    [onOpenChange]
  );

  const rows: Row[] = [
    {
      key: 'photo',
      icon: 'camera',
      color: getDisplayKindColor('image'),
      label: t('fab.takePhoto'),
      onPress: onTakePhoto,
    },
    {
      key: 'image',
      icon: 'image',
      color: getDisplayKindColor('image'),
      label: t('fab.pickImage'),
      onPress: onPickImage,
    },
    {
      key: 'file',
      icon: 'document',
      color: getDisplayKindColor('file'),
      label: t('fab.pickFile'),
      onPress: onPickFile,
    },
    {
      key: 'clip',
      icon: 'clipboard',
      color: getDisplayKindColor('text'),
      label: t('fab.uploadClipboard'),
      onPress: onUploadClipboard,
    },
  ];

  const fabBottom = insets.bottom + 12;
  const popBottom = fabBottom + FAB_SIZE + 12;

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
        </>
      )}

      <Pressable
        onPress={toggleOpen}
        style={[s.fab, anchorStyle, { bottom: fabBottom, backgroundColor: theme.colors.accent }]}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.addContent')}
      >
        <Animated.View style={fabIconStyle}>
          <Ionicons name="add" size={28} color={theme.colors.onAccent} />
        </Animated.View>
      </Pressable>

      {mounted && (
        <Animated.View
          style={[
            s.pop,
            anchorStyle,
            {
              bottom: popBottom,
              backgroundColor: theme.colors.surfaceHigh,
              transformOrigin: anchorEnd ? 'bottom right' : 'bottom left',
            },
            popStyle,
          ]}
        >
          {rows.map((row) => (
            // 每行套一层 overflow:hidden 圆角裁剪:android_ripple 默认按行矩形边界扩散,
            // 不跟随圆角;用圆角裁剪容器把波纹裁成 borderRadius 的形状,避免方波纹溢出。
            <View key={row.key} style={s.rowClip}>
              <Pressable
                onPress={() => runItem(row.onPress)}
                android_ripple={{ color: theme.colors.separator }}
                style={s.row}
              >
                <View style={[s.mini, { backgroundColor: row.color }]}>
                  <Ionicons name={row.icon} size={18} color="#FFFFFF" />
                </View>
                <Text style={[s.label, { color: theme.colors.textPrimary }]}>{row.label}</Text>
              </Pressable>
            </View>
          ))}
          <View style={[s.div, { backgroundColor: theme.colors.separator }]} />
          <View style={s.rowClip}>
            <Pressable
              onPress={() => runItem(onSync)}
              android_ripple={{ color: theme.colors.separator }}
              style={s.row}
            >
              <View style={[s.mini, { backgroundColor: theme.colors.textSecondary }]}>
                <Ionicons name="sync" size={18} color={theme.colors.surface} />
              </View>
              <Text style={[s.label, { color: theme.colors.textPrimary }]}>{t('fab.syncNow')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: '#000000', zIndex: 15 },
  scrimTouch: { zIndex: 16 },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: 18,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    zIndex: 20,
  },
  pop: {
    position: 'absolute',
    width: 186,
    borderRadius: 18,
    borderCurve: 'continuous',
    padding: 6,
    elevation: 10,
    zIndex: 21,
  },
  rowClip: {
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  mini: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: { fontSize: 14, fontWeight: '600' },
  div: { height: StyleSheet.hairlineWidth, marginVertical: 5, marginHorizontal: 8 },
});
