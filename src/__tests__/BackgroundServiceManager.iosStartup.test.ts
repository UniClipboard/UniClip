import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { configureAppRuntime, getAppRuntime } from '../app/runtime';

let appStateListener: ((state: 'active' | 'background' | 'inactive') => void) | undefined;
const sync = {
  start: jest.fn<() => Promise<void>>(),
  refresh: jest.fn(async () => undefined),
  handleAppStateChange: jest.fn(),
  switchTo: jest.fn(async () => undefined),
};

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(
      (_event: string, listener: (state: 'active' | 'background' | 'inactive') => void) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      }
    ),
  },
  Platform: { OS: 'ios' },
}));

configureAppRuntime({
  settingsStore: {
    getState: () => ({
      isLoaded: true,
      config: {},
      isTempDisabledBackgroundTasks: false,
      loadConfig: jest.fn(async () => undefined),
      setEnableBackgroundTasks: jest.fn(),
      setTempDisabledBackgroundTasks: jest.fn(),
    }),
    subscribe: jest.fn(() => jest.fn()),
  },
  clipboardStore: { getState: () => ({ startMonitoring: jest.fn(async () => undefined) }) },
  sync: () => sync,
  statisticsStore: {
    getState: () => ({
      recordBackgroundTaskStart: jest.fn(async () => undefined),
      updateHeartbeat: jest.fn(),
    }),
  },
  applicationVersion: () => '1.0.0',
});

describe('BackgroundServiceManager iOS startup lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sync.start.mockResolvedValue(undefined);
  });

  it('does not let an early network refresh start sync', async () => {
    await getAppRuntime().refresh();

    expect(sync.start).not.toHaveBeenCalled();
  });

  it('forwards backgrounding without stopping a startup in progress', async () => {
    let finishStart!: () => void;
    sync.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const startPromise = getAppRuntime().start();
    await Promise.resolve();
    await Promise.resolve();
    appStateListener?.('inactive');

    expect(sync.handleAppStateChange).toHaveBeenCalledWith({
      appState: 'inactive',
      backgroundSyncEnabled: false,
      backgroundReceiveAllowed: false,
    });

    finishStart();
    await startPromise;
  });

  it('refreshes once when returning to the foreground', async () => {
    await getAppRuntime().start();

    appStateListener?.('inactive');
    appStateListener?.('active');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sync.refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces network refreshes while formal startup is in progress', async () => {
    let finishStart!: () => void;
    sync.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const manager = getAppRuntime();
    const startPromise = manager.start();
    await Promise.resolve();
    await Promise.resolve();
    const refreshes = [manager.refresh(), manager.refresh(), manager.start()];

    finishStart();
    await Promise.all([startPromise, ...refreshes]);

    expect(sync.start).toHaveBeenCalledTimes(1);
  });
});
