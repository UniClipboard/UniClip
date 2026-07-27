import { getBackgroundServiceManager } from '../services/BackgroundServiceManager';

let appStateListener: ((state: string) => void) | undefined;
const mockP2pStart = jest.fn<() => Promise<void>>();
const mockP2pStop = jest.fn(async () => undefined);
const mockP2pIsStarting = jest.fn(() => true);
const mockSpaceRefresh = jest.fn(async () => undefined);

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  Platform: { OS: 'ios' },
}));

jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      isLoaded: true,
      config: { syncChannel: 'p2p' },
      isTempDisabledBackgroundTasks: false,
    }),
    subscribe: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../stores/clipboardStore', () => ({
  useClipboardStore: {
    getState: () => ({ startMonitoring: jest.fn(async () => undefined) }),
  },
}));

jest.mock('../stores', () => ({
  useClipboardStore: {
    getState: () => ({ startMonitoring: jest.fn(async () => undefined) }),
  },
}));

jest.mock('../services/UnifiedEngineService', () => ({
  getUnifiedEngineService: () => ({
    start: mockP2pStart,
    stop: mockP2pStop,
    isStarting: mockP2pIsStarting,
  }),
}));

jest.mock('../services/UnifiedSpaceService', () => ({
  getUnifiedSpaceService: () => ({ refresh: mockSpaceRefresh }),
}));

jest.mock('../services/Logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('BackgroundServiceManager iOS startup lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = undefined;
  });

  it('stops P2P immediately when the app backgrounds during startup', async () => {
    let finishStart!: () => void;
    mockP2pStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const startPromise = getBackgroundServiceManager().start();
    await Promise.resolve();
    await Promise.resolve();

    expect(appStateListener).toBeDefined();
    appStateListener?.('inactive');
    await Promise.resolve();

    expect(mockP2pStop).toHaveBeenCalledTimes(1);

    finishStart();
    await startPromise;
  });
});
