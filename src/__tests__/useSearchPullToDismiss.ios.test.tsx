import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (factory: () => object) => factory(),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

import { useSearchPullToDismiss } from '@/screens/ios/useSearchPullToDismiss';
import { PULL_TO_DISMISS_DISTANCE } from '@/utils/pullToDismiss';

function mount(dismiss: () => void) {
  let result!: ReturnType<typeof useSearchPullToDismiss>;
  function Probe({ isSearching }: { isSearching: boolean }) {
    result = useSearchPullToDismiss(isSearching, dismiss);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe isSearching />);
  });
  return {
    get: () => result,
    setSearching: (isSearching: boolean) => act(() => renderer.update(<Probe isSearching={isSearching} />)),
  };
}

describe('iOS search pull-to-dismiss', () => {
  beforeEach(() => jest.mocked(Haptics.impactAsync).mockClear());

  it('gives one haptic each time the pull crosses the threshold', () => {
    const { onPull } = mount(jest.fn()).get().handlers;
    onPull(-20);
    onPull(-PULL_TO_DISMISS_DISTANCE);
    onPull(-PULL_TO_DISMISS_DISTANCE - 30);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    onPull(-10);
    onPull(-PULL_TO_DISMISS_DISTANCE);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it('stays in search when released before the threshold', () => {
    const dismiss = jest.fn();
    const { onPull, onRelease } = mount(dismiss).get().handlers;
    onPull(-(PULL_TO_DISMISS_DISTANCE - 1));
    onRelease(-(PULL_TO_DISMISS_DISTANCE - 1));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('dismisses once per search and keeps the dock where it was released', () => {
    const dismiss = jest.fn();
    const view = mount(dismiss);
    const { onPull, onRelease } = view.get().handlers;
    onPull(-PULL_TO_DISMISS_DISTANCE);
    onRelease(-PULL_TO_DISMISS_DISTANCE);
    onRelease(-PULL_TO_DISMISS_DISTANCE);
    expect(dismiss).toHaveBeenCalledTimes(1);

    // 退场中的搜索框不回弹;下次进入搜索时复位
    view.setSearching(false);
    expect(view.get().dockStyle).toMatchObject({ opacity: 0.5 });
    view.setSearching(true);
    view.setSearching(true);
    expect(view.get().dockStyle).toMatchObject({ opacity: 1 });
    view.get().handlers.onRelease(-PULL_TO_DISMISS_DISTANCE);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
});
