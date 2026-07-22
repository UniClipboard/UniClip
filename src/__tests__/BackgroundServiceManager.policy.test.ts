import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getBackgroundServiceManager } from '../services/BackgroundServiceManager';

const mockRemoteRefresh = jest.fn<() => Promise<void>>(async () => undefined);
const mockRemoteStop = jest.fn<() => void>();
const mockReconcileSyncEngineAppState = jest.fn();
const mockLanStart = jest.fn<() => Promise<void>>(async () => undefined);
const mockLanStop = jest.fn<() => void>();
const mockP2pStart = jest.fn<() => Promise<void>>(async () => undefined);
const mockP2pStop = jest.fn<() => Promise<void>>(async () => undefined);
const mockStartMonitoring = jest.fn(async () => undefined);
const mockStopMonitoring = jest.fn();
const mockSetStaticReceiverEnabled = jest.fn();

const settingsState = {
  config: {
    syncChannel: 'lan' as 'p2p' | 'lan',
    autoApplyRemote: true,
    autoPushLocal: true,
    enableBackgroundTasks: true,
    enableBackgroundDownload: true,
    enableBackgroundUpload: true,
    enableSmsForwarding: false,
  },
  isTempDisabledBackgroundTasks: true,
};

async function waitForRemoteRefreshToStart(isStarted: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10 && !isStarted(); attempt += 1) {
    await Promise.resolve();
  }
}

jest.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'android' },
}));

jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('../services/ClipboardSyncService', () => ({
  getClipboardSyncService: () => ({ refresh: mockRemoteRefresh, stop: mockRemoteStop }),
}));

jest.mock('../stores/syncEngineStore', () => ({
  reconcileSyncEngineAppState: mockReconcileSyncEngineAppState,
  useSyncEngineStore: {
    getState: () => ({ isRunning: false, start: mockLanStart, stop: mockLanStop }),
  },
}));

jest.mock('uc-engine', () => ({
  start: mockP2pStart,
  shutdown: mockP2pStop,
}));

jest.mock('../stores/clipboardStore', () => ({
  useClipboardStore: {
    getState: () => ({
      startMonitoring: mockStartMonitoring,
      stopMonitoring: mockStopMonitoring,
    }),
  },
}));

jest.mock('sms-forwarder', () => ({
  setStaticReceiverEnabled: mockSetStaticReceiverEnabled,
}));

jest.mock('../stores/statisticsStore', () => ({
  useStatisticsStore: {
    getState: () => ({
      recordBackgroundTaskStart: jest.fn(async () => undefined),
      updateHeartbeat: jest.fn(),
    }),
  },
}));

jest.mock('native-timer', () => ({
  setTimer: jest.fn(() => 'test-heartbeat'),
  clearTimer: jest.fn(),
}));

jest.mock('foreground-service', () => ({
  stopService: jest.fn(),
}));

describe('BackgroundServiceManager background policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsState.isTempDisabledBackgroundTasks = true;
    settingsState.config.syncChannel = 'lan';
    mockRemoteRefresh.mockResolvedValue(undefined);
  });

  it('stops LAN before starting the explicitly selected P2P channel', async () => {
    await getBackgroundServiceManager().refresh();
    jest.clearAllMocks();

    settingsState.config.syncChannel = 'p2p';
    await getBackgroundServiceManager().refresh();

    expect(mockLanStop).toHaveBeenCalledTimes(1);
    expect(mockRemoteStop).toHaveBeenCalledTimes(1);
    expect(mockP2pStart).toHaveBeenCalledTimes(1);
    expect(mockRemoteRefresh).not.toHaveBeenCalled();
    expect(mockReconcileSyncEngineAppState).not.toHaveBeenCalled();
  });

  it('stops clipboard monitoring and reconciles SyncEngine after temporary disable', async () => {
    await getBackgroundServiceManager().refresh();

    expect(mockRemoteRefresh).toHaveBeenCalledTimes(1);
    expect(mockReconcileSyncEngineAppState).toHaveBeenCalledTimes(1);
    expect(mockStopMonitoring).toHaveBeenCalledTimes(1);
    expect(mockStartMonitoring).not.toHaveBeenCalled();
  });

  it('restores clipboard monitoring before a remote refresh can block', async () => {
    settingsState.isTempDisabledBackgroundTasks = false;
    let finishRemoteRefresh: (() => void) | undefined;
    mockRemoteRefresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoteRefresh = resolve;
        })
    );

    const refreshPromise = getBackgroundServiceManager().refresh();
    await Promise.resolve();

    expect(mockReconcileSyncEngineAppState).toHaveBeenCalledTimes(1);
    expect(mockStartMonitoring).toHaveBeenCalledTimes(1);
    expect(mockStopMonitoring).not.toHaveBeenCalled();

    await waitForRemoteRefreshToStart(() => finishRemoteRefresh !== undefined);
    expect(finishRemoteRefresh).toBeDefined();
    finishRemoteRefresh?.();
    await refreshPromise;
  });

  it('reconciles the stop before a remote refresh can block', async () => {
    let finishRemoteRefresh: (() => void) | undefined;
    mockRemoteRefresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoteRefresh = resolve;
        })
    );

    const refreshPromise = getBackgroundServiceManager().refresh();
    await Promise.resolve();

    expect(mockReconcileSyncEngineAppState).toHaveBeenCalledTimes(1);
    expect(mockStopMonitoring).toHaveBeenCalledTimes(1);

    await waitForRemoteRefreshToStart(() => finishRemoteRefresh !== undefined);
    expect(finishRemoteRefresh).toBeDefined();
    finishRemoteRefresh?.();
    await refreshPromise;
  });
});
