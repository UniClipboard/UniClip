import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  configureAppRuntime,
  getAppRuntime,
  normalizeEngineApplicationVersion,
} from '../app/runtime';

const sync = {
  start: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  handleAppStateChange: jest.fn(),
  switchTo: jest.fn(async () => undefined),
};

const updateConfig = jest.fn(async (updates: { syncChannel?: 'lan' | 'p2p' }) => {
  Object.assign(settingsState.config, updates);
  return { ok: true as const };
});

const settingsState = {
  config: {
    syncChannel: 'lan' as 'lan' | 'p2p',
    autoApplyRemote: true,
    autoPushLocal: true,
    enableBackgroundTasks: true,
    enableBackgroundDownload: true,
    enableBackgroundUpload: true,
    backgroundSyncNetwork: 'any' as const,
  },
  isTempDisabledBackgroundTasks: false,
};

jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
  Platform: { OS: 'android' },
}));

jest.mock('native-timer', () => ({
  setTimer: jest.fn(() => 'heartbeat'),
  clearTimer: jest.fn(),
}));

jest.mock('foreground-service', () => ({
  startService: jest.fn(),
  stopService: jest.fn(),
  isRunning: jest.fn(() => false),
  addStopListener: jest.fn(() => ({ remove: jest.fn() })),
  addTempStopListener: jest.fn(() => ({ remove: jest.fn() })),
}));

configureAppRuntime({
  settingsStore: {
    getState: () => ({
      ...settingsState,
      isLoaded: true,
      loadConfig: jest.fn(async () => undefined),
      setEnableBackgroundTasks: jest.fn(),
      setTempDisabledBackgroundTasks: jest.fn(),
      updateConfig,
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

describe('BackgroundServiceManager sync policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsState.isTempDisabledBackgroundTasks = false;
  });

  it('converts Android release version names to valid engine versions', () => {
    expect(normalizeEngineApplicationVersion('2.0.0.177-alpha.2')).toBe('2.0.0-alpha.2+build.177');
    expect(normalizeEngineApplicationVersion('2.0.0.177')).toBe('2.0.0+build.177');
    expect(normalizeEngineApplicationVersion('2.0.0')).toBe('2.0.0');
  });

  it('starts the selected transport with background sync enabled', async () => {
    await getAppRuntime().start();

    expect(sync.start).toHaveBeenCalledWith(
      {
        appVersion: '1.0.0',
        profileId: 'default',
        policy: {
          appState: 'background',
          backgroundSyncEnabled: true,
          backgroundReceiveAllowed: false,
        },
      },
      'lan'
    );
  });

  it('disables background sync while tasks are temporarily paused', async () => {
    settingsState.isTempDisabledBackgroundTasks = true;

    await getAppRuntime().refresh();

    expect(sync.refresh).toHaveBeenLastCalledWith({
      appState: 'background',
      backgroundSyncEnabled: false,
      backgroundReceiveAllowed: false,
    });
  });

  it('selects P2P without bypassing the unified runtime', async () => {
    await getAppRuntime().activateP2p();

    expect(updateConfig).toHaveBeenCalledWith({ syncChannel: 'p2p' });
    expect(sync.switchTo).toHaveBeenCalledWith('p2p', { rollbackOnFailure: false });
  });
});
