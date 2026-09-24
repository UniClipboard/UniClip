/**
 * useWordPicker 的选区 → 输出文本状态：拼接方式、复制前编辑的覆盖与失效、清除、标点不可选。
 * 手势构建器与原生动画在这里无关，mock 成可链式调用的空壳。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-gesture-handler', () => {
  const chain: unknown = new Proxy(() => chain, { get: () => () => chain });
  return { Gesture: { Pan: () => chain, Race: () => chain, Exclusive: () => chain } };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: () => void) => fn() }));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (v: unknown) => ({ value: v }),
  useReducedMotion: () => false,
  useAnimatedStyle: () => ({}),
  withTiming: (v: number) => v,
  interpolate: () => 0,
  Easing: { bezier: () => (t: number) => t },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Soft: 0, Light: 1, Medium: 2 },
}));

import { useWordPicker } from '@/hooks/useWordPicker';

type Picker = ReturnType<typeof useWordPicker>;

async function mountPicker(text: string) {
  const ref: { current: Picker | null } = { current: null };
  function Harness() {
    ref.current = useWordPicker(text, () => {});
    return null;
  }
  await act(async () => {
    TestRenderer.create(<Harness />);
  });
  await act(async () => {
    ref.current!.beginTokenization();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const picker = () => ref.current!;
  const indexOf = (token: string) => picker().tokens.findIndex((t) => t.text === token);
  return { picker, indexOf };
}

describe('useWordPicker output text', () => {
  const text = '明天 下午，三点';

  it('joins separate runs as in the original by default, and by the chosen mode', async () => {
    const { picker, indexOf } = await mountPicker(text);
    act(() => picker().toggleToken(indexOf('明天')));
    act(() => picker().toggleToken(indexOf('三点')));
    expect(picker().runs).toHaveLength(2);
    expect(picker().joinMode).toBe('original');
    // 原文间隙「 下午，」里有空白 → 以空格连接
    expect(picker().outputText).toBe('明天 三点');

    act(() => picker().setJoinMode('newline'));
    expect(picker().outputText).toBe('明天\n三点');
  });

  it('keeps an edit until the selection changes', async () => {
    const { picker, indexOf } = await mountPicker(text);
    act(() => picker().toggleToken(indexOf('明天')));
    act(() => picker().setOutputText('明天见'));
    expect(picker().isEdited).toBe(true);
    expect(picker().outputText).toBe('明天见');
    // 统计仍按选区计，不随编辑变化
    expect(picker().charCount).toBe(2);

    act(() => picker().toggleToken(indexOf('下午')));
    expect(picker().isEdited).toBe(false);
    expect(picker().outputText).toBe('明天 下午');
  });

  it('ignores taps on punctuation and clears the whole selection', async () => {
    const { picker, indexOf } = await mountPicker(text);
    act(() => picker().toggleToken(indexOf('，')));
    expect(picker().selectedCount).toBe(0);

    act(() => picker().toggleSelectAll());
    expect(picker().outputText).toBe(text);
    act(() => picker().clearSelection());
    expect(picker().selectedCount).toBe(0);
    expect(picker().outputText).toBe('');
  });

  it('lets punctuation be selected in char granularity', async () => {
    const { picker, indexOf } = await mountPicker(text);
    act(() => picker().setGranularity('char'));
    act(() => picker().toggleToken(indexOf('，')));
    expect(picker().selectedCount).toBe(1);
    expect(picker().outputText).toBe('，');
  });

  it('keeps punctuation inside a word run selected after switching to chars', async () => {
    const { picker, indexOf } = await mountPicker(text);
    act(() => picker().toggleToken(indexOf('下午')));
    act(() => picker().toggleToken(indexOf('三点')));
    act(() => picker().setGranularity('char'));
    expect(picker().runs).toHaveLength(1);
    expect(picker().outputText).toBe('下午，三点');
  });
});
