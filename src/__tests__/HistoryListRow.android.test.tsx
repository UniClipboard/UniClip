import fs from 'fs';
import path from 'path';
import React from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { createDefaultClipboardItem, type ClipboardItem } from '@/types/clipboard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockPan {
  config: Record<string, unknown>;
  handlers: Record<string, (event?: { translationX: number }) => void>;
}
const mockPans: MockPan[] = [];

jest.mock('react-native-gesture-handler', () => {
  const react = require('react') as typeof import('react');
  const Pan = () => {
    const pan: MockPan = { config: {}, handlers: {} };
    mockPans.push(pan);
    const builder: Record<string, (...args: unknown[]) => unknown> = new Proxy(
      {},
      {
        get: (_target, key: string) => (arg: unknown) => {
          if (key.startsWith('on')) pan.handlers[key] = arg as MockPan['handlers'][string];
          else pan.config[key] = arg;
          return builder;
        },
      }
    );
    return builder;
  };
  return {
    Gesture: { Pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  };
});
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));
jest.mock('expo-haptics', () => ({
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  AndroidHaptics: { Confirm: 'confirm' },
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { isDark: false, colors: {} } }),
}));
jest.mock('@/hooks/useURLMetadata', () => ({ useURLMetadata: () => null }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { HistoryListRow, type HistoryListRowProps } from '@/components/android/HistoryListRow';
import { DOUBLE_TAP_TIMEOUT_MS } from '@/hooks/useDoubleTap';

const HASH = 'A'.repeat(64);
const imageItem = createDefaultClipboardItem({
  type: 'Image',
  text: 'screenshot.png',
  profileHash: HASH,
  hasData: true,
  dataName: 'screenshot.png',
  timestamp: Date.now(),
  deviceName: 'Pixel 9',
  fileUri: 'file:///screenshot.png',
});

function render(overrides: Partial<HistoryListRowProps> = {}, item: ClipboardItem = imageItem) {
  const props: HistoryListRowProps = {
    item,
    density: 'comfortable',
    position: 'single',
    isSelected: false,
    isSelectMode: false,
    onPress: jest.fn(),
    onCopy: jest.fn(async () => true),
    onLongPress: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<HistoryListRow {...props} />);
  });
  // jest.setup.js 让首次渲染切回真实定时器,挂载后再启用假定时器以驱动双击窗口。
  jest.useFakeTimers();
  const row = renderer.root.findAll(
    (n) => n.props.testID === `history-row-${item.profileHash}` && !!n.props.onLongPress
  )[0];
  return { renderer, row, props };
}

