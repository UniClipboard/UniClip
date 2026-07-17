import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getBackgroundServiceManager } from '../services/BackgroundServiceManager';

const mockRemoteRefresh = jest.fn<() => Promise<void>>(async () => undefined);
const mockReconcileSyncEngineAppState = jest.fn();
const mockStartMonitoring = jest.fn(async () => undefined);
const mockStopMonitoring = jest.fn();
const mockSetStaticReceiverEnabled = jest.fn();

const settingsState = {
  config: {
    autoApplyRemote: true,
    autoPushLocal: true,
    enableBackgroundTasks: true,
    enableBackgroundDownload: true,
    enableBackgroundUpload: true,
    enableSmsForwarding: false,
  },
  isTempDisabledBackgroundTasks: true,
};

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
  getClipboardSyncService: () => ({ refresh: mockRemoteRefresh }),
}));

jest.mock('../stores/syncEngineStore', () => ({
  reconcileSyncEngineAppState: mockReconcileSyncEngineAppState,
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
    mockRemoteRefresh.mockResolvedValue(undefined);
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

    await Promise.resolve();
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

    finishRemoteRefresh?.();
    await refreshPromise;
  });
});
