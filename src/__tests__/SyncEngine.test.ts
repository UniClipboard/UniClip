import {
  planPreamble,
  planAfterServerGet,
  commitConverged,
  commitApply,
  commitPush,
  commitPushSkipped,
  commitTickFailure,
  commitHistorySyncDone,
  getLatest,
  putClipboard,
  isHistorySyncDue,
  handleActiveServerChanged,
  acknowledgeLoopDetection,
  markStagedApplied,
  commitStage,
  handleNetworkRouteChanged,
  cancelInFlight,
} from 'uc-core';
import { getLastSyncedHash, getLastSyncedContentId } from 'app-group-store';
import { SyncEngine } from '../services/SyncEngine';
import { setCurrentNetworkContext } from '../services/networkContext';

const mockedPlanPreamble = planPreamble as jest.Mock;
const mockedPlanAfterServerGet = planAfterServerGet as jest.Mock;
const mockedCommitConverged = commitConverged as jest.Mock;
const mockedCommitApply = commitApply as jest.Mock;
const mockedCommitPush = commitPush as jest.Mock;
const mockedCommitPushSkipped = commitPushSkipped as jest.Mock;
const mockedCommitTickFailure = commitTickFailure as jest.Mock;
const mockedCommitHistorySyncDone = commitHistorySyncDone as jest.Mock;
const mockedGetLatest = getLatest as jest.Mock;
const mockedPutClipboard = putClipboard as jest.Mock;
const mockedIsHistorySyncDue = isHistorySyncDue as jest.Mock;
const mockedHandleActiveServerChanged = handleActiveServerChanged as jest.Mock;
const mockedAcknowledgeLoopDetection = acknowledgeLoopDetection as jest.Mock;
const mockedMarkStagedApplied = markStagedApplied as jest.Mock;
const mockedCommitStage = commitStage as jest.Mock;
const mockedHandleNetworkRouteChanged = handleNetworkRouteChanged as jest.Mock;
const mockedCancelInFlight = cancelInFlight as jest.Mock;
const mockedGetLastSyncedHash = getLastSyncedHash as jest.Mock;
const mockedGetLastSyncedContentId = getLastSyncedContentId as jest.Mock;
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

const DEFAULT_STATE = {
  state: 'Idle' as const,
  lastSyncedHash: null,
  lastAppliedHash: null,
  loopEvents: [],
  stagedServerHash: null,
  stagedEntry: null,
  consecutiveFailures: 0,
  nextAttemptMs: null,
  lastHistorySyncMs: null,
};

const engines: SyncEngine[] = [];

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
    getSettings: () => ({ autoApplyRemote: true, autoPushLocal: true }),
    applyToDevice: jest.fn(),
    ...overrides,
  });
  engines.push(engine);
  return engine;
}

function setupConvergedTick() {
  mockedPlanPreamble.mockReturnValue({
    state: DEFAULT_STATE,
    preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
  });
  mockedGetLatest.mockResolvedValue({
    kind: 'Text',
    text: 'hello',
    dataName: null,
    hasData: false,
    size: 5,
    hash: 'ABCD',
    contentId: 'blake3v1:CID',
  });
  mockedPlanAfterServerGet.mockReturnValue({
    type: 'Converged',
    serverHash: 'ABCD',
  });
  const convergedState = { ...DEFAULT_STATE, lastSyncedHash: 'ABCD' };
  mockedCommitConverged.mockReturnValue(convergedState);
  mockedCommitHistorySyncDone.mockReturnValue(convergedState);
  return convergedState;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetLastSyncedHash.mockResolvedValue(null);
  mockedGetLastSyncedContentId.mockResolvedValue(null);
  mockLoadServerRouteLiveUrl.mockResolvedValue(null);
  mockSaveServerRouteLiveUrl.mockResolvedValue(undefined);
  mockUpdateHistoryItem.mockResolvedValue(undefined);
  mockedIsHistorySyncDue.mockReturnValue(false);
  setCurrentNetworkContext({ isWifi: false, isCellular: false, isTailscale: false, ssid: null });
});

