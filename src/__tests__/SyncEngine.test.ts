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
import { getLastSyncedHash } from 'app-group-store';
import { SyncEngine } from '../services/SyncEngine';

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
  mockedIsHistorySyncDue.mockReturnValue(false);
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

  test('uses App Group last synced hash and clears content id when extension wrote a newer watermark', async () => {
    const engine = makeEngine();
    mockedGetLastSyncedHash.mockResolvedValue('EXTENSIONHASH');
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
