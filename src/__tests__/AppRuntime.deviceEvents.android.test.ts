import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configureAppRuntime, getAppRuntime } from '../app/runtime';

let appStateListener: ((state: string) => void) | undefined;
const engineEventSubscribers: ((event: unknown) => void)[] = [];
const mockP2pStart = jest.fn<() => Promise<void>>();
const mockP2pSetBackgroundSyncPolicy = jest.fn(async () => undefined);
const mockP2pCancelPeerRecovery = jest.fn();
const mockP2pRecoverPeerConnections = jest.fn(async () => ({
  total: 1,
  online: 1,
  offline: 0,
  errors: 0,
}));
const mockSpaceRefresh = jest.fn(async () => ({ devices: [] }));
const mockSpaceRefreshDevices = jest.fn(async () => ({ devices: [] }));
const mockSpaceRefreshDeviceTrust = jest.fn(async () => ({ devices: [] }));
const mockSubscribeEvents = jest.fn((subscriber: (event: unknown) => void) => {
  engineEventSubscribers.push(subscriber);
  return jest.fn();
});

function emit(event: unknown): void {
  for (const subscriber of engineEventSubscribers) subscriber(event);
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
  Platform: { OS: 'android' },
}));

jest.mock('../features/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      isLoaded: true,
      config: { enableForegroundNotification: false },
      isTempDisabledBackgroundTasks: false,
    }),
    subscribe: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../features/clipboard', () => ({
  useClipboardStore: {
    getState: () => ({ startMonitoring: jest.fn(async () => undefined) }),
  },
}));

jest.mock('../stores', () => ({
  useClipboardStore: {
    getState: () => ({ startMonitoring: jest.fn(async () => undefined) }),
  },
}));

jest.mock('../platform/engine', () => ({
  getUnifiedEngineService: () => ({
    start: mockP2pStart,
    setBackgroundSyncPolicy: mockP2pSetBackgroundSyncPolicy,
    recoverPeerConnections: mockP2pRecoverPeerConnections,
    cancelPeerRecovery: mockP2pCancelPeerRecovery,
    subscribeEvents: mockSubscribeEvents,
  }),
}));

jest.mock('../features/space', () => ({
  getUnifiedSpaceService: () => ({
    refresh: mockSpaceRefresh,
    refreshDevices: mockSpaceRefreshDevices,
    refreshDeviceTrust: mockSpaceRefreshDeviceTrust,
  }),
}));

configureAppRuntime({
  settingsStore: {
    getState: () => ({
      isLoaded: true,
      config: { enableForegroundNotification: false },
      isTempDisabledBackgroundTasks: false,
      loadConfig: jest.fn(async () => undefined),
      setEnableBackgroundTasks: jest.fn(),
      setTempDisabledBackgroundTasks: jest.fn(),
    }),
    subscribe: jest.fn(() => jest.fn()),
  },
  clipboardStore: { getState: () => ({ startMonitoring: jest.fn(async () => undefined) }) },
  engine: () => ({
    start: mockP2pStart,
    setBackgroundSyncPolicy: mockP2pSetBackgroundSyncPolicy,
    resume: jest.fn(async () => undefined),
    recoverPeerConnections: mockP2pRecoverPeerConnections,
    cancelPeerRecovery: mockP2pCancelPeerRecovery,
    subscribeEvents: mockSubscribeEvents,
  }),
  space: () => ({
    refresh: mockSpaceRefresh,
    refreshDevices: mockSpaceRefreshDevices,
    refreshDeviceTrust: mockSpaceRefreshDeviceTrust,
  }),
  statisticsStore: {
    getState: () => ({
      recordBackgroundTaskStart: jest.fn(async () => undefined),
      updateHeartbeat: jest.fn(),
    }),
  },
  applicationVersion: () => '1.0.0',
});

describe('AppRuntime device list refresh routing on Android', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockP2pStart.mockResolvedValue(undefined);
  });

  it('refreshes devices for device events while active', async () => {
    await getAppRuntime().start();

    emit({ type: 'refreshRequired', reason: 'consumerLagged' });
    emit({ type: 'peerPresenceChanged', deviceId: 'desktop-1', state: 'online', atMs: 1 });
    emit({ type: 'changed', kind: 'pairing_completed' });
    await flushMicrotasks();

    expect(mockSpaceRefreshDevices).toHaveBeenCalledTimes(3);
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the complete space snapshot for a revision-only trust event', async () => {
    await getAppRuntime().start();

    emit({ type: 'deviceTrustChanged', revision: 9 });
    await flushMicrotasks();

    expect(mockSpaceRefresh).toHaveBeenCalledTimes(2);
    expect(mockSpaceRefresh).toHaveBeenLastCalledWith({ afterInvalidation: true });
    expect(mockSpaceRefreshDeviceTrust).not.toHaveBeenCalled();
    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();
  });

  it('refreshes the complete space snapshot when re-pairing is required', async () => {
    await getAppRuntime().start();

    emit({ type: 'rePairingRequired', scope: 'allDevices' });
    await flushMicrotasks();

    expect(mockSpaceRefresh).toHaveBeenCalledTimes(2);
    expect(mockSpaceRefresh).toHaveBeenLastCalledWith({ afterInvalidation: true });
    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();
  });

  it('does not refresh devices for unrelated events', async () => {
    await getAppRuntime().start();

    emit({
      type: 'activeClipboardChanged',
      snapshotHash: 'hash-1',
      entryId: 'entry-1',
      activatedAtMs: 1,
      activatedBy: 'desktop-1',
    });
    emit({
      type: 'transferStatusChanged',
      transferId: 'transfer-1',
      entryId: 'entry-1',
      attemptId: 'attempt-1',
      status: 'delivered',
      reason: null,
    });
    emit({
      type: 'networkRecoveryChanged',
      phase: 'scanning',
      retryable: true,
      nextRetryInMs: 1000,
    });
    emit({ type: 'changed', kind: 'incomingEntry' });
    await flushMicrotasks();

    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();
  });

  it('does not query devices for events while the app is not active', async () => {
    await getAppRuntime().start();

    appStateListener?.('background');
    emit({ type: 'changed', kind: 'pairing_completed' });
    emit({ type: 'deviceTrustChanged', revision: 10 });
    await flushMicrotasks();
    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();
    expect(mockSpaceRefreshDeviceTrust).not.toHaveBeenCalled();

    appStateListener?.('active');
    await flushMicrotasks();
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(2);
  });

  it('never runs iOS-only peer recovery cancellation', async () => {
    await getAppRuntime().start();

    appStateListener?.('inactive');
    appStateListener?.('background');
    appStateListener?.('active');
    await flushMicrotasks();

    expect(mockP2pCancelPeerRecovery).not.toHaveBeenCalled();
  });

  it('refreshes once per foreground transition and ignores repeated active events', async () => {
    await getAppRuntime().start();

    appStateListener?.('active');
    await flushMicrotasks();
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);

    appStateListener?.('inactive');
    appStateListener?.('active');
    await flushMicrotasks();
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(2);
  });

  it('never writes device identities from the space roster to logs', () => {
    const runtime = readFileSync(join(process.cwd(), 'src/app/runtime/appRuntime.ts'), 'utf8');

    expect(runtime).not.toContain("log.info('P2P space devices', space.devices)");
  });
});
