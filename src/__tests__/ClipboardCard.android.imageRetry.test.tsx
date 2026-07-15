import React from 'react';
import { Image } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { createDefaultClipboardItem } from '@/types/clipboard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      isDark: true,
      colors: {
        accent: '#8B5CF6',
        background: '#000000',
        surface: '#18181B',
        surfaceLow: '#18181B',
        textPrimary: '#FFFFFF',
        textSecondary: '#A1A1AA',
        border: '#3F3F46',
      },
    },
  }),
}));

jest.mock('@/hooks/useURLMetadata', () => ({
  useURLMetadata: () => ({ metadata: null, isLoading: false }),
}));

jest.mock('react-native-reanimated', () => {
  const reactNative = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View: reactNative.View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: unknown) => value,
  };
});

jest.mock('@expo/vector-icons/Ionicons', () => {
  const react = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return (props: Record<string, unknown>) => react.createElement(View, props);
});

jest.mock('lucide-react-native', () => {
  const react = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const Icon = (props: Record<string, unknown>) => react.createElement(View, props);
  return { ArrowDown: Icon, ArrowUp: Icon };
});

import { ClipboardCard } from '@/components/ClipboardCard.android';

const item = createDefaultClipboardItem({
  type: 'Image',
  text: 'camera-photo.jpeg',
  profileHash: 'A'.repeat(64),
  hasData: true,
  dataName: 'camera-photo.jpeg',
  size: 1024,
  timestamp: 1,
  fileUri: 'file:///data/user/0/app/files/camera-photo.jpeg',
});

describe('ClipboardCard Android image retry', () => {
  it('retries one transient local-image failure, then stops after a second failure', async () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ClipboardCard item={item} isLatest onPress={jest.fn()} onLongPress={jest.fn()} />
      );
    });

    const firstImage = renderer!.root.findByType(Image);
    expect(firstImage.props.source).toEqual({ uri: item.fileUri });

    act(() => {
      firstImage.props.onError({ nativeEvent: { error: 'transient decode failure' } });
    });
    expect(renderer!.root.findAllByType(Image)).toHaveLength(0);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const retryImage = renderer!.root.findByType(Image);
    expect(retryImage.props.source).toEqual({ uri: item.fileUri });

    await act(async () => {
      retryImage.props.onError({ nativeEvent: { error: 'permanent decode failure' } });
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(renderer!.root.findAllByType(Image)).toHaveLength(0);
  });
});
