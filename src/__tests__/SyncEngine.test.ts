import {
  enginePush,
  enginePull,
  engineApplyStaged,
  engineInit,
  engineSetServer,
  engineHandleNetworkRouteChanged,
  engineSetSettings,
  engineAcknowledgeLoopDetected,
  healthProbe,
  putClipboard,
} from 'uc-core';
import type { SyncOutcome } from 'uc-core';
import { SyncEngine, type DeviceClipboard } from '../services/SyncEngine';
import { setCurrentNetworkContext } from '../services/networkContext';
import { HistorySyncStatus } from '../types/clipboard';

const mockLogError = jest.fn();
const mockLogInfo = jest.fn();

jest.mock('../services/Logger', () => ({
  log: {
    debug: jest.fn(),
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

const mockGetHistoryItem = jest.fn();
jest.mock('@/services', () => ({
  historyStorage: { getItem: (...args: unknown[]) => mockGetHistoryItem(...args) },
}));
const mockedPutClipboard = putClipboard as jest.Mock;

const mockedEnginePush = enginePush as jest.Mock;
const mockedEnginePull = enginePull as jest.Mock;
const mockedEngineApplyStaged = engineApplyStaged as jest.Mock;
const mockedEngineInit = engineInit as jest.Mock;
const mockedEngineSetServer = engineSetServer as jest.Mock;
const mockedEngineHandleNetworkRouteChanged = engineHandleNetworkRouteChanged as jest.Mock;
const mockedEngineSetSettings = engineSetSettings as jest.Mock;
const mockedEngineAcknowledgeLoopDetected = engineAcknowledgeLoopDetected as jest.Mock;
const mockedHealthProbe = healthProbe as jest.Mock;

const mockLoadServerRouteLiveUrl = jest.fn();
const mockSaveServerRouteLiveUrl = jest.fn();
const mockUpdateHistoryItem = jest.fn();

jest.mock('../services/serverRouteRecordStore', () => ({
  loadServerRouteLiveUrl: (...args: unknown[]) => mockLoadServerRouteLiveUrl(...args),
  saveServerRouteLiveUrl: (...args: unknown[]) => mockSaveServerRouteLiveUrl(...args),
}));

jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({
      updateItem: (...args: unknown[]) => mockUpdateHistoryItem(...args),
    }),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
const settlePromises = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

const engines: SyncEngine[] = [];

const TEXT_DEVICE: DeviceClipboard = {
  hash: 'LOCH',
  meta: {
    kind: 'Text',
    text: 'local',
    dataName: null,
    hasData: false,
    size: 5,
    hash: 'LOCH',
    contentId: null,
  },
};

function makeEngine(overrides?: Partial<ConstructorParameters<typeof SyncEngine>[0]>) {
  const engine = new SyncEngine({
    getActiveServer: () => ({
      baseUrl: 'http://test.local',
      urls: ['http://test.local'],
      username: 'user',
      password: 'pass',
      trustInsecureCert: false,
    }),
    getDeviceClipboard: () => null,
    getSettings: () => ({ autoApplyRemote: true, autoPushLocal: true, enableSse: false }),
    applyToDevice: jest.fn(),
    ...overrides,
  });
  engines.push(engine);
  return engine;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadServerRouteLiveUrl.mockResolvedValue(null);
  mockSaveServerRouteLiveUrl.mockResolvedValue(undefined);
  mockUpdateHistoryItem.mockResolvedValue(undefined);
  // 默认:pull/push 都回 UpToDate,单个用例再各自覆盖。
  mockedEnginePull.mockResolvedValue({ tag: 'UpToDate', reason: 'AlreadySynced' } as SyncOutcome);
  mockedEnginePush.mockResolvedValue({ tag: 'UpToDate', reason: 'NoLocalChange' } as SyncOutcome);
  mockedHealthProbe.mockImplementation(
    async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
      networkEpoch,
      results: {},
    })
  );
  setCurrentNetworkContext({ isWifi: false, isCellular: false, isTailscale: false, ssid: null });
});

afterEach(() => {
  while (engines.length > 0) {
    engines.pop()?.destroy();
  }
});

describe('SyncEngine coordinator', () => {
  test('initial status is Idle', () => {
    const engine = makeEngine();
    const status = engine.getStatus();
    expect(status.state).toBe('Idle');
    expect(status.lastSyncedAt).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.isExplicitlyRefreshing).toBe(false);
    expect(status.stagedEntry).toBeNull();
  });

  // -- 触发接线 --

  test('explicitRefresh drives enginePull(Explicit) and constructs the engine once', async () => {
    const engine = makeEngine();

    await engine.explicitRefresh();

    expect(mockedEngineInit).toHaveBeenCalledTimes(1);
    expect(mockedEnginePull).toHaveBeenCalledTimes(1);
    expect(mockedEnginePull.mock.calls[0][0]).toEqual({ tag: 'Explicit' });
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('notifyLocalChanged pushes the current device content via enginePush', async () => {
    const engine = makeEngine({ getDeviceClipboard: () => TEXT_DEVICE });
    mockedEnginePush.mockResolvedValue({
      tag: 'Uploaded',
      meta: { kind: 'Text', hash: 'LOCH', contentId: null, text: 'local', size: 5 },
    } as SyncOutcome);

    engine.notifyLocalChanged();
    await flush();

    expect(mockedEnginePush).toHaveBeenCalledTimes(1);
    expect(mockedEnginePush.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'Text', text: 'local', dataName: null })
    );
    // Uploaded → 历史行标记为已同步。
    expect(mockUpdateHistoryItem).toHaveBeenCalledWith(
      'LOCH',
      expect.objectContaining({ syncStatus: 1 })
    );
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('consent mode (autoPushLocal off) does not auto-push local content', async () => {
    const engine = makeEngine({
      getDeviceClipboard: () => TEXT_DEVICE,
      getSettings: () => ({ autoApplyRemote: true, autoPushLocal: false, enableSse: false }),
    });

    engine.notifyLocalChanged();
    await flush();

    expect(mockedEnginePush).not.toHaveBeenCalled();
  });

  // -- SyncOutcome 翻译 --

  test('Applied outcome writes back to device and marks Succeeded', async () => {
    const applyMock = jest.fn().mockResolvedValue(undefined);
    const engine = makeEngine({ applyToDevice: applyMock });
    mockedEnginePull.mockResolvedValue({
      tag: 'Applied',
      content: { kind: 'Text', text: 'hello', dataName: null, payload: null },
      meta: { kind: 'Text', hash: 'ABCD', contentId: 'blake3v1:CID', text: 'hello', size: 5 },
    } as SyncOutcome);

    await engine.explicitRefresh();

    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kind: 'Text', hash: 'ABCD', contentId: 'blake3v1:CID' })
    );
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('Staged outcome sets HasNewUnwritten with a preview', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({
      tag: 'Staged',
      preview: { kind: 'Text', text: 'staged', size: 6 },
    } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('HasNewUnwritten');
    expect(engine.getStatus().stagedEntry).toEqual(
      expect.objectContaining({ kind: 'Text', text: 'staged' })
    );
  });

  test('UpToDate outcome sets Succeeded', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({ tag: 'UpToDate', reason: 'Converged' } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('Succeeded');
    expect(engine.getStatus().lastError).toBeNull();
  });

  test('BackingOff outcome does not flip to an error state', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({ tag: 'BackingOff', retryAfterMs: 5000 } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('Idle');
    expect(engine.getStatus().lastError).toBeNull();
  });

  test('LoopDetected outcome trips the loop breaker', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({ tag: 'LoopDetected' } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('LoopDetected');
    expect(engine.getStatus().lastError).toContain('loop');
  });

  test('Failed(network) outcome sets OfflineRetrying', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('OfflineRetrying');
    expect(engine.getStatus().lastError).toContain('Network unreachable');
  });

  test('repeated blank failures keep useful detail without repeating error logs', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({ tag: 'Failed', error: '' } as SyncOutcome);

    await engine.explicitRefresh();
    await engine.explicitRefresh();

    expect(engine.getStatus().lastError).toBe('Native sync failed without error details');
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      '[SyncEngine] op error:',
      'Native sync failed without error details'
    );
  });

  test('Failed(auth) outcome sets AuthFailed', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockResolvedValue({
      tag: 'Failed',
      error: '401 Unauthorized',
    } as SyncOutcome);

    await engine.explicitRefresh();

    expect(engine.getStatus().state).toBe('AuthFailed');
  });

  test('a thrown FFI error is translated as a failure, not a crash', async () => {
    const engine = makeEngine();
    mockedEnginePull.mockRejectedValue(new Error('Network unreachable'));

    await expect(engine.explicitRefresh()).resolves.toBeUndefined();
    expect(engine.getStatus().state).toBe('OfflineRetrying');
  });

  // -- 生命周期 --

  test('applyStagedEntry drives engineApplyStaged and applies the result', async () => {
    const applyMock = jest.fn().mockResolvedValue(undefined);
    const engine = makeEngine({ applyToDevice: applyMock });
    // 先构造引擎(否则 applyStagedEntry 直接返回)。
    await engine.explicitRefresh();

    mockedEngineApplyStaged.mockResolvedValue({
      tag: 'Applied',
      content: { kind: 'Text', text: 'staged now', dataName: null, payload: null },
      meta: { kind: 'Text', hash: 'STG1', contentId: null, text: 'staged now', size: 10 },
    } as SyncOutcome);

    await engine.applyStagedEntry();

    expect(mockedEngineApplyStaged).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Text', hash: 'STG1' }),
      undefined
    );
    expect(engine.getStatus().state).toBe('Succeeded');
    expect(engine.getStatus().stagedEntry).toBeNull();
  });

  test('acknowledgeLoop clears LoopDetected via the engine', async () => {
    const engine = makeEngine();
    // 先构造引擎。
    await engine.explicitRefresh();

    await engine.acknowledgeLoop();

    expect(mockedEngineAcknowledgeLoopDetected).toHaveBeenCalledTimes(1);
    expect(engine.getStatus().state).toBe('Idle');
  });

  test('handleServerChanged resets to Idle', async () => {
    const engine = makeEngine();
    await engine.explicitRefresh();

    await engine.handleServerChanged();

    expect(engine.getStatus().state).toBe('Idle');
  });

  test('handleNetworkChanged clears engine backoff', async () => {
    const engine = makeEngine();
    await engine.explicitRefresh();

    engine.handleNetworkChanged();
    await flush();

    expect(mockedEngineHandleNetworkRouteChanged).toHaveBeenCalled();
  });

  test('applySettings pushes auto_apply to the engine', async () => {
    const engine = makeEngine();
    await engine.explicitRefresh();

    await engine.applySettings();

    expect(mockedEngineSetSettings).toHaveBeenCalledWith({ autoApply: true });
  });

  test('listener receives status updates', async () => {
    const engine = makeEngine();
    const listener = jest.fn();
    engine.addListener(listener);

    await engine.explicitRefresh();

    expect(listener).toHaveBeenCalled();
    const last = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(last.state).toBe('Succeeded');
  });

  // -- Option A URL 解析 --

  test('resolves the network-preferred (LAN on wifi) URL when constructing the engine', async () => {
    const engine = makeEngine({
      getActiveServer: () => ({
        baseUrl: 'https://clip.example.com',
        urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
        username: 'user',
        password: 'pass',
        trustInsecureCert: false,
      }),
    });
    setCurrentNetworkContext({ isWifi: true, isCellular: false, isTailscale: false, ssid: null });

    await engine.explicitRefresh();

    // wifi 偏好 LAN → 引擎按 192.168 局域网地址构造。
    expect(mockedEngineInit).toHaveBeenCalledTimes(1);
    expect(mockedEngineInit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ baseUrl: 'http://192.168.1.20:5033' })
    );
  });

  test('offline failover tries each alternate URL once without resetting into a 1Hz switch loop', async () => {
    const engine = makeEngine({
      getActiveServer: () => ({
        baseUrl: 'http://100.114.7.75:42720',
        urls: ['http://100.114.7.75:42720', 'http://192.168.1.130:42720'],
        username: 'user',
        password: 'pass',
        trustInsecureCert: false,
      }),
    });
    mockedEnginePull.mockResolvedValue({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);

    for (let attempt = 0; attempt < 4; attempt++) {
      await engine.explicitRefresh();
      await flush();
    }

    expect(mockedEngineSetServer).toHaveBeenCalledTimes(1);
    expect(mockedEngineSetServer).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.130:42720' })
    );
  });

  test('re-resolving to a different live URL reconfigures the engine via engineSetServer', async () => {
    let onWifi = false;
    const engine = makeEngine({
      getActiveServer: () => ({
        baseUrl: 'https://clip.example.com',
        urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
        username: 'user',
        password: 'pass',
        trustInsecureCert: false,
      }),
    });

    // 首次在蜂窝网:偏好 WAN 域名。
    setCurrentNetworkContext({ isWifi: false, isCellular: true, isTailscale: false, ssid: null });
    await engine.explicitRefresh();
    expect(mockedEngineInit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ baseUrl: 'https://clip.example.com' })
    );

    // 切到 wifi:偏好翻转到 LAN → 网络变化触发重解析 + engineSetServer。
    onWifi = true;
    void onWifi;
    setCurrentNetworkContext({ isWifi: true, isCellular: false, isTailscale: false, ssid: null });
    engine.handleNetworkChanged();
    await flush();

    expect(mockedEngineSetServer).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.20:5033' })
    );
  });
});

