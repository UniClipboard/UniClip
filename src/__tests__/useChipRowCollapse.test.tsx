/**
 * 筛选 chip 行收展状态机的单测:1:1 跟手/clamp、顶部强制全显、过半 snap、
 * velocity 延迟 snap、iOS contentInset 的 topOffset 坐标换算、JS 侧 reveal、
 * 全隐时的无障碍摘除标志,以及返回对象的引用稳定性(effect 依赖它)。
 *
 * mock 约定:withTiming 立即落定到目标值(只断言 snap 目标,不模拟动画过程);
 * useAnimatedReaction 在每次渲染时检查一次(真实实现在 UI 线程逐帧检查),
 * 因此驱动 worklet 后需 rerender() 才能观察到 isFullyHidden 的翻转。
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');

  const makeSharedValue = (init: number) => {
    const box: any = { _current: init };
    Object.defineProperty(box, 'value', {
      get() {
        return box._current;
      },
      set(v: any) {
        box._current = v && typeof v === 'object' && v.__timing ? v.to : v;
      },
    });
    return box;
  };

  return {
    useSharedValue: (init: number) => {
      const ref = ReactActual.useRef(null);
      if (!ref.current) ref.current = makeSharedValue(init);
      return ref.current;
    },
    useAnimatedStyle: (fn: () => any) => {
      const ref = ReactActual.useRef(null);
      if (!ref.current) {
        ref.current = {
          get transform() {
            return fn().transform;
          },
          get opacity() {
            return fn().opacity;
          },
        };
      }
      return ref.current;
    },
    useAnimatedReaction: (prepare: () => any, react: (cur: any, prev: any) => void) => {
      const prev = ReactActual.useRef(null);
      ReactActual.useEffect(() => {
        const current = prepare();
        if (current !== prev.current) {
          react(current, prev.current);
          prev.current = current;
        }
      });
    },
    withTiming: (to: number) => ({ __timing: true, to }),
    Easing: { out: (fn: unknown) => fn, cubic: (t: number) => t },
  };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: any[]) => void, ...args: any[]) => fn(...args),
}));

import { useChipRowCollapse } from '@/screens/useChipRowCollapse';
import { FILTER_CHIP_ROW_HEIGHT } from '@/components/HomeFilterChipsRow.types';

const ROW = FILTER_CHIP_ROW_HEIGHT;

function setup(topOffset = 0) {
  let hook!: ReturnType<typeof useChipRowCollapse>;
  function Harness(_props: { tick: number }) {
    hook = useChipRowCollapse(topOffset);
    return null;
  }
  let tick = 0;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness tick={tick} />);
  });
  return {
    get hook() {
      return hook;
    },
    /** 当前收起位移(px):0 = 全显,ROW = 全隐 */
    hiddenPx: () => -(hook.rowStyle as any).transform[0].translateY,
    opacity: () => (hook.rowStyle as any).opacity,
    scroll: (y: number) => act(() => hook.onScrollWorklet(y)),
    end: (y: number, velocityY: number) => act(() => hook.onScrollEndWorklet(y, velocityY)),
    rerender: () => act(() => renderer.update(<Harness tick={++tick} />)),
  };
}

describe('useChipRowCollapse', () => {
  it('向下滚动按 1:1 收起并 clamp 到行高,向上滚动立即等量拉回', () => {
    const t = setup();
    t.scroll(10);
    expect(t.hiddenPx()).toBe(10);
    t.scroll(30);
    expect(t.hiddenPx()).toBe(30);
    t.scroll(300);
    expect(t.hiddenPx()).toBe(ROW);
    // 深处向上滚 20px:立即拉回 20px,而不是等回到顶部
    t.scroll(280);
    expect(t.hiddenPx()).toBe(ROW - 20);
    expect(t.opacity()).toBeCloseTo(20 / ROW);
  });

  it('顶部(含下拉回弹 y<=0)强制全显', () => {
    const t = setup();
    t.scroll(200);
    expect(t.hiddenPx()).toBe(ROW);
    t.scroll(0);
    expect(t.hiddenPx()).toBe(0);
    t.scroll(-30);
    expect(t.hiddenPx()).toBe(0);
  });

  it('松手停在半途时按过半原则 snap', () => {
    const overHalf = setup();
    overHalf.scroll(ROW / 2 + 5);
    overHalf.end(ROW / 2 + 5, 0);
    expect(overHalf.hiddenPx()).toBe(ROW);

    const underHalf = setup();
    underHalf.scroll(10);
    underHalf.end(10, 0);
    expect(underHalf.hiddenPx()).toBe(0);
  });

  it('松手仍有惯性(velocity≠0)时不 snap,等 momentumEnd 收尾', () => {
    const t = setup();
    t.scroll(30);
    t.end(30, 1.5);
    expect(t.hiddenPx()).toBe(30);
    t.end(35, 0);
    expect(t.hiddenPx()).toBe(ROW);
  });

  it('topOffset 换算 iOS contentInset 坐标:y = -inset 是静止顶部', () => {
    const INSET = ROW;
    const t = setup(INSET);
    t.scroll(-INSET);
    expect(t.hiddenPx()).toBe(0);
    t.scroll(-INSET + 10);
    expect(t.hiddenPx()).toBe(10);
    t.end(-INSET + 10, 0);
    expect(t.hiddenPx()).toBe(0);
  });

  it('reveal() 从 JS 侧强制展开', () => {
    const t = setup();
    t.scroll(300);
    expect(t.hiddenPx()).toBe(ROW);
    act(() => t.hook.reveal());
    expect(t.hiddenPx()).toBe(0);
  });

  it('全隐时 isFullyHidden 翻转为 true,展开后翻回 false', () => {
    const t = setup();
    expect(t.hook.isFullyHidden).toBe(false);
    t.scroll(300);
    t.rerender();
    expect(t.hook.isFullyHidden).toBe(true);
    act(() => t.hook.reveal());
    t.rerender();
    expect(t.hook.isFullyHidden).toBe(false);
  });

  it('状态未变化时返回对象引用稳定(供 effect 依赖)', () => {
    const t = setup();
    const before = t.hook;
    t.rerender();
    expect(t.hook).toBe(before);
  });
});
