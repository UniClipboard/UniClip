/**
 * 详情操作栏(Android)的行为测试:主/快捷动作触发、popover 开合与 overflow 行分发。
 * 用真实渲染断言交互,替代对源码文本的字符串匹配。
 */
import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import type { ActionMenuItem } from '@/utils/actionMenuItems';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);

// reanimated / worklets 依赖原生:mock 成同步落地(动画一步到位),只保留挂载/卸载与回调时序。
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: () => void) => fn() }));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: (v: number) => ({ value: v }),
    useReducedMotion: () => false,
    useAnimatedStyle: () => ({}),
    withSpring: (v: number) => v,
    withTiming: (v: number, _cfg: unknown, cb?: (f: boolean) => void) => {
      cb?.(true);
      return v;
    },
    Easing: { in: () => (t: number) => t, quad: (t: number) => t },
  };
});

// jest 的 react-native preset 默认解析 .ios,故显式引入 Android 实现来断言其 popover 行为。
import { ClipboardDetailActionBar } from '@/components/ClipboardDetailActionBar.android';

const theme = {
  colors: {
    surfaceHigh: '#111',
    surfaceHighest: '#222',
    separator: '#333',
    accent: '#0a84ff',
    onAccent: '#fff',
    textPrimary: '#eee',
    error: '#f33',
  },
} as never;

function makeAction(key: string): ActionMenuItem {
  return {
    key,
    label: key,
    icon: `${key}-outline`,
    destructive: key === 'delete',
    onPress: jest.fn(),
  };
}

function pressableByLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  const matches = root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  );
  if (matches.length !== 1) {
    throw new Error(`expected exactly one pressable labelled "${label}", found ${matches.length}`);
  }
  return matches[0];
}

describe('ClipboardDetailActionBar (popover)', () => {
  const primary = makeAction('copy');
  const quick = [makeAction('selectText'), makeAction('share')];
  const overflow = [makeAction('copyPlain'), makeAction('delete')];
  const quickLabels = { selectText: '选择' };

  function render(popoverOpen: boolean, onPopoverOpenChange = jest.fn()) {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ClipboardDetailActionBar
          primary={primary}
          quick={quick}
          overflow={overflow}
          quickLabels={quickLabels}
          moreLabel="更多"
          theme={theme}
          popoverOpen={popoverOpen}
          onPopoverOpenChange={onPopoverOpenChange}
        />
      );
    });
    return { renderer, onPopoverOpenChange };
  }

  it('fires the primary and quick actions on press', () => {
    const { renderer } = render(false);
    act(() => pressableByLabel(renderer.root, 'copy').props.onPress());
    act(() => pressableByLabel(renderer.root, 'selectText').props.onPress());
    expect(primary.onPress).toHaveBeenCalledTimes(1);
    expect(quick[0].onPress).toHaveBeenCalledTimes(1);
  });

  it('toggles the popover open state from the more button', () => {
    const { renderer, onPopoverOpenChange } = render(false);
    act(() => pressableByLabel(renderer.root, '更多').props.onPress());
    expect(onPopoverOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not render the popover rows while closed', () => {
    const { renderer } = render(false);
    expect(renderer.root.findAll((n) => n.props.testID === 'detail-overflow-popover')).toHaveLength(
      0
    );
  });

  it('renders overflow rows when open and dispatches + closes on row press', () => {
    const { renderer, onPopoverOpenChange } = render(true);
    expect(
      renderer.root.findAll((n) => n.props.testID === 'detail-overflow-popover').length
    ).toBeGreaterThan(0);

    act(() => pressableByLabel(renderer.root, 'delete').props.onPress());
    expect(overflow[1].onPress).toHaveBeenCalledTimes(1);
    expect(onPopoverOpenChange).toHaveBeenCalledWith(false);
  });
});
