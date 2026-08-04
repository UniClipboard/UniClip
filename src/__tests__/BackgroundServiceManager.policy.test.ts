import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { configureAppRuntime, getAppRuntime } from '../app/runtime';

const mockStart = jest.fn(async () => undefined);
const mockSetBackgroundSyncPolicy = jest.fn(async () => undefined);
const mockRecoverPeerConnections = jest.fn(async () => ({
  total: 1,
  online: 1,
  offline: 0,
  errors: 0,
}));
const mockSpaceRefresh = jest.fn(async () => ({ devices: [] }));

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
  }),
}));

jest.mock('../features/space', () => ({
  getUnifiedSpaceService: () => ({ refresh: mockSpaceRefresh }),
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
  }),
  space: () => ({ refresh: mockSpaceRefresh }),
  statisticsStore,
  applicationVersion: () => '1.0.0',
});

describe('BackgroundServiceManager P2P policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsState.isTempDisabledBackgroundTasks = false;
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
