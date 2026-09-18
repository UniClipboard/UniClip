import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { configureAppRuntime, getAppRuntime } from '../app/runtime';

let appStateListener: ((state: 'active' | 'background' | 'inactive') => void) | null = null;
let settingsListener:
  | ((state: typeof settingsState, previous: typeof settingsState) => void)
  | null = null;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: typeof appStateListener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  Platform: { OS: 'android' },
}));

const sync = {
  start: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  handleAppStateChange: jest.fn(),
  switchTo: jest.fn(async () => undefined),
};

let settingsState = {
  isLoaded: true,
  config: {
    enableForegroundNotification: false,
    syncChannel: 'lan' as 'lan' | 'p2p',
    lanServers: [],
  },
  isTempDisabledBackgroundTasks: false,
  loadConfig: jest.fn(async () => undefined),
  setEnableBackgroundTasks: jest.fn(),
  setTempDisabledBackgroundTasks: jest.fn(),
  updateConfig: jest.fn(async () => ({ ok: true as const })),
};

configureAppRuntime({
  settingsStore: {
    getState: () => settingsState,
    subscribe: jest.fn((listener) => {
      settingsListener = listener;
      return jest.fn();
    }),
  },
  clipboardStore: { getState: () => ({ startMonitoring: jest.fn(async () => undefined) }) },
  sync: () => sync,
  statisticsStore: {
    getState: () => ({
      recordBackgroundTaskStart: jest.fn(async () => undefined),
      updateHeartbeat: jest.fn(),
    }),
  },
  applicationVersion: () => '2.0.0.179-alpha.3',
});

describe('AppRuntime unified sync ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts and refreshes through the unified sync runtime', async () => {
    await getAppRuntime().start();

    expect(sync.start).toHaveBeenCalledWith(
      {
        appVersion: '2.0.0-alpha.3+build.179',
        profileId: 'default',
        policy: { appState: 'active', backgroundSyncEnabled: false },
      },
      'lan'
    );

    appStateListener?.('inactive');
    expect(sync.handleAppStateChange).toHaveBeenCalledWith({
      appState: 'inactive',
      backgroundSyncEnabled: false,
    });

    appStateListener?.('active');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync.refresh).toHaveBeenCalledWith({
      appState: 'active',
      backgroundSyncEnabled: false,
    });

    const previous = settingsState;
    settingsState = {
      ...settingsState,
      config: {
        enableForegroundNotification: false,
        syncChannel: 'p2p',
        lanServers: [{ id: 'lan-1' }],
      },
    };
    settingsListener?.(settingsState, previous);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync.switchTo).toHaveBeenCalledWith('p2p', { rollbackOnFailure: false });
  });

  it('lets a UI entry wait for an existing startup without starting services again', async () => {
    let finishStart!: () => void;
    sync.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const runtime = getAppRuntime();
    const startup = runtime.start();
    const waiter = runtime.ensureStarted();
    await Promise.resolve();

    expect(sync.start).toHaveBeenCalledTimes(1);

    finishStart();
    await Promise.all([startup, waiter]);
    await runtime.ensureStarted();

    expect(sync.start).toHaveBeenCalledTimes(1);
  });
});
