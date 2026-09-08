import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppNavigator } from '@/navigation/AppNavigator';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockConfig: { syncChannel: 'lan' | 'p2p' } | null;
let mockCompletion: 'unknown' | 'incomplete' | 'complete';
let mockMounts: number;
let mockNavigate: (route: string) => void;

jest.mock('@/stores', () => ({
  useSettingsStore: (select: (state: { config: typeof mockConfig }) => unknown) =>
    select({ config: mockConfig }),
}));
jest.mock('@/features/space', () => ({
  useSpaceSetupCompletionStore: (select: (state: { status: string }) => unknown) =>
    select({ status: mockCompletion }),
}));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/navigation/useSettingsScreenOptions', () => ({
  useSettingsScreenOptions: () => ({}),
}));
jest.mock('@/navigation/navigationRef', () => ({
  navigationRef: {},
  flushPendingNavigation: jest.fn(),
}));
jest.mock('@/support/observability', () => ({ capturePostHogScreen: jest.fn() }));
jest.mock('@/screens/HomeView', () => ({ HomeView: () => null }));
jest.mock('@/screens/OnboardingScreen', () => ({ OnboardingScreen: () => null }));
jest.mock('@/screens/SettingsScreen', () => ({ SettingsScreen: () => null }));
jest.mock('@/screens/settings/SettingsSubScreen', () => ({ SettingsSubScreen: () => null }));
jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  DarkTheme: { colors: {} },
  useNavigation: jest.fn(),
  NavigationContainer: ({ children }: { children: React.ReactNode }) => {
    const React = require('react') as typeof import('react');
    React.useEffect(() => {
      mockMounts += 1;
    }, []);
    return children;
  },
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ initialRouteName }: { initialRouteName: string }) => {
      const React = require('react') as typeof import('react');
      const [route, setRoute] = React.useState(initialRouteName);
      mockNavigate = setRoute;
      return React.createElement('route', { name: route });
    },
    Screen: () => null,
  }),
}));

describe('sync channel navigation', () => {
  let renderer: ReactTestRenderer;
  const render = () =>
    act(() => {
      renderer = TestRenderer.create(<AppNavigator />);
    });
  const refresh = () => act(() => renderer.update(<AppNavigator />));
  const currentRoute = () => renderer.root.findByType('route' as React.ElementType).props.name;

  beforeEach(() => {
    mockConfig = { syncChannel: 'lan' };
    mockCompletion = 'incomplete';
    mockMounts = 0;
  });
  afterEach(() => act(() => renderer.unmount()));

  it.each(['incomplete', 'unknown', 'complete'] as const)(
    'keeps settings mounted when switching to direct sync with %s setup',
    (status) => {
      mockCompletion = status;
      render();
      act(() => mockNavigate('SettingsSub'));
      mockConfig = { syncChannel: 'p2p' };
      refresh();
      expect(currentRoute()).toBe('SettingsSub');
      mockCompletion = 'incomplete';
      refresh();
      expect(currentRoute()).toBe('SettingsSub');
      mockConfig = { syncChannel: 'lan' };
      refresh();
      expect(currentRoute()).toBe('SettingsSub');
      act(() => mockNavigate('Settings'));
      expect(currentRoute()).toBe('Settings');
      expect(mockMounts).toBe(1);
    }
  );

  it('waits for startup data before opening mandatory direct-sync onboarding', () => {
    mockConfig = null;
    mockCompletion = 'unknown';
    render();
    expect(mockMounts).toBe(0);
    mockConfig = { syncChannel: 'p2p' };
    refresh();
    expect(mockMounts).toBe(0);
    mockCompletion = 'incomplete';
    refresh();
    expect(currentRoute()).toBe('Onboarding');
    mockCompletion = 'complete';
    refresh();
    expect(currentRoute()).toBe('Onboarding');
    expect(mockMounts).toBe(1);
  });

  it('opens the main page for a completed direct-sync install', () => {
    mockConfig = { syncChannel: 'p2p' };
    mockCompletion = 'complete';
    render();
    expect(currentRoute()).toBe('Main');
  });
});
