import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { OnboardingScreen } from '@/screens/OnboardingScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockSetPage = jest.fn();
const mockScan = jest.fn();
jest.mock('@/screens/onboarding/useOnboardingConnection', () => ({
  useOnboardingConnection: () => ({ stage: 'intro', busy: false, error: null, scan: mockScan }),
}));
jest.mock('@/screens/onboarding/OnboardingConnection', () => ({
  OnboardingConnection: () => null,
}));
jest.mock('react-native-pager-view', () => {
  const React = require('react') as typeof import('react');
  return React.forwardRef((props: { children: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({ setPage: mockSetPage }));
    return React.createElement('pager', props, props.children);
  });
});
jest.mock('@/components/ui', () => ({
  AppHost: ({ children }: { children: React.ReactNode }) => children,
  AppButton: (props: object) => require('react').createElement('button', props),
}));
jest.mock('@/screens/onboarding/OnboardingArtwork', () => ({ OnboardingArtwork: () => null }), {
  virtual: true,
});
jest.mock('@/components/AddSyncConnectionSheet', () => ({ AddSyncConnectionSheet: () => null }));
jest.mock('@/screens/SpaceSetupResult', () => ({ SpaceSetupResult: () => null }));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: { accent: '#6750A4', onAccent: '#FFFFFF' } } }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('optional welcome tour', () => {
  let renderer: ReactTestRenderer;
  const finish = jest.fn(async () => undefined);
  const button = (title: string) =>
    renderer.root
      .findAllByType('button' as React.ElementType)
      .find((node) => node.props.title === title)!;
  const select = (position: number) =>
    act(() =>
      renderer.root
        .findByType('pager' as React.ElementType)
        .props.onPageSelected({ nativeEvent: { position } })
    );
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      renderer = TestRenderer.create(<OnboardingScreen onComplete={finish} />);
    });
  });
  afterEach(() => act(() => renderer.unmount()));
  it('uses the app theme for primary and secondary actions', () => {
    expect(button('intro.next').props.colors).toEqual({
      containerColor: '#6750A4',
      contentColor: '#FFFFFF',
    });
    select(2);
    expect(button('intro.scan').props.colors).toEqual({
      containerColor: '#6750A4',
      contentColor: '#FFFFFF',
    });
    expect(button('skip').props.colors).toEqual({ contentColor: '#6750A4' });
  });
  it('advances through three pages and enters without pairing', async () => {
    act(() => button('intro.next').props.onPress());
    expect(mockSetPage).toHaveBeenCalledWith(1);
    select(1);
    act(() => button('intro.next').props.onPress());
    expect(mockSetPage).toHaveBeenCalledWith(2);
    select(2);
    expect(finish).not.toHaveBeenCalled();
    await act(async () => button('skip').props.onPress());
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1])('has only the bottom action on page %s', (page) => {
    select(page);
    expect(button('intro.next')).toBeDefined();
    const secondary = renderer.root.findByProps({ testID: 'welcome-secondary-action' });
    expect(secondary.props.pointerEvents).toBe('none');
    expect(secondary.props.accessibilityElementsHidden).toBe(true);
  });
  it('keeps both native button hosts mounted while moving between pages', () => {
    select(1);
    const secondary = renderer.root.findByProps({ testID: 'welcome-secondary-action' });
    const skip = button('skip');
    select(2);
    expect(renderer.root.findByProps({ testID: 'welcome-secondary-action' })).toBe(secondary);
    expect(button('skip')).toBe(skip);
    expect(secondary.props.pointerEvents).toBe('auto');
    expect(secondary.props.accessibilityElementsHidden).toBe(false);
    select(1);
    expect(button('skip')).toBe(skip);
    expect(secondary.props.pointerEvents).toBe('none');
  });
  it('opens the scanner from the primary action without finishing onboarding', () => {
    select(2);
    const actions = renderer.root.findAllByType('button' as React.ElementType);
    expect(actions.map((node) => node.props.title)).toEqual(['intro.scan', 'skip']);
    expect(button('intro.scan').props.variant).toBe('filled');
    expect(button('skip').props.variant).toBe('text');
    act(() => button('intro.scan').props.onPress());
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });
  it('keeps swipe and button progress in sync in both directions', () => {
    select(2);
    expect(button('intro.scan')).toBeDefined();
    select(0);
    expect(button('intro.next')).toBeDefined();
  });
  it('allows retry after saving fails', async () => {
    select(2);
    finish.mockRejectedValueOnce(new Error('storage unavailable'));
    await act(async () => button('skip').props.onPress());
    expect(renderer.root.findByProps({ testID: 'welcome-error' })).toBeDefined();
    await act(async () => button('skip').props.onPress());
    expect(finish).toHaveBeenCalledTimes(2);
  });
});