describe('Android history list row', () => {
  beforeEach(() => {
    mockPans.length = 0;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('makes the whole visible row the only hit target, including trailing content', () => {
    const { renderer, row, props } = render();

    // 行内没有任何独立的可点子元素:点到文字、缩略图还是尾部空白,都是同一个 Pressable
    const pressTargets = renderer.root.findAll(
      (n) => !('density' in n.props) && typeof n.props.onPress === 'function'
    );
    expect(pressTargets).toHaveLength(1);
    expect(pressTargets[0] === row).toBe(true);
    expect(row.findAllByType(Image)).toHaveLength(1);
    expect(row.findAllByType(Text).map((t) => t.props.children)).toContain('Pixel 9 · 刚刚');
    // 行宽由外层撑满,不设固定/内在宽度
    const style = StyleSheet.flatten(row.props.style);
    expect(style.width).toBeUndefined();
    expect(style.alignSelf).toBeUndefined();

    act(() => {
      row.props.onPress();
      jest.advanceTimersByTime(DOUBLE_TAP_TIMEOUT_MS);
    });
    expect(props.onPress).toHaveBeenCalledWith(imageItem);
  });

  it('keeps the grid gestures: double tap copies, long press reports the item', async () => {
    const { row, props } = render();

    await act(async () => {
      row.props.onPress();
      row.props.onPress();
    });
    expect(props.onCopy).toHaveBeenCalledWith(imageItem);
    expect(props.onPress).not.toHaveBeenCalled();

    // 长按时测量行在窗口中的位置(RN jest 的原生 View mock 默认不回调)
    const node = row.find((n) => typeof n.instance?.measureInWindow === 'function');
    node.instance.measureInWindow = (cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(16, 120, 358, 76);
    act(() => {
      row.props.onLongPress();
    });
    expect(props.onLongPress).toHaveBeenCalledWith(imageItem, {
      x: 16,
      y: 120,
      width: 358,
      height: 76,
    });
  });

  // 模拟一次拖动:手指横移 fingerX 后松手(判定只看位移,测试里没有速度)
  const drag = (fingerX: number) => {
    const pan = mockPans[mockPans.length - 1];
    act(() => {
      pan.handlers.onUpdate({ translationX: fingerX });
      pan.handlers.onEnd();
    });
  };

  it('copies on a deliberate swipe right and deletes on a deliberate swipe left', async () => {
    const { props } = render();
    const pan = mockPans[mockPans.length - 1];
    expect(pan.config.enabled).toBe(true);
    // 竖向偏移很快让给列表滚动,横向要明确移动一段才开始识别
    expect(pan.config.activeOffsetX).toEqual([-24, 24]);
    expect(pan.config.failOffsetY).toEqual([-12, 12]);

    await act(async () => {
      drag(200);
    });
    expect(props.onCopy).toHaveBeenCalledWith(imageItem);
    expect(props.onDelete).not.toHaveBeenCalled();

    drag(-200);
    expect(props.onDelete).toHaveBeenCalledWith(imageItem);
  });

  it('ignores short swipes in both directions', () => {
    const { props } = render();
    drag(150);
    drag(-150);
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('offers copy and delete as accessibility actions outside selection mode', () => {
    const { row, props } = render();
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'copy',
      'delete',
    ]);
    act(() => {
      row.props.onAccessibilityAction({
        nativeEvent: { actionName: 'delete' },
      });
    });
    expect(props.onDelete).toHaveBeenCalledWith(imageItem);
  });

  it('disables swipes and toggles selection immediately in selection mode', () => {
    const { row, props } = render({ isSelectMode: true, isSelected: true });
    expect(mockPans[mockPans.length - 1].config.enabled).toBe(false);
    expect(row.props.accessibilityState).toEqual({
      selected: true,
      checked: true,
    });
    act(() => {
      row.props.onPress();
    });
    expect(props.onPress).toHaveBeenCalledWith(imageItem);
  });

  it('renders the compact density as a single line with a trailing time', () => {
    const text = createDefaultClipboardItem({
      type: 'Text',
      text: 'line one\nline two',
      profileHash: 'B'.repeat(64),
      hasData: false,
      timestamp: Date.now(),
    });
    const { row } = render({ density: 'compact' }, text);
    const texts = row.findAllByType(Text);
    expect(texts[0].props.numberOfLines).toBe(1);
    expect(texts[texts.length - 1].props.children).toBe('刚刚');
    expect(row.findAllByType(Image)).toHaveLength(0);
  });
});

describe('Android history list reuse', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('shares gesture, copy-feedback and kind-icon logic with the grid card and detail page', () => {
    const row = read('components/android/HistoryListRow.tsx');
    expect(row).toContain("from '@/hooks/useDoubleTap'");
    // 甩动速度会让轻扫越过阈值,不能再用 ReanimatedSwipeable 的判定
    expect(row).not.toContain('ReanimatedSwipeable');
    expect(row).toContain("from '@/hooks/useCopyFeedback'");
    expect(read('components/ClipboardCard.android.tsx')).toContain(
      "from '@/hooks/useCopyFeedback'"
    );
    expect(read('components/android/ClipboardDetailPage.tsx')).toContain(
      "from './historyKindStyle'"
    );
  });

  it('keeps the shared compact home free of platform checks and lets Android inject the list', () => {
    const compact = read('screens/HomeCompactView.tsx');
    expect(compact).not.toContain('Platform.OS');
    expect(compact).toContain('renderCollection');
    expect(read('screens/HomeView.android.tsx')).toContain('getHomeHistoryCollection(c)');
    expect(read('screens/HomeView.ios.tsx')).not.toContain('renderCollection');
  });
});
