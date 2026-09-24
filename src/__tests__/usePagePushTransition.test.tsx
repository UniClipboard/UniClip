/**
 * usePagePushTransition：页面静止时不能挂着动画样式。
 *
 * Reanimated 把已结束动画的终值交还 React 依赖 JS 线程上的定时回收，冷启动时 JS 线程被阻塞
 * 超过 1 秒，终值会在交还前被丢弃，此后的重渲染把页面打回首帧（透明、右移）。回归点：
 * 入场结束后 pageStyle 必须是 undefined；退场重新挂上的样式初值必须完全可见，不能闪成透明。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

type Finish = (finished: boolean) => void;
const mockTimings: { target: number; done?: Finish }[] = [];

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));
jest.mock('react-native-reanimated', () => ({
  Easing: { bezier: () => () => 0 },
  interpolate: (x: number, input: number[], output: number[]) => {
    // 只需覆盖测试用到的 [0, 0.4, 1] → [0, 1, 1]
    if (x <= input[0]) return output[0];
    if (x >= input[1]) return output[1];
    return (x / input[1]) * output[1];
  },
  useReducedMotion: () => false,
  useSharedValue: (value: number) => {
    const React = require('react') as typeof import('react');
    return React.useRef({ value }).current;
  },
  // 与真实实现一致：只在首次渲染时计算一次初值
  useAnimatedStyle: (factory: () => unknown) => {
    const React = require('react') as typeof import('react');
    return React.useRef({ initial: factory() }).current;
  },
  // 立即落到目标值，完成回调留给测试手动触发
  withTiming: (target: number, _config: unknown, done?: Finish) => {
    mockTimings.push({ target, done });
    return target;
  },
}));

import { usePagePushTransition } from '@/hooks/usePagePushTransition';

type Transition = ReturnType<typeof usePagePushTransition>;
type AnimatedStyleHandle = { initial: { opacity: number; transform?: unknown } };

function setup() {
  const onDismiss = jest.fn();
  const onEnterComplete = jest.fn();
  let current: Transition | null = null;
  function Harness() {
    current = usePagePushTransition(onDismiss, onEnterComplete);
    return null;
  }
  act(() => {
    TestRenderer.create(<Harness />);
  });
  return { page: () => current!, onDismiss, onEnterComplete };
}

const finishLast = (target: number) => {
  const timing = [...mockTimings].reverse().find((t) => t.target === target);
  act(() => timing?.done?.(true));
};

beforeEach(() => {
  mockTimings.length = 0;
});

describe('usePagePushTransition', () => {
  it('starts hidden, then drops the animated style once the page has entered', () => {
    const { page, onEnterComplete } = setup();
    expect((page().pageStyle as unknown as AnimatedStyleHandle).initial.opacity).toBe(0);
    expect(page().settled).toBe(false);

    finishLast(1);

    expect(page().pageStyle).toBeUndefined();
    expect(page().settled).toBe(true);
    expect(onEnterComplete).toHaveBeenCalledTimes(1);
  });

  it('reattaches a fully visible style for the exit, then dismisses and runs after', () => {
    const { page, onDismiss } = setup();
    finishLast(1);
    const after = jest.fn();

    act(() => page().close(after));

    const exitStyle = page().pageStyle as unknown as AnimatedStyleHandle;
    expect(exitStyle.initial.opacity).toBe(1);
    expect(exitStyle.initial.transform).toEqual([{ translateX: 0 }]);
    expect(page().settled).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();

    finishLast(0);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('ignores a second close while the exit is running', () => {
    const { page, onDismiss } = setup();
    finishLast(1);

    act(() => page().close());
    act(() => page().close());
    finishLast(0);

    expect(mockTimings.filter((t) => t.target === 0)).toHaveLength(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not settle when the enter finishes after a close was requested', () => {
    const { page, onEnterComplete } = setup();

    act(() => page().close());
    finishLast(1);

    expect(page().settled).toBe(false);
    expect(page().pageStyle).toBeDefined();
    expect(onEnterComplete).toHaveBeenCalledTimes(1);
  });
});
