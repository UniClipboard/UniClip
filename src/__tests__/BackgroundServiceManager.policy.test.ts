import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getBackgroundServiceManager } from '../services/BackgroundServiceManager';

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

jest.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'android' },
}));

jest.mock('../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('../services/UnifiedEngineService', () => ({
  getUnifiedEngineService: () => ({
    start: mockStart,
    setBackgroundSyncPolicy: mockSetBackgroundSyncPolicy,
    recoverPeerConnections: mockRecoverPeerConnections,
  }),
}));

jest.mock('../services/UnifiedSpaceService', () => ({
  getUnifiedSpaceService: () => ({ refresh: mockSpaceRefresh }),
}));

describe('BackgroundServiceManager P2P policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsState.isTempDisabledBackgroundTasks = false;
  });

  it('starts the engine, refreshes space state, and recovers peer connections', async () => {
    await getBackgroundServiceManager().activateP2p();

    expect(mockStart).toHaveBeenCalledWith({ appVersion: '1.0.0', profileId: 'default' });
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
    expect(mockRecoverPeerConnections).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecoverPeerConnections.mock.invocationCallOrder[0]
    );
  });

  it('allows background sync when the user policy is enabled', async () => {
    await getBackgroundServiceManager().activateP2p();

    expect(mockSetBackgroundSyncPolicy).toHaveBeenCalledWith(true);
  });

  it('disables background sync while tasks are temporarily paused', async () => {
    settingsState.isTempDisabledBackgroundTasks = true;

    await getBackgroundServiceManager().activateP2p();

    expect(mockSetBackgroundSyncPolicy).toHaveBeenCalledWith(false);
  });
});