describe('SyncEngine offline recovery probe', () => {
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    while (engines.length > 0) engines.pop()?.destroy();
    randomSpy.mockRestore();
    jest.useRealTimers();
  });

  async function startOffline(engine: SyncEngine): Promise<void> {
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);
    engine.start();
    await settlePromises();
    expect(engine.getStatus().state).toBe('OfflineRetrying');
  }

  test('foreground health success selects the route and triggers one real sync within 2 seconds', async () => {
    const engine = makeEngine();
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'Success' },
      })
    );
    await startOffline(engine);
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'UpToDate',
      reason: 'AlreadySynced',
    } as SyncOutcome);

    await jest.advanceTimersByTimeAsync(1_999);
    expect(mockedHealthProbe).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await settlePromises();

    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);
    expect(mockSaveServerRouteLiveUrl).toHaveBeenCalledWith(
      'http://test.local',
      'http://test.local'
    );
    expect(mockedEnginePull).toHaveBeenCalledTimes(2);
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('keeps one health round in flight and discards a stale network epoch result', async () => {
    let resolveProbe: ((value: unknown) => void) | null = null;
    mockedHealthProbe.mockImplementation(
      (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) =>
        new Promise((resolve) => {
          resolveProbe = (value?: unknown) =>
            resolve(
              value ?? {
                networkEpoch,
                results: { 'http://test.local': 'Success' },
              }
            );
        })
    );
    const engine = makeEngine();
    await startOffline(engine);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);

    engine.handleNetworkChanged();
    await settlePromises();
    resolveProbe?.(undefined);
    await settlePromises();

    expect(mockedEnginePull).toHaveBeenCalledTimes(1);
    expect(engine.getStatus().state).toBe('OfflineRetrying');
  });

  test('uses 10 second cadence while an inactive background engine remains running', async () => {
    const engine = makeEngine();
    await startOffline(engine);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);

    engine.setSceneInactive(true);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await settlePromises();
    expect(mockedHealthProbe).toHaveBeenCalledTimes(2);
  });

  test('confirms a 404 with real sync before using the 15 second legacy cadence', async () => {
    const engine = makeEngine();
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'NotSupported' },
      })
    );
    await startOffline(engine);
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'UpToDate',
      reason: 'AlreadySynced',
    } as SyncOutcome);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(engine.getStatus().state).toBe('Succeeded');
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);

    mockedEnginePull.mockResolvedValueOnce({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);
    await engine.explicitRefresh();
    expect(engine.getStatus().state).toBe('OfflineRetrying');

    await jest.advanceTimersByTimeAsync(14_999);
    expect(mockedEnginePull).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    await settlePromises();
    expect(mockedEnginePull).toHaveBeenCalledTimes(4);
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);
  });

  test('a previously supported server falls back after a later 404 is confirmed', async () => {
    const engine = makeEngine();
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'Success' },
      })
    );
    await startOffline(engine);
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'UpToDate',
      reason: 'AlreadySynced',
    } as SyncOutcome);
    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(engine.getStatus().state).toBe('Succeeded');

    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'NotSupported' },
      })
    );
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);
    await engine.explicitRefresh();
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'UpToDate',
      reason: 'AlreadySynced',
    } as SyncOutcome);
    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();

    expect(mockedHealthProbe).toHaveBeenCalledTimes(2);
    expect(engine.getStatus().state).toBe('Succeeded');

    mockedEnginePull.mockResolvedValueOnce({
      tag: 'Failed',
      error: 'Network unreachable',
    } as SyncOutcome);
    await engine.explicitRefresh();
    await jest.advanceTimersByTimeAsync(14_999);
    expect(mockedEnginePull).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(1);
    await settlePromises();
    expect(mockedEnginePull).toHaveBeenCalledTimes(6);
    expect(mockedHealthProbe).toHaveBeenCalledTimes(2);
  });

  test('stale health success cannot commit a delayed route cache write', async () => {
    const engine = makeEngine({
      getActiveServer: () => ({
        baseUrl: 'https://clip.example.com',
        urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
        username: 'user',
        password: 'pass',
        trustInsecureCert: false,
      }),
    });
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://192.168.1.20:5033': 'Success' },
      })
    );
    const routeWrite = deferred<void>();
    mockSaveServerRouteLiveUrl.mockImplementationOnce(() => routeWrite.promise);
    await startOffline(engine);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(mockSaveServerRouteLiveUrl).toHaveBeenCalledWith(
      'https://clip.example.com',
      'http://192.168.1.20:5033'
    );

    engine.handleNetworkChanged();
    await settlePromises();
    routeWrite.resolve();
    await settlePromises();

    expect(mockedEngineSetServer).not.toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.20:5033' })
    );
    expect(mockedEnginePull).toHaveBeenCalledTimes(1);
  });

  test('stale native route mutation is restored to the current network route', async () => {
    const engine = makeEngine({
      getActiveServer: () => ({
        baseUrl: 'https://clip.example.com',
        urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
        username: 'user',
        password: 'pass',
        trustInsecureCert: false,
      }),
    });
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://192.168.1.20:5033': 'Success' },
      })
    );
    const routeMutation = deferred<void>();
    mockedEngineSetServer.mockImplementationOnce(() => routeMutation.promise);
    await startOffline(engine);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(mockedEngineSetServer).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.1.20:5033' })
    );

    engine.handleNetworkChanged();
    await settlePromises();
    routeMutation.resolve();
    await settlePromises();

    const lastServer = mockedEngineSetServer.mock.calls.at(-1)?.[0];
    expect(lastServer).toEqual(expect.objectContaining({ baseUrl: 'https://clip.example.com' }));
    expect(mockedEnginePull).toHaveBeenCalledTimes(1);
  });

  test('health success followed by 401 stops recovery probes', async () => {
    const engine = makeEngine();
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'Success' },
      })
    );
    await startOffline(engine);
    mockedEnginePull.mockResolvedValueOnce({
      tag: 'Failed',
      error: '401 Unauthorized',
    } as SyncOutcome);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(engine.getStatus().state).toBe('AuthFailed');

    engine.start();
    await settlePromises();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(engine.getStatus().state).toBe('AuthFailed');
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);
    expect(mockedEnginePull).toHaveBeenCalledTimes(2);
  });

  test('health success followed by another network failure re-enters one probe loop', async () => {
    const engine = makeEngine();
    mockedHealthProbe.mockImplementation(
      async (_urls: string[], _trust: boolean, _timeout: number, networkEpoch: number) => ({
        networkEpoch,
        results: { 'http://test.local': 'Success' },
      })
    );
    await startOffline(engine);
    mockedEnginePull
      .mockResolvedValueOnce({ tag: 'Failed', error: 'Network unreachable' } as SyncOutcome)
      .mockResolvedValueOnce({ tag: 'UpToDate', reason: 'AlreadySynced' } as SyncOutcome);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(engine.getStatus().state).toBe('OfflineRetrying');
    expect(mockedHealthProbe).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);
    await settlePromises();
    expect(mockedHealthProbe).toHaveBeenCalledTimes(2);
    expect(mockedEnginePull).toHaveBeenCalledTimes(3);
    expect(engine.getStatus().state).toBe('Succeeded');
  });
});

