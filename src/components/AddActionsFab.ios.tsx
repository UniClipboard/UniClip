import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BlurView } from 'expo-blur';
import {
  Camera,
  Image as ImageIcon,
  File as FileIcon,
  Clipboard as ClipboardIcon,
  RefreshCw,
  Plus,
} from 'lucide-react-native';
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
import { GlassContainer } from '@/components/ui';
import { iosAccent, iosColors, iosKindTints, iosSystemColor } from '@/theme/iosDesignTokens';
import { FAB_SIZE, type AddActionsFabProps } from './AddActionsFab.types';

type Row = {
  key: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  label: string;
  onPress: () => void;
};

/**
 * 右下角融合玻璃按钮:+ 与「立即同步」合并。点击弹出 Liquid Glass 悬浮菜单
 * (同层锚定浮层,非全屏 sheet,也非独立 Modal——按钮展开态仍可见,+ 转 ×)。
 */
export function AddActionsFab({
  open,
  onOpenChange,
  onTakePhoto,
  onPickImage,
  onPickFile,
  onUploadClipboard,
  onSync,
  anchor = 'end',
  horizontalInset = 16,
}: AddActionsFabProps) {
  const { t } = useTranslation('home');
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
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
  }, [open, progress, unmount]);

  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 45}deg` }],
  }));
  const popStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.9 + progress.value * 0.1 }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.18 }));

  const toggleOpen = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onOpenChange(!open);
  }, [open, onOpenChange]);

  const runItem = useCallback(
    (fn: () => void) => {
      Haptics.selectionAsync().catch(() => {});
      onOpenChange(false);
      // iOS 不能在浮层收起途中 present 系统 picker,等收起动画结束再触发
      setTimeout(fn, Platform.OS === 'ios' ? 350 : 130);
    },
    [onOpenChange]
  );

  const rows: Row[] = [
    {
      key: 'photo',
      Icon: Camera,
      color: iosKindTints.image,
      label: t('fab.takePhoto'),
      onPress: onTakePhoto,
    },
    {
      key: 'image',
      Icon: ImageIcon,
      color: iosKindTints.image,
      label: t('fab.pickImage'),
      onPress: onPickImage,
    },
    {
      key: 'file',
      Icon: FileIcon,
      color: iosKindTints.file,
      label: t('fab.pickFile'),
      onPress: onPickFile,
    },
    {
      key: 'clip',
      Icon: ClipboardIcon,
      color: iosKindTints.text,
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
        style={[s.fab, anchorStyle, { bottom: fabBottom }]}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.addContent')}
      >
        <GlassContainer shape="circle" interactive style={s.fabGlass}>
          <Animated.View style={fabIconStyle}>
            <Plus size={28} color={isDark ? iosAccent.dark : iosAccent.light} />
          </Animated.View>
        </GlassContainer>
      </Pressable>

      {mounted && (
        <Animated.View
          style={[
            s.popWrap,
            anchorStyle,
            { bottom: popBottom, transformOrigin: anchorEnd ? 'bottom right' : 'bottom left' },
            popStyle,
          ]}
        >
          <View style={s.popClip}>
            <BlurView
              intensity={90}
              tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterial'}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.popInner}>
              {rows.map((row) => (
                <Pressable
                  key={row.key}
                  onPress={() => runItem(row.onPress)}
                  style={({ pressed }) => [s.row, pressed && s.rowPressed]}
                >
                  <View style={[s.mini, { backgroundColor: row.color }]}>
                    <row.Icon size={17} color="#FFFFFF" />
                  </View>
                  <Text style={[s.label, { color: iosColors!.label }]}>{row.label}</Text>
                </Pressable>
              ))}
              <View style={[s.div, { backgroundColor: iosColors!.separator }]} />
              <Pressable
                onPress={() => runItem(onSync)}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              >
                <View
                  style={[s.mini, { backgroundColor: iosSystemColor('systemGray') ?? '#8E8E93' }]}
                >
                  <RefreshCw size={16} color="#FFFFFF" />
                </View>
                <Text style={[s.label, { color: iosColors!.label }]}>{t('fab.syncNow')}</Text>
              </Pressable>
            </View>
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
    zIndex: 20,
  },
  fabGlass: { width: FAB_SIZE, height: FAB_SIZE, justifyContent: 'center', alignItems: 'center' },
  popWrap: {
    position: 'absolute',
    width: 190,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    zIndex: 21,
  },
  popClip: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  popInner: { padding: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  rowPressed: { opacity: 0.6 },
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
