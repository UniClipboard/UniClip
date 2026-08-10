import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { configureAppRuntime, getAppRuntime } from '../app/runtime';

let appStateListener: ((state: string) => void) | undefined;
const engineEventSubscribers: ((event: unknown) => void)[] = [];
const mockP2pStart = jest.fn<() => Promise<void>>();
const mockP2pResume = jest.fn(async () => undefined);
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
  Platform: { OS: 'ios' },
}));

jest.mock('../features/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      isLoaded: true,
      config: {},
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
    resume: mockP2pResume,
    recoverPeerConnections: mockP2pRecoverPeerConnections,
    cancelPeerRecovery: mockP2pCancelPeerRecovery,
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
  engine: () => ({
    start: mockP2pStart,
    setBackgroundSyncPolicy: mockP2pSetBackgroundSyncPolicy,
    resume: mockP2pResume,
    recoverPeerConnections: mockP2pRecoverPeerConnections,
    cancelPeerRecovery: mockP2pCancelPeerRecovery,
    subscribeEvents: mockSubscribeEvents,
  }),
  space: () => ({ refresh: mockSpaceRefresh, refreshDevices: mockSpaceRefreshDevices }),
  statisticsStore: {
    getState: () => ({
      recordBackgroundTaskStart: jest.fn(async () => undefined),
      updateHeartbeat: jest.fn(),
    }),
  },
  applicationVersion: () => '1.0.0',
});

describe('AppRuntime device list refresh routing on iOS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockP2pStart.mockResolvedValue(undefined);
  });

  it('subscribes to engine events exactly once during startup', async () => {
    await getAppRuntime().start();
    await getAppRuntime().start();

    expect(mockSubscribeEvents).toHaveBeenCalledTimes(1);
  });

  it('refreshes devices for refreshRequired, presence, revocation, and pairing_completed', async () => {
    await getAppRuntime().start();

    emit({ type: 'refreshRequired', reason: 'consumerLagged' });
    emit({ type: 'peerPresenceChanged', deviceId: 'desktop-1', state: 'online', atMs: 1 });
    emit({
      type: 'memberRevocationChanged',
      revocation: {
        revocationId: 'revocation-1',
        outcome: 'applied',
        pendingRecipients: 1,
        removedDeviceIds: [],
        pendingRecipientDeviceIds: [],
        updatedAtMs: 1,
      },
    });
    emit({ type: 'changed', kind: 'pairing_completed' });
    await flushMicrotasks();

    expect(mockSpaceRefreshDevices).toHaveBeenCalledTimes(4);
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh devices for content, clipboard, transfer, or unrelated changed events', async () => {
    await getAppRuntime().start();

    emit({ type: 'stateChanged', state: 'running' });
    emit({
      type: 'operationFinished',
      operationId: 'op-1',
      terminal: 'completed',
      failure: null,
    });
    emit({
      type: 'lifecycleFailed',
      action: 'resume',
      failure: { code: 1301, category: 'unknown', retryable: false },
    });
    emit({
      type: 'incomingEntry',
      entryId: 'entry-1',
      attemptId: 'attempt-1',
      preview: 'hello',
      origin: 'remote',
    });
    emit({
      type: 'incomingPending',
      entryId: 'entry-1',
      attemptId: 'attempt-1',
      fromDevice: 'desktop-1',
      totalBytes: 100,
      filenames: ['a.txt'],
    });
    emit({
      type: 'receiveAttemptStateChanged',
      entryId: 'entry-1',
      attemptId: 'attempt-1',
      state: 'accepted',
    });
    emit({ type: 'deliveryStatusChanged', entryId: 'entry-1', targetDeviceId: 'desktop-1' });
    emit({
      type: 'transferProgress',
      transferId: 'transfer-1',
      entryId: 'entry-1',
      attemptId: 'attempt-1',
      peerId: 'desktop-1',
      direction: 'outbound',
      completedBytes: 10,
      totalBytes: 100,
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
      type: 'activeClipboardChanged',
      snapshotHash: 'hash-1',
      entryId: 'entry-1',
      activatedAtMs: 1,
      activatedBy: 'desktop-1',
    });
    emit({
      type: 'networkRecoveryChanged',
      phase: 'scanning',
      retryable: true,
      nextRetryInMs: 1000,
    });
    emit({ type: 'changed', kind: 'someOtherKind' });
    emit({ type: 'transferProgress', transferId: 't', entryId: 'e', attemptId: 'a' });
    await flushMicrotasks();

    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();
  });

  it('queries nothing for device events while the app is not active', async () => {
    await getAppRuntime().start();

    appStateListener?.('inactive');
    emit({ type: 'changed', kind: 'pairing_completed' });
    await flushMicrotasks();
    expect(mockSpaceRefreshDevices).not.toHaveBeenCalled();

    appStateListener?.('active');
    await flushMicrotasks();
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(2);
  });

  it('cancels foreground peer recovery when leaving the active state', async () => {
    await getAppRuntime().start();

    appStateListener?.('background');
    expect(mockP2pCancelPeerRecovery).toHaveBeenCalledTimes(1);
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

  it('routes events received during startup without racing the space refresh', async () => {
    let finishStart!: () => void;
    mockP2pStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const startPromise = getAppRuntime().start();
    await Promise.resolve();
    await Promise.resolve();
    emit({ type: 'peerPresenceChanged', deviceId: 'desktop-1', state: 'offline', atMs: 1 });
    finishStart();
    await startPromise;
    await flushMicrotasks();

    expect(mockSpaceRefreshDevices).toHaveBeenCalledTimes(1);
    expect(mockSpaceRefresh).toHaveBeenCalledTimes(1);
  });
});