describe('SyncEngine.pushRecordExplicit (显式上传直传)', () => {
  const TEXT_RECORD = {
    profileHash: 'HASH_TEXT',
    type: 'Text',
    text: 'hello',
    dataName: undefined,
    hasData: false,
    size: 5,
    syncStatus: HistorySyncStatus.LocalOnly,
  };

  beforeEach(() => {
    mockedPutClipboard.mockResolvedValue(undefined);
  });

  test('文本记录:直传 putClipboard 并把该行标记 Synced（不走 enginePush）', async () => {
    const engine = makeEngine();
    mockGetHistoryItem.mockResolvedValue({ ...TEXT_RECORD });

    await engine.pushRecordExplicit('HASH_TEXT');

    expect(mockedPutClipboard).toHaveBeenCalledTimes(1);
    const [ucServer, meta, payload, trust] = mockedPutClipboard.mock.calls[0];
    expect(ucServer).toEqual(expect.objectContaining({ baseUrl: 'http://test.local' }));
    expect(meta).toEqual(
      expect.objectContaining({ kind: 'Text', dataName: null, hasData: false, hash: 'HASH_TEXT' })
    );
    expect(payload).toBeUndefined();
    expect(trust).toBe(false);
    // markHistoryPushed → 标记 Synced
    expect(mockUpdateHistoryItem).toHaveBeenCalledWith('HASH_TEXT', {
      syncStatus: HistorySyncStatus.Synced,
      hasRemoteData: false,
    });
    // 显式上传绝不经过引擎去重
    expect(mockedEnginePush).not.toHaveBeenCalled();
  });

  test('已 Synced 的记录:幂等直返,不发 putClipboard', async () => {
    const engine = makeEngine();
    mockGetHistoryItem.mockResolvedValue({ ...TEXT_RECORD, syncStatus: HistorySyncStatus.Synced });

    await engine.pushRecordExplicit('HASH_TEXT');

    expect(mockedPutClipboard).not.toHaveBeenCalled();
    expect(mockUpdateHistoryItem).not.toHaveBeenCalled();
  });

  test('记录不存在:抛错', async () => {
    const engine = makeEngine();
    mockGetHistoryItem.mockResolvedValue(null);

    await expect(engine.pushRecordExplicit('MISSING')).rejects.toThrow(/not found/);
    expect(mockedPutClipboard).not.toHaveBeenCalled();
  });

  test('文件记录:读字节 + meta.dataName 纵深防御清洗（去掉 ?t= 等非法字符）', async () => {
    const engine = makeEngine();
    mockGetHistoryItem.mockResolvedValue({
      profileHash: 'HASH_FILE',
      type: 'File',
      text: 'doc.pdf',
      dataName: 'doc?t=SIGNED.pdf', // 签名 URL 残留的坏名
      hasData: true,
      size: 123,
      fileUri: 'file://cache/doc.pdf',
      syncStatus: HistorySyncStatus.LocalOnly,
    });

    await engine.pushRecordExplicit('HASH_FILE');

    const [, meta, payload] = mockedPutClipboard.mock.calls[0];
    expect(meta.dataName).toBe('doc_t=SIGNED.pdf'); // ? → _,服务端 staging 才不 500
    expect(meta.dataName).not.toMatch(/\?/);
    expect(meta.hasData).toBe(true);
    expect(payload).toBeInstanceOf(Uint8Array);
  });

  test('putClipboard 抛错（离线/5xx）向上传播,不标记 Synced', async () => {
    const engine = makeEngine();
    mockGetHistoryItem.mockResolvedValue({ ...TEXT_RECORD });
    mockedPutClipboard.mockRejectedValue(new Error('ServerError(status: 500)'));

    await expect(engine.pushRecordExplicit('HASH_TEXT')).rejects.toThrow(/500/);
    expect(mockUpdateHistoryItem).not.toHaveBeenCalled();
  });
});
