import { getBackgroundServiceManager } from '../services/BackgroundServiceManager';

let appStateListener: ((state: string) => void) | undefined;
const mockP2pStart = jest.fn<() => Promise<void>>();
const mockP2pStop = jest.fn(async () => undefined);
const mockP2pIsStarting = jest.fn(() => true);
const mockP2pResume = jest.fn(async () => undefined);
const mockP2pSetBackgroundSyncPolicy = jest.fn(async () => undefined);
const mockP2pCancelPeerRecovery = jest.fn();
const mockP2pRecoverPeerConnections = jest.fn(async () => ({
  total: 1,
  online: 1,
  offline: 0,
  errors: 0,
}));
const mockSpaceRefresh = jest.fn(async () => ({
  status: 'ready' as const,
  spaceId: 'space-1',
  deviceName: 'iPhone 16 Pro',
  invitation: null,
  devices: [
    {
      deviceId: 'phone-device-id',
      displayName: 'iPhone 16 Pro',
      isLocal: true,
      online: true,
    },
    {
      deviceId: 'desktop-device-id',
      displayName: 'Mac',
      isLocal: false,
      online: false,
    },
  ],
  lastError: null,
}));

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
      config: {},
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
    resume: mockP2pResume,
    setBackgroundSyncPolicy: mockP2pSetBackgroundSyncPolicy,
    recoverPeerConnections: mockP2pRecoverPeerConnections,
    cancelPeerRecovery: mockP2pCancelPeerRecovery,
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
    mockP2pStart.mockResolvedValue(undefined);
  });

  it('does not let an early network refresh start the engine', async () => {
    await getBackgroundServiceManager().refresh();

    expect(mockP2pStart).not.toHaveBeenCalled();
  });

  it('leaves startup lifecycle control to the native host when the app backgrounds', async () => {
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

    expect(mockP2pStop).not.toHaveBeenCalled();
    expect(mockP2pCancelPeerRecovery).toHaveBeenCalledTimes(1);

    finishStart();
    await startPromise;
    appStateListener?.('active');
    for (
      let attempt = 0;
      attempt < 20 && mockP2pRecoverPeerConnections.mock.calls.length === 0;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(mockP2pRecoverPeerConnections).toHaveBeenCalledTimes(1);
  });

  it('resumes the native engine before starting bounded foreground recovery', async () => {
    await getBackgroundServiceManager().start();

    expect(mockP2pResume).toHaveBeenCalledTimes(1);
    expect(mockP2pRecoverPeerConnections).toHaveBeenCalledTimes(1);
    expect(mockP2pResume.mock.invocationCallOrder[0]).toBeLessThan(
      mockP2pRecoverPeerConnections.mock.invocationCallOrder[0]
    );
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
  });

  it('records the local and receiver identities after the startup refresh', async () => {
    await getBackgroundServiceManager().start();

    const { log } = jest.requireMock('../services/Logger') as {
      log: { info: jest.Mock };
    };
    expect(log.info).toHaveBeenCalledWith('[P2PStartup] Space devices', [
      {
        deviceId: 'phone-device-id',
        displayName: 'iPhone 16 Pro',
        isLocal: true,
        online: true,
      },
      {
        deviceId: 'desktop-device-id',
        displayName: 'Mac',
        isLocal: false,
        online: false,
      },
    ]);
  });

  it('coalesces network refreshes while the formal startup is in progress', async () => {
    let finishStart!: () => void;
    mockP2pStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const manager = getBackgroundServiceManager();
    const startPromise = manager.start();
    await Promise.resolve();
    await Promise.resolve();
    const refreshes = [manager.refresh(), manager.refresh(), manager.start()];

    finishStart();
    await Promise.all([startPromise, ...refreshes]);

    expect(mockP2pStart).toHaveBeenCalledTimes(1);
  });
});
