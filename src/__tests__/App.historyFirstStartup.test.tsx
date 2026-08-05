import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

let mockInitialHistoryComplete = false;
let mockAppStateCurrent = 'active';
let mockAppStateListener: ((state: string) => void) | undefined;
const mockStartServices = jest.fn(async () => undefined);
const mockRunMaintenance = jest.fn(async () => undefined);
const mockResumeOutboundShareHandoffs = jest.fn(async () => ({ completed: 0, deferred: 0 }));
const mockReloadHistory = jest.fn(async () => undefined);
const mockSetHistorySort = jest.fn();
const mockDismissStartupHistoryPreview = jest.fn();
const mockLoadSpaceSetupCompletion = jest.fn(async () => 'unknown');
const mockRetrySpaceSetupCompletion = jest.fn(async () => undefined);

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
jest.mock('../i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('../i18n/useAppLanguage', () => ({ applyLanguagePreference: jest.fn() }));
jest.mock('../support/observability', () => ({
  initLogger: jest.fn(),
  setLogLevel: jest.fn(),
  startPostHogAnalytics: jest.fn(async () => undefined),
  stopPostHogAnalytics: jest.fn(async () => undefined),
}));
jest.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: { isDark: false, colors: { surface: '#fff' } } }),
}));
jest.mock('shortcut', () => ({ setDynamicShortcuts: jest.fn() }));
jest.mock('android-util', () => ({
  moveTaskToBack: jest.fn(),
  setExcludeFromRecents: jest.fn(),
}));
jest.mock('../app/runtime/composition', () => ({
  configureAppRuntime: jest.fn(),
  getAppRuntime: () => ({ start: mockStartServices }),
}));
jest.mock('../platform/app-group', () => ({ startAppGroupSync: jest.fn(() => jest.fn()) }));
jest.mock('../platform/network', () => ({
  startNetworkContextMonitor: jest.fn(() => jest.fn()),
}));
jest.mock('../features/history', () => ({
  historyStorage: { runStartupMaintenance: () => mockRunMaintenance() },
}));
jest.mock('../features/transfer', () => ({
  resumeOutboundShareHandoffs: () => mockResumeOutboundShareHandoffs(),
}));
jest.mock('../features/space', () => ({
  getSpaceSetupCompletion: () => ({
    load: mockLoadSpaceSetupCompletion,
    retryPendingWrite: mockRetrySpaceSetupCompletion,
  }),
}));
jest.mock('app-group-store', () => ({
  dismissStartupHistoryPreview: () => mockDismissStartupHistoryPreview(),
}));
jest.mock('../stores', () => {
  const useHistoryStore = (selector: (state: { isInitialLoadComplete: boolean }) => unknown) =>
    selector({ isInitialLoadComplete: mockInitialHistoryComplete });
  useHistoryStore.getState = () => ({
    loadItems: mockReloadHistory,
    setSort: mockSetHistorySort,
  });
  return {
    useSettingsStore: () => ({
      config: { language: 'system' },
      loadConfig: jest.fn(),
      isLoaded: true,
    }),
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
    mockStartServices.mockResolvedValue(undefined);
    mockInitialHistoryComplete = false;
    mockAppStateCurrent = 'active';
    mockAppStateListener = undefined;
    mockLoadSpaceSetupCompletion.mockResolvedValue('unknown');
    mockRetrySpaceSetupCompletion.mockResolvedValue(undefined);
  });

  it('configures application services before starting analytics', async () => {
    act(() => {
      TestRenderer.create(<App />);
    });
    await flushEffects();

    const { configureAppRuntime } = jest.requireMock('../app/runtime/composition') as {
      configureAppRuntime: jest.Mock;
    };
    const { startPostHogAnalytics } = jest.requireMock('../support/observability') as {
      startPostHogAnalytics: jest.Mock;
    };
    expect(configureAppRuntime).toHaveBeenCalledTimes(1);
    expect(startPostHogAnalytics).toHaveBeenCalledTimes(1);
    expect(configureAppRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      startPostHogAnalytics.mock.invocationCallOrder[0]
    );
    expect(mockLoadSpaceSetupCompletion).toHaveBeenCalledTimes(1);
  });

  it('starts services and maintenance only after the first history page is ready', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<App />);
    });
    await flushEffects();

    expect(mockReloadHistory).toHaveBeenCalledTimes(1);
    expect(mockSetHistorySort).toHaveBeenCalledWith({ field: 'lastAccessed', order: 'desc' });
    expect(mockStartServices).not.toHaveBeenCalled();
    expect(mockRunMaintenance).not.toHaveBeenCalled();
    expect(mockDismissStartupHistoryPreview).not.toHaveBeenCalled();

    mockInitialHistoryComplete = true;
    act(() => {
      renderer.update(<App />);
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockResumeOutboundShareHandoffs).toHaveBeenCalledTimes(1);
    expect(mockReloadHistory).toHaveBeenCalledTimes(2);
    expect(mockDismissStartupHistoryPreview).not.toHaveBeenCalled();
    expect(mockStartServices.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunMaintenance.mock.invocationCallOrder[0]
    );
    expect(mockRunMaintenance.mock.invocationCallOrder[0]).toBeLessThan(
      mockResumeOutboundShareHandoffs.mock.invocationCallOrder[0]
    );
    expect(mockResumeOutboundShareHandoffs.mock.invocationCallOrder[0]).toBeLessThan(
      mockReloadHistory.mock.invocationCallOrder[1]
    );

    mockAppStateCurrent = 'background';
    act(() => {
      mockAppStateListener?.('background');
    });
    mockAppStateCurrent = 'active';
    act(() => {
      mockAppStateListener?.('active');
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockResumeOutboundShareHandoffs).toHaveBeenCalledTimes(1);
    expect(mockReloadHistory).toHaveBeenCalledTimes(2);
    expect(mockDismissStartupHistoryPreview).not.toHaveBeenCalled();
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

  it('retries only failed services after returning to the foreground', async () => {
    mockInitialHistoryComplete = true;
    mockStartServices.mockRejectedValueOnce(new Error('startup failed'));
    act(() => {
      TestRenderer.create(<App />);
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockResumeOutboundShareHandoffs).toHaveBeenCalledTimes(1);
    expect(mockReloadHistory).toHaveBeenCalledTimes(2);

    mockAppStateCurrent = 'background';
    act(() => {
      mockAppStateListener?.('background');
    });
    mockAppStateCurrent = 'active';
    act(() => {
      mockAppStateListener?.('active');
    });
    await flushEffects();

    expect(mockStartServices).toHaveBeenCalledTimes(2);
    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockResumeOutboundShareHandoffs).toHaveBeenCalledTimes(1);
    expect(mockReloadHistory).toHaveBeenCalledTimes(2);
  });
});
