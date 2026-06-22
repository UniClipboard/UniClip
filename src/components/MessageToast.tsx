import React, { useRef } from 'react';
import { Text, StyleSheet, Animated, Platform } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, elevation } from '@/theme';

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
      style={[styles.messageContainer, { backgroundColor: bg }, { opacity: fadeAnim }]}
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
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
