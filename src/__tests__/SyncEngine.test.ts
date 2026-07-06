import {
  enginePush,
  enginePull,
  engineApplyStaged,
  engineInit,
  engineSetServer,
  engineHandleNetworkRouteChanged,
  engineSetSettings,
  engineAcknowledgeLoopDetected,
} from 'uc-core';
import type { SyncOutcome } from 'uc-core';
import { SyncEngine, type DeviceClipboard } from '../services/SyncEngine';
import { setCurrentNetworkContext } from '../services/networkContext';

const mockedEnginePush = enginePush as jest.Mock;
const mockedEnginePull = enginePull as jest.Mock;
const mockedEngineApplyStaged = engineApplyStaged as jest.Mock;
const mockedEngineInit = engineInit as jest.Mock;
const mockedEngineSetServer = engineSetServer as jest.Mock;
const mockedEngineHandleNetworkRouteChanged = engineHandleNetworkRouteChanged as jest.Mock;
const mockedEngineSetSettings = engineSetSettings as jest.Mock;
const mockedEngineAcknowledgeLoopDetected = engineAcknowledgeLoopDetected as jest.Mock;

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
