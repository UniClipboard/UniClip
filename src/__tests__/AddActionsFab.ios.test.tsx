import React from 'react';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockImpactAsync = jest.fn().mockResolvedValue(undefined);
const mockSelectionAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react') as typeof import('react');
  const makeSharedValue = (init: number) => {
    const box: { _current: unknown; value: unknown } = { _current: init, value: init };
    Object.defineProperty(box, 'value', {
      get() {
        return box._current;
      },
      set(v: unknown) {
        box._current =
          v && typeof v === 'object' && '__timing' in v ? (v as { __timing: number }).__timing : v;
      },
    });
    return box;
  };
  const AnimatedView = (props: React.PropsWithChildren<unknown>) =>
    ReactActual.createElement('AnimatedView', props);
  const reanimated = {
    View: AnimatedView,
    useSharedValue: (init: number) => {
      const ref = ReactActual.useRef<{ value: unknown } | null>(null);
      if (!ref.current) ref.current = makeSharedValue(init);
      return ref.current;
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withSpring: (to: number) => ({ __spring: to }),
    withTiming: (to: number, _opts: unknown, cb?: (finished: boolean) => void) => {
      cb?.(true);
      return { __timing: to };
    },
    Easing: { in: (e: unknown) => e, out: (e: unknown) => e, quad: 1 },
  };
  return { ...reanimated, default: reanimated };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: () => void) => fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: (style: unknown) => {
    mockImpactAsync(style);
    return Promise.resolve();
  },
  selectionAsync: () => mockSelectionAsync(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

jest.mock('expo-blur', () => {
  const react = require('react') as typeof import('react');
  return {
    BlurView: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  };
});

jest.mock('lucide-react-native', () => {
  const react = require('react') as typeof import('react');
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === 'createLucideIcon') return undefined;
        return () => react.createElement('Icon', { name: prop });
      },
    }
  );
});

jest.mock('@/components/ui', () => {
  const react = require('react') as typeof import('react');
  return {
    GlassContainer: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  };
});

jest.mock('@/theme/iosDesignTokens', () => ({
  iosAccent: { light: '#15171C', dark: '#F4F2EE' },
  iosColors: {
    label: 'label',
    separator: 'separator',
    tertiarySystemFill: 'tertiarySystemFill',
  },
  iosKindTints: {
    text: '#007AFF',
    url: '#32ADE6',
    image: '#34C759',
    file: '#FF9500',
    group: '#AF52DE',
  },
  hexToRgba: (hex: string, alpha: number) => `rgba(${hex},${alpha})`,
}));

import { AddActionsFab } from '../components/AddActionsFab.ios';

const theme = {
  colors: {
    accent: '#007AFF',
    onAccent: '#FFFFFF',
  },
} as never;

function renderFab(props: Partial<Parameters<typeof AddActionsFab>[0]> = {}) {
  const onOpenChange = jest.fn();
  const onTakePhoto = jest.fn();
  const onPickImage = jest.fn();
  const onPickFile = jest.fn();
  const onUploadClipboard = jest.fn();
  const onSync = jest.fn();

  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <AddActionsFab
        open={false}
        onOpenChange={onOpenChange}
        onTakePhoto={onTakePhoto}
        onPickImage={onPickImage}
        onPickFile={onPickFile}
        onUploadClipboard={onUploadClipboard}
        onSync={onSync}
        theme={theme}
        {...props}
      />
    );
  });

  return {
    renderer: renderer!,
    onOpenChange,
    onTakePhoto,
    onPickImage,
    onPickFile,
    onUploadClipboard,
    onSync,
  };
}

function findRow(root: ReactTestInstance, label: string): ReactTestInstance | undefined {
  const text = root.findAll((node) => node.type === 'Text' && node.props.children === label)[0];
  if (!text) return undefined;
  let node: ReactTestInstance | null = text;
  for (let i = 0; i < 6 && node; i += 1) {
    if (typeof node.type === 'function' && node.type.name === 'Pressable') return node;
    node = node.parent;
  }
  return undefined;
}

describe('AddActionsFab iOS', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('triggers an impact haptic and opens the menu when the FAB is tapped', () => {
    const { renderer, onOpenChange } = renderFab();

    const fab = renderer.root.findByProps({ accessibilityLabel: 'a11y.addContent' });
    act(() => {
      fab.props.onPress();
    });

    expect(mockImpactAsync).toHaveBeenCalledWith('medium');
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders every action row when open', () => {
    const { renderer } = renderFab({ open: true });

    for (const label of [
      'fab.takePhoto',
      'fab.pickImage',
      'fab.pickFile',
      'fab.uploadClipboard',
      'fab.syncNow',
    ]) {
      expect(findRow(renderer.root, label)).toBeDefined();
    }
  });

  it('dismisses the menu when the scrim is tapped', () => {
    const { renderer, onOpenChange } = renderFab({ open: true });

    const scrim = renderer.root.findByProps({ accessibilityLabel: 'a11y.closeMenu' });
    act(() => {
      scrim.props.onPress();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('runs a row action after the menu collapse delay, with a selection haptic', () => {
    const { renderer, onOpenChange, onTakePhoto } = renderFab({ open: true });

    const photoRow = findRow(renderer.root, 'fab.takePhoto')!;
    act(() => {
      photoRow.props.onPress();
    });

    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onTakePhoto).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
  });
});
