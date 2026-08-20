import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  configureAppRuntime,
  getAppRuntime,
  normalizeEngineApplicationVersion,
} from '../app/runtime';

const mockStart = jest.fn(async () => undefined);
const mockSetBackgroundSyncPolicy = jest.fn(async () => undefined);
const mockRecoverPeerConnections = jest.fn(async () => ({
  total: 1,
  online: 1,
  offline: 0,
  errors: 0,
}));
const mockSpaceRefresh = jest.fn(async () => ({ devices: [] }));
const mockSpaceRefreshDevices = jest.fn(async () => ({ devices: [] }));
const mockSubscribeEvents = jest.fn(() => jest.fn());

const settingsState = {
  config: {
    autoApplyRemote: true,
    autoPushLocal: true,
    enableBackgroundTasks: true,
    enableBackgroundDownload: true,
    enableBackgroundUpload: true,
    backgroundSyncNetwork: 'any' as const,
  },
  isTempDisabledBackgroundTasks: false,
};

const clipboardStore = { getState: () => ({ startMonitoring: jest.fn(async () => undefined) }) };
const statisticsStore = {
  getState: () => ({
    recordBackgroundTaskStart: jest.fn(async () => undefined),
    updateHeartbeat: jest.fn(),
  }),
};

jest.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'android' },
}));

jest.mock('../features/settings', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('../platform/engine', () => ({
  getUnifiedEngineService: () => ({
    start: mockStart,
    setBackgroundSyncPolicy: mockSetBackgroundSyncPolicy,
    recoverPeerConnections: mockRecoverPeerConnections,
    subscribeEvents: mockSubscribeEvents,
  }),
}));

jest.mock('../features/space', () => ({
  getUnifiedSpaceService: () => ({
    refresh: mockSpaceRefresh,
    refreshDevices: mockSpaceRefreshDevices,
  }),
}));

configureAppRuntime({
  settingsStore: {
    getState: () => ({
      ...settingsState,
      isLoaded: true,
      loadConfig: jest.fn(async () => undefined),
      setEnableBackgroundTasks: jest.fn(),
      setTempDisabledBackgroundTasks: jest.fn(),
    }),
    subscribe: jest.fn(() => jest.fn()),
  },
  clipboardStore,
  engine: () => ({
    start: mockStart,
    setBackgroundSyncPolicy: mockSetBackgroundSyncPolicy,
    resume: jest.fn(async () => undefined),
    recoverPeerConnections: mockRecoverPeerConnections,
    cancelPeerRecovery: jest.fn(),
    subscribeEvents: mockSubscribeEvents,
  }),
  space: () => ({ refresh: mockSpaceRefresh, refreshDevices: mockSpaceRefreshDevices }),
  statisticsStore,
  applicationVersion: () => '1.0.0',
});

describe('BackgroundServiceManager P2P policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsState.isTempDisabledBackgroundTasks = false;
  });

  it('converts Android release version names to valid engine versions', () => {
    expect(normalizeEngineApplicationVersion('2.0.0.177-alpha.2')).toBe('2.0.0-alpha.2+build.177');
    expect(normalizeEngineApplicationVersion('2.0.0.177')).toBe('2.0.0+build.177');
    expect(normalizeEngineApplicationVersion('2.0.0')).toBe('2.0.0');
  });

  it('starts the engine, refreshes space state, and recovers peer connections', async () => {
    await getAppRuntime().activateP2p();

    expect(mockStart).toHaveBeenCalledWith({ appVersion: '1.0.0', profileId: 'default' });
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
    expect(mockRecoverPeerConnections).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecoverPeerConnections.mock.invocationCallOrder[0]
    );
  });

  it('allows background sync when the user policy is enabled', async () => {
    await getAppRuntime().activateP2p();

    expect(mockSetBackgroundSyncPolicy).toHaveBeenCalledWith(true);
  });

  it('disables background sync while tasks are temporarily paused', async () => {
    settingsState.isTempDisabledBackgroundTasks = true;

    await getAppRuntime().activateP2p();

    expect(mockSetBackgroundSyncPolicy).toHaveBeenCalledWith(false);
  });
});
