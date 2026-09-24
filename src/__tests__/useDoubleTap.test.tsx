import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DOUBLE_TAP_TIMEOUT_MS, useDoubleTap } from '@/hooks/useDoubleTap';

function Harness({
  onSingle,
  onDouble,
  expose,
}: {
  onSingle: () => void;
  onDouble?: () => void;
  expose: (press: () => void) => void;
}) {
  expose(useDoubleTap(onSingle, onDouble));
  return null;
}

function mount(onSingle: jest.Mock, onDouble?: jest.Mock) {
  let press: () => void = () => {};
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <Harness onSingle={onSingle} onDouble={onDouble} expose={(p) => (press = p)} />
    );
  });
  // jest.setup.js 把 setImmediate 指向 useRealTimers,首次渲染会切回真实定时器,挂载后再启用。
  jest.useFakeTimers();
  return { press: () => press(), renderer: renderer! };
}

describe('useDoubleTap', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('fires the single tap only after the double-tap window passes', () => {
    const onSingle = jest.fn();
    const onDouble = jest.fn();
    const { press } = mount(onSingle, onDouble);

    act(() => press());
    expect(onSingle).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(DOUBLE_TAP_TIMEOUT_MS));
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('fires only the double tap when a second press lands inside the window', () => {
    const onSingle = jest.fn();
    const onDouble = jest.fn();
    const { press } = mount(onSingle, onDouble);

    act(() => press());
    act(() => jest.advanceTimersByTime(DOUBLE_TAP_TIMEOUT_MS - 50));
    act(() => press());
    act(() => jest.advanceTimersByTime(DOUBLE_TAP_TIMEOUT_MS * 2));

    expect(onDouble).toHaveBeenCalledTimes(1);
    expect(onSingle).not.toHaveBeenCalled();
  });

  it('fires the single tap immediately when no double-tap handler is given', () => {
    const onSingle = jest.fn();
    const { press } = mount(onSingle);

    act(() => press());
    expect(onSingle).toHaveBeenCalledTimes(1);
  });

  it('drops a pending single tap on unmount', () => {
    const onSingle = jest.fn();
    const { press, renderer } = mount(onSingle, jest.fn());

    act(() => press());
    act(() => renderer.unmount());
    act(() => jest.advanceTimersByTime(DOUBLE_TAP_TIMEOUT_MS));
    expect(onSingle).not.toHaveBeenCalled();
  });
});
