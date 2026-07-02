import React, { useRef } from 'react';
import { Text, StyleSheet, Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, elevation } from '@/theme';

// Android 悬浮底部条(HomeBottomBar)高度约 64(10 paddingTop + 44 内容 + 10 paddingBottom)+ 安全区,
// Snackbar 需悬浮在其上方,并留出与它一致的间距。设置页等无底部条的场景也用同一偏移,观感统一。
const ANDROID_TOAST_BOTTOM_OFFSET = 76;

export type MessageType = 'success' | 'error' | 'info';

interface Message {
  text: string;
  type: MessageType;
}

interface MessageToastProps {
  message: Message | null;
  onMessageShown: () => void;
}

export function MessageToast({ message, onMessageShown }: MessageToastProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (message) {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1400),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onMessageShown();
      });
    }
  }, [message, fadeAnim, onMessageShown]);

  if (!message) {
    return null;
  }

  const isIOS = Platform.OS === 'ios';

  if (isIOS) {
    const bg =
      message.type === 'error' ? '#F44336' : '#34C759';
    return (
      <Animated.View
        style={[
          styles.iosToast,
          { backgroundColor: bg, opacity: fadeAnim },
        ]}
      >
        <Text style={styles.iosToastText}>{message.text}</Text>
      </Animated.View>
    );
  }

  const bg =
    message.type === 'error'
      ? theme.colors.errorContainer
      : theme.colors.inverseSurface;
  const fg =
    message.type === 'error' ? theme.colors.onErrorContainer : theme.colors.inverseOnSurface;

  return (
    <Animated.View
      style={[
        styles.messageContainer,
        { backgroundColor: bg, bottom: insets.bottom + ANDROID_TOAST_BOTTOM_OFFSET },
        { opacity: fadeAnim },
      ]}
    >
      <Text style={[styles.messageText, { color: fg }]}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // iOS: green/red capsule, white text, bottom-anchored
  iosToast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosToastText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // Android: M3 Snackbar
  messageContainer: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.md,
  },
  messageText: {
    fontSize: typography.subhead.fontSize,
    fontWeight: '500',
  },
});
