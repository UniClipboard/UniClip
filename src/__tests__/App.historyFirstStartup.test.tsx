import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

let mockInitialHistoryComplete = false;
let mockAppStateCurrent = 'active';
let mockAppStateListener: ((state: string) => void) | undefined;
const mockStartServices = jest.fn(async () => undefined);
const mockRunMaintenance = jest.fn(async () => undefined);
const mockReloadHistory = jest.fn(async () => undefined);

jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Linking: {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  ToastAndroid: { show: jest.fn(), LONG: 1 },
  StatusBar: () => null,
  View: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
  AppState: {
    get currentState() {
      return mockAppStateCurrent;
    },
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      mockAppStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
}));

jest.mock('../contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../navigation/AppNavigator', () => ({ AppNavigator: () => null }));
jest.mock('../navigation/navigationRef', () => ({ navigateWhenReady: jest.fn() }));
jest.mock('../screens/QuickTileLoadingScreen', () => ({ QuickTileLoadingScreen: () => null }));
jest.mock('../screens/ShareReceiveScreen', () => ({ ShareReceiveScreen: () => null }));
jest.mock('../screens/ProcessTextScreen', () => ({ ProcessTextScreen: () => null }));
jest.mock('../components/QrScannerHost', () => ({ QrScannerHost: () => null }));
jest.mock('../i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('../i18n/useAppLanguage', () => ({ applyLanguagePreference: jest.fn() }));
jest.mock('../services/Logger', () => ({ initLogger: jest.fn(), setLogLevel: jest.fn() }));
jest.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: { isDark: false, colors: { surface: '#fff' } } }),
}));
jest.mock('shortcut', () => ({ setDynamicShortcuts: jest.fn() }));
jest.mock('android-util', () => ({
  moveTaskToBack: jest.fn(),
  setExcludeFromRecents: jest.fn(),
}));
jest.mock('../services/BackgroundServiceManager', () => ({
  getBackgroundServiceManager: () => ({ start: mockStartServices }),
}));
jest.mock('../services/appGroupSync', () => ({ startAppGroupSync: jest.fn(() => jest.fn()) }));
jest.mock('../services/networkContext', () => ({
  startNetworkContextMonitor: jest.fn(() => jest.fn()),
}));
jest.mock('../utils/connectUri', () => ({
  parseConnectUri: jest.fn(() => ({ ok: false, error: 'invalid' })),
  CONNECT_URI_ERROR_MESSAGES: { invalid: 'invalid' },
  CONNECT_URI_SCHEME: 'uniclipboard',
  CONNECT_URI_HOST: 'connect',
}));
jest.mock('../services/HistoryStorage', () => ({
  historyStorage: { runStartupMaintenance: () => mockRunMaintenance() },
}));
jest.mock('../stores', () => {
  const useHistoryStore = (selector: (state: { isInitialLoadComplete: boolean }) => unknown) =>
    selector({ isInitialLoadComplete: mockInitialHistoryComplete });
  useHistoryStore.getState = () => ({ loadItems: mockReloadHistory });
  return {
    useSettingsStore: () => ({
      config: { language: 'system' },
      loadConfig: jest.fn(),
      isLoaded: true,
    }),
    usePendingConnectStore: { getState: () => ({ set: jest.fn() }) },
    useHistoryStore,
  };
});

import App from '../../App';

async function flushEffects(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe('App history-first startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitialHistoryComplete = false;
    mockAppStateCurrent = 'active';
    mockAppStateListener = undefined;
  });

  it('starts services and maintenance only after the first history page is ready', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<App />);
    });
    await flushEffects();

    expect(mockStartServices).not.toHaveBeenCalled();
    expect(mockRunMaintenance).not.toHaveBeenCalled();

    mockInitialHistoryComplete = true;
    act(() => {
      renderer.update(<App />);
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockReloadHistory).toHaveBeenCalledTimes(1);
    expect(mockStartServices.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunMaintenance.mock.invocationCallOrder[0]
    );
  });

  it('waits for foreground instead of starting work while already backgrounded', async () => {
    mockInitialHistoryComplete = true;
    mockAppStateCurrent = 'background';
    act(() => {
      TestRenderer.create(<App />);
    });
    await flushEffects();

    expect(mockStartServices).not.toHaveBeenCalled();

    mockAppStateCurrent = 'active';
    act(() => {
      mockAppStateListener?.('active');
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(1);
  });
});
