/**
 * iOS 消息提示 — 顶部弹出式深色 toast
 *
 * 灰黑色圆角胶囊 + 白色文字,从屏幕顶端外弹簧滑入,悬停在首页顶栏下方
 * (不遮挡「选择」按钮),停留后加速滑回顶端外。设置页等场景由宿主传 topOffset。
 */
import React, { useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { duration, easing, overlayMotion } from '@/theme/motion';
import type { MessageType, MessageToastProps } from './MessageToast.types';

export type { MessageType } from './MessageToast.types';

// 首页顶栏:paddingTop insets.top+4 → 行高 52 → paddingBottom 4,再留 8 间距,
// 避免遮挡「选择」按钮那一排
const HOME_TOP_BAR_CLEARANCE = 68;

// 错误信息需要更长阅读时间
const HOLD_MS: Record<MessageType, number> = {
  success: 1600,
  error: 2600,
  info: 2000,
};

export function MessageToast({ message, onMessageShown, topOffset }: MessageToastProps) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!message) return;
    progress.setValue(0);
    Animated.sequence([
      Animated.spring(progress, {
        toValue: 1,
        ...overlayMotion.enterSpring,
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS[message.type]),
      Animated.timing(progress, {
        toValue: 0,
        duration: duration.base,
        easing: easing.accelerate,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      // 被新消息打断时不清空,让新一轮动画接管
      if (finished) onMessageShown();
    });
  }, [message, progress, onMessageShown]);

  if (!message) {
    return null;
  }

  const top = topOffset ?? insets.top + HOME_TOP_BAR_CLEARANCE;
  // 完全收起时整个胶囊(含两行文本的情况)都在屏幕上边缘之外
  const hiddenOffset = -(top + 96);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="alert"
      style={[
        styles.pill,
        {
          top,
          opacity: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [hiddenOffset, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>
        {message.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '86%',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(44, 44, 46, 0.96)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
    color: '#FFFFFF',
  },
});