afterEach(() => {
  while (engines.length > 0) {
    engines.pop()?.destroy();
  }
});

describe('SyncEngine', () => {
  test('initial status is Idle', () => {
    const engine = makeEngine();
    const status = engine.getStatus();
    expect(status.state).toBe('Idle');
    expect(status.lastSyncedAt).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.isExplicitlyRefreshing).toBe(false);
    expect(status.stagedEntry).toBeNull();
  });

  test('forceTickNow with Converged route sets Succeeded', async () => {
    const engine = makeEngine();
    setupConvergedTick();

    await engine.forceTickNow();

    expect(mockedPlanPreamble).toHaveBeenCalledTimes(1);
    expect(mockedGetLatest).toHaveBeenCalledTimes(1);
    expect(mockedPlanAfterServerGet).toHaveBeenCalledTimes(1);
    expect(mockedCommitConverged).toHaveBeenCalledWith(DEFAULT_STATE, 'ABCD', 'blake3v1:CID');

    const status = engine.getStatus();
    expect(status.state).toBe('Succeeded');
    expect(status.lastSyncedAt).not.toBeNull();
    expect(status.lastError).toBeNull();
  });

  test('retries the next active server address when getLatest cannot reach the preferred route', async () => {
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

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockImplementation(async (server) => {
      if (server.baseUrl === 'http://192.168.1.20:5033') {
        throw new Error('network timeout');
      }
      return {
        kind: 'Text',
        text: 'hello',
        dataName: null,
        hasData: false,
        size: 5,
        hash: 'ABCD',
        contentId: 'blake3v1:CID',
      };
    });
    mockedPlanAfterServerGet.mockReturnValue({
      type: 'Converged',
      serverHash: 'ABCD',
    });
    mockedCommitConverged.mockReturnValue({ ...DEFAULT_STATE, lastSyncedHash: 'ABCD' });

    await engine.forceTickNow();

    expect(mockedGetLatest.mock.calls.map((call) => call[0].baseUrl)).toEqual([
      'http://192.168.1.20:5033',
      'https://clip.example.com',
    ]);
    expect(mockSaveServerRouteLiveUrl).toHaveBeenCalledWith(
      'https://clip.example.com',
      'https://clip.example.com'
    );
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('adopts the extension App Group hash + contentId snapshot when it wrote a newer watermark', async () => {
    const engine = makeEngine();
    mockedGetLastSyncedHash.mockResolvedValue('EXTENSIONHASH');
    mockedGetLastSyncedContentId.mockResolvedValue('blake3v1:EXT');
    setupConvergedTick();

    await engine.forceTickNow();
    engine.destroy();

    expect(mockedPlanPreamble).toHaveBeenCalledWith(
      DEFAULT_STATE,
      expect.objectContaining({
        persistedSyncedHash: 'EXTENSIONHASH',
        persistedSyncedContentId: 'blake3v1:EXT',
      })
    );
  });

  test('App Group newer hash with no contentId (legacy/bare push) yields null contentId', async () => {
    const engine = makeEngine();
    mockedGetLastSyncedHash.mockResolvedValue('EXTENSIONHASH');
    mockedGetLastSyncedContentId.mockResolvedValue(null);
    setupConvergedTick();

    await engine.forceTickNow();
    engine.destroy();

    expect(mockedPlanPreamble).toHaveBeenCalledWith(
      DEFAULT_STATE,
      expect.objectContaining({
        persistedSyncedHash: 'EXTENSIONHASH',
        persistedSyncedContentId: null,
      })
    );
  });

  test('normalizes empty-placeholder (hashless) server entry to no content so autoPush proceeds', async () => {
    // 服务端无内容时为兼容官方协议返回 200 + 空 Text 占位（hash/contentId 均为
    // null）而非 404。若不归一化，reducer 会判 ServerNew(will_apply=false) 卡死
    // HasNewUnwritten，阻塞本地新内容上传。
    const engine = makeEngine({
      getDeviceClipboard: () => ({
        hash: 'NEWDEV',
        meta: {
          kind: 'Text',
          text: 'new',
          dataName: null,
          hasData: false,
          size: 3,
          hash: 'NEWDEV',
          contentId: null,
        },
      }),
    });
    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue({
      kind: 'Text',
      text: '',
      dataName: null,
      hasData: false,
      size: 0,
      hash: null,
      contentId: null,
    });
    mockedPlanAfterServerGet.mockReturnValue({ type: 'Push', decision: 'DoPush' });
    mockedCommitPush.mockReturnValue({ state: DEFAULT_STATE, outcome: { tripped: false } });

    await engine.forceTickNow();

    // 归一化生效：reducer 收到的 serverEntry 应为 null（而非 hashless 占位）
    expect(mockedPlanAfterServerGet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serverEntry: null })
    );
    // 因而走 Push → 本地新内容实际上传
    expect(mockedPutClipboard).toHaveBeenCalled();
  });

  test('drops stale App Group watermark when server still matches the local baseline (reconcile)', async () => {
    // App Group 里残留陈旧水位线被 preamble fold 进 baseline，但服务端当前内容其实
    // 等于本地基线 → 应把 baseline 校正回本地，避免没变的服务端内容被误判 ServerNew、
    // 把设备新内容覆盖掉且永远推不上去。
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    AsyncStorage.multiGet.mockResolvedValue([
      ['@syncengine:last_synced_hash', 'LOCAL'],
      ['@syncengine:last_synced_content_id', 'blake3v1:LOCALCID'],
    ]);
    mockedGetLastSyncedHash.mockResolvedValue('STALE');
    mockedGetLastSyncedContentId.mockResolvedValue('blake3v1:STALECID');

    const engine = makeEngine({
      getDeviceClipboard: () => ({
        hash: 'NEWDEV',
        meta: {
          kind: 'Text',
          text: 'new',
          dataName: null,
          hasData: false,
          size: 3,
          hash: 'NEWDEV',
          contentId: null,
        },
      }),
    });

    // preamble fold：陈旧 App Group 水位线顶掉了本地基线。
    const foldedState = {
      ...DEFAULT_STATE,
      lastSyncedHash: 'STALE',
      lastSyncedContentId: 'blake3v1:STALECID',
    };
    mockedPlanPreamble.mockReturnValue({
      state: foldedState,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    // 服务端当前内容 == 本地基线（未变）。
    mockedGetLatest.mockResolvedValue({
      kind: 'Text',
      text: 'hi',
      dataName: null,
      hasData: false,
      size: 2,
      hash: 'LOCAL',
      contentId: 'blake3v1:LOCALCID',
    });
    mockedPlanAfterServerGet.mockReturnValue({ type: 'Push', decision: 'DoPush' });
    mockedCommitPush.mockReturnValue({ state: foldedState, outcome: { tripped: false } });

    await engine.forceTickNow();

    // reconcile 把 baseline 从陈旧 STALE 纠正回本地 LOCAL，再交给 reducer 判路由。
    expect(mockedPlanAfterServerGet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedHash: 'LOCAL',
        lastSyncedContentId: 'blake3v1:LOCALCID',
      }),
      expect.anything()
    );
  });

  test('preamble Stop(NoActiveServer) sets Idle', async () => {
    const engine = makeEngine({ getActiveServer: () => null });
    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'NoActiveServer' } },
    });

    await engine.forceTickNow();

    expect(mockedGetLatest).not.toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Idle');
  });

  test('preamble Stop(BackoffGated) does not change state', async () => {
    const engine = makeEngine();
    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'BackoffGated' } },
    });

    await engine.forceTickNow();

    expect(mockedGetLatest).not.toHaveBeenCalled();
  });

  // 回归：Stop 日志曾每个 tick(1Hz) 打一条，叠加日志文件整读整写导致
  // 每秒 ~100ms JS 冻结（见 Logger.appendOnly.test.ts）。同因连发只记第一条。
  test('preamble Stop 同一原因连发只记一条日志，恢复后可再次记录', async () => {
    const { log } = require('../services/Logger');
    const infoSpy = jest.spyOn(log, 'info');
    const stopLogCount = () =>
      infoSpy.mock.calls.filter((c) => String(c[0]).includes('Stop(NoActiveServer)')).length;

    const engine = makeEngine({ getActiveServer: () => null });
    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'NoActiveServer' } },
    });

    await engine.forceTickNow();
    await engine.forceTickNow();
    await engine.forceTickNow();
    expect(stopLogCount()).toBe(1);

    // 一次正常 tick 之后再次 Stop，应重新记录
    setupConvergedTick();
    await engine.forceTickNow();
    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'NoActiveServer' } },
    });
    await engine.forceTickNow();
    expect(stopLogCount()).toBe(2);

    infoSpy.mockRestore();
  });

  test('ServerNew with willApply calls applyToDevice', async () => {
    const applyMock = jest.fn();
    const engine = makeEngine({ applyToDevice: applyMock });

    const entry = {
      kind: 'Text' as const,
      text: 'new text',
      dataName: null,
      hasData: false,
      size: 8,
      hash: 'NEWH',
    };

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue(entry);
    mockedPlanAfterServerGet.mockReturnValue({
      type: 'ServerNew',
      plan: { willApply: true, alreadyStaged: false },
    });
    const appliedState = { ...DEFAULT_STATE, lastSyncedHash: 'NEWH' };
    mockedCommitApply.mockReturnValue({ state: appliedState, outcome: { tripped: false } });
    mockedCommitHistorySyncDone.mockReturnValue(appliedState);

    await engine.forceTickNow();

    expect(applyMock).toHaveBeenCalledWith(entry, undefined);
    expect(mockedCommitApply).toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('ServerNew without willApply sets HasNewUnwritten', async () => {
    const engine = makeEngine();
    const entry = {
      kind: 'Text' as const,
      text: 'staged',
      dataName: null,
      hasData: false,
      size: 6,
      hash: 'STG1',
    };

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue(entry);
    mockedPlanAfterServerGet.mockReturnValue({
      type: 'ServerNew',
      plan: { willApply: false, alreadyStaged: false },
    });
    mockedCommitStage.mockReturnValue({ ...DEFAULT_STATE, stagedServerHash: 'STG1' });
    mockedCommitHistorySyncDone.mockReturnValue(DEFAULT_STATE);

    await engine.forceTickNow();

    expect(engine.getStatus().state).toBe('HasNewUnwritten');
    expect(engine.getStatus().stagedEntry).toBe(entry);
  });

  test('Push DoPush calls putClipboard', async () => {
    const deviceMeta = {
      kind: 'Text' as const,
      text: 'local',
      dataName: null,
      hasData: false,
      size: 5,
      hash: 'LOCH',
    };
    const engine = makeEngine({
      getDeviceClipboard: () => ({ hash: 'LOCH', meta: deviceMeta }),
    });

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue(null);
    mockedPlanAfterServerGet.mockReturnValue({
      type: 'Push',
      decision: 'DoPush',
    });
    const pushedState = { ...DEFAULT_STATE, lastSyncedHash: 'LOCH' };
    mockedCommitPush.mockReturnValue({ state: pushedState, outcome: { tripped: false } });
    mockedPutClipboard.mockResolvedValue(undefined);
    mockedCommitHistorySyncDone.mockReturnValue(pushedState);

    await engine.forceTickNow();

    expect(mockedPutClipboard).toHaveBeenCalled();
    expect(mockUpdateHistoryItem).toHaveBeenCalledWith(
      'LOCH',
      expect.objectContaining({
        syncStatus: 1,
      })
    );
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('Push SkipAlreadySynced does not call putClipboard', async () => {
    const engine = makeEngine();

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue({
      kind: 'Text',
      text: 'x',
      dataName: null,
      hasData: false,
      size: 1,
      hash: 'H1',
    });
    mockedPlanAfterServerGet.mockReturnValue({
      type: 'Push',
      decision: 'SkipAlreadySynced',
    });
    mockedCommitPushSkipped.mockReturnValue(DEFAULT_STATE);
    mockedCommitHistorySyncDone.mockReturnValue(DEFAULT_STATE);

    await engine.forceTickNow();

    expect(mockedPutClipboard).not.toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Succeeded');
  });

  test('network error sets OfflineRetrying', async () => {
    const engine = makeEngine();

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockRejectedValue(new Error('Network unreachable'));
    const failState = { ...DEFAULT_STATE, consecutiveFailures: 1 };
    mockedCommitTickFailure.mockReturnValue({
      state: failState,
      outcome: { kickProbe: true, firstOffline: true },
    });

    await engine.forceTickNow();

    expect(mockedCommitTickFailure).toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('OfflineRetrying');
    expect(engine.getStatus().lastError).toContain('Network unreachable');
  });

  test('auth error sets AuthFailed and stops', async () => {
    const engine = makeEngine();

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockRejectedValue(new Error('401 Unauthorized'));

    await engine.forceTickNow();

    expect(engine.getStatus().state).toBe('AuthFailed');
  });

  test('listener receives status updates', async () => {
    const engine = makeEngine();
    setupConvergedTick();

    const listener = jest.fn();
    engine.addListener(listener);

    await engine.forceTickNow();

    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(lastCall.state).toBe('Succeeded');
  });

  test('handleServerChanged resets state', async () => {
    const engine = makeEngine();
    mockedHandleActiveServerChanged.mockReturnValue(DEFAULT_STATE);

    await engine.handleServerChanged();

    expect(mockedHandleActiveServerChanged).toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Idle');
  });

  test('acknowledgeLoop clears LoopDetected', async () => {
    const engine = makeEngine();
    mockedAcknowledgeLoopDetection.mockReturnValue(DEFAULT_STATE);

    await engine.acknowledgeLoop();

    expect(mockedAcknowledgeLoopDetection).toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Idle');
  });

  test('applyStagedEntry clears staged state', async () => {
    const engine = makeEngine();
    mockedMarkStagedApplied.mockReturnValue({
      state: { ...DEFAULT_STATE, lastSyncedHash: 'STG1' },
      wasStaged: true,
    });

    await engine.applyStagedEntry();

    expect(mockedMarkStagedApplied).toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('Succeeded');
    expect(engine.getStatus().stagedEntry).toBeNull();
  });

  test('handleNetworkChanged cancels in-flight and clears backoff', () => {
    const engine = makeEngine();
    mockedHandleNetworkRouteChanged.mockReturnValue(DEFAULT_STATE);

    engine.handleNetworkChanged();

    expect(mockedCancelInFlight).toHaveBeenCalled();
    expect(mockedHandleNetworkRouteChanged).toHaveBeenCalled();
  });

  test('tripped loop detection sets LoopDetected', async () => {
    const engine = makeEngine({
      getDeviceClipboard: () => ({
        hash: 'X',
        meta: { kind: 'Text', text: 'x', dataName: null, hasData: false, size: 1, hash: 'X' },
      }),
    });

    mockedPlanPreamble.mockReturnValue({
      state: DEFAULT_STATE,
      preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } },
    });
    mockedGetLatest.mockResolvedValue(null);
    mockedPlanAfterServerGet.mockReturnValue({ type: 'Push', decision: 'DoPush' });
    mockedPutClipboard.mockResolvedValue(undefined);
    mockedCommitPush.mockReturnValue({
      state: DEFAULT_STATE,
      outcome: { tripped: true },
    });

    await engine.forceTickNow();

    expect(engine.getStatus().state).toBe('LoopDetected');
    expect(engine.getStatus().lastError).toContain('loop');
  });
});
