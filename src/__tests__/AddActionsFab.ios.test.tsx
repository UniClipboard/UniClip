import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type NativeButtonProps = {
  label: string;
  systemImage: string;
  onPress: () => void;
};

const mockButtonProps: NativeButtonProps[] = [];
const mockSelectionAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('@expo/ui/swift-ui', () => {
  const react = require('react') as typeof import('react');
  return {
    Host: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
    Menu: ({ children, label }: { children?: React.ReactNode; label: React.ReactNode }) =>
      react.createElement(react.Fragment, null, label, children),
    Button: (props: NativeButtonProps) => {
      mockButtonProps.push(props);
      return null;
    },
    Divider: () => null,
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: () => mockSelectionAsync(),
}));

jest.mock('lucide-react-native', () => ({
  Plus: () => null,
}));

jest.mock('@/components/ui', () => {
  const react = require('react') as typeof import('react');
  return {
    GlassContainer: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  };
});

jest.mock('@/theme/iosDesignTokens', () => ({
  iosAccent: { light: '#007AFF', dark: '#0A84FF' },
}));

import { AddActionsFab } from '../components/AddActionsFab.ios';

const theme = {
  colors: {
    accent: '#007AFF',
    onAccent: '#FFFFFF',
  },
} as never;

describe('AddActionsFab iOS native menu', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockButtonProps.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders every action as a native SwiftUI button with an SF Symbol', () => {
    act(() => {
      TestRenderer.create(
        <AddActionsFab
          open={false}
          onOpenChange={jest.fn()}
          onTakePhoto={jest.fn()}
          onPickImage={jest.fn()}
          onPickFile={jest.fn()}
          onUploadClipboard={jest.fn()}
          onSync={jest.fn()}
          theme={theme}
        />
      );
    });

    expect(mockButtonProps.map(({ label, systemImage }) => ({ label, systemImage }))).toEqual([
      { label: 'fab.takePhoto', systemImage: 'camera' },
      { label: 'fab.pickImage', systemImage: 'photo.on.rectangle' },
      { label: 'fab.pickFile', systemImage: 'doc' },
      { label: 'fab.uploadClipboard', systemImage: 'doc.on.clipboard' },
      { label: 'fab.syncNow', systemImage: 'arrow.triangle.2.circlepath' },
    ]);
  });

  it('lets the native menu dismiss before running an action', () => {
    const onOpenChange = jest.fn();
    const onSync = jest.fn();

    act(() => {
      TestRenderer.create(
        <AddActionsFab
          open
          onOpenChange={onOpenChange}
          onTakePhoto={jest.fn()}
          onPickImage={jest.fn()}
          onPickFile={jest.fn()}
          onUploadClipboard={jest.fn()}
          onSync={onSync}
          theme={theme}
        />
      );
    });

    const syncButton = mockButtonProps.find(({ label }) => label === 'fab.syncNow');
    expect(syncButton).toBeDefined();

    act(() => {
      syncButton?.onPress();
    });

    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSync).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(350);
    });
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});
