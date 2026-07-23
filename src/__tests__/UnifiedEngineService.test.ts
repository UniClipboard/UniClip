import { describe, expect, it, jest } from '@jest/globals';
import type { EngineConfig, EngineEvent } from 'uc-engine';
import { UnifiedEngineService, type UnifiedEngineApi } from '../services/UnifiedEngineService';
import type { UnifiedEngineSnapshot } from '../stores/unifiedEngineStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForSnapshot(
  snapshots: UnifiedEngineSnapshot[],
  predicate: (snapshot: UnifiedEngineSnapshot) => boolean
): Promise<UnifiedEngineSnapshot> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = snapshots.at(-1);
    if (snapshot && predicate(snapshot)) return snapshot;
    await Promise.resolve();
  }
  throw new Error('Expected unified engine snapshot was not published');
}

function config(): EngineConfig {
  return { appVersion: '1.2.3', profileId: 'default' };
}

describe('UnifiedEngineService', () => {
  it('starts once, publishes native state changes, and shuts down cleanly', async () => {
    const pendingEvent = deferred<EngineEvent | null>();
    const start = jest.fn(async () => undefined);
    const shutdown = jest.fn(async () => {
      pendingEvent.resolve(null);
    });
    const nextEvent = jest
      .fn<UnifiedEngineApi['nextEvent']>()
      .mockResolvedValueOnce({ type: 'stateChanged', state: 'suspended' })
      .mockImplementation(() => pendingEvent.promise);
    const snapshots: UnifiedEngineSnapshot[] = [];
    const service = new UnifiedEngineService(
      { start, shutdown, nextEvent },
      (snapshot) => snapshots.push(snapshot),
      10
    );

    await Promise.all([service.start(config()), service.start(config())]);
    const suspended = await waitForSnapshot(snapshots, (state) => state.status === 'suspended');

    expect(start).toHaveBeenCalledTimes(1);
    expect(suspended.isStarted).toBe(true);

    await service.stop();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'stopped', isStarted: false, lastError: null })
    );
  });

  it('publishes refresh, changed, and fatal events without starting another channel', async () => {
    const events: EngineEvent[] = [
      { type: 'refreshRequired', reason: 'consumerLagged' },
      { type: 'changed', kind: 'clipboard' },
      {
        type: 'fatal',
        failure: { code: 7001, category: 'runtime', retryable: false },
      },
    ];
    const shutdown = jest.fn(async () => undefined);
    const snapshots: UnifiedEngineSnapshot[] = [];
    const service = new UnifiedEngineService(
      {
        start: async () => undefined,
        shutdown,
        nextEvent: async () => events.shift() ?? null,
      },
      (snapshot) => snapshots.push(snapshot),
      0
    );

    await service.start(config());
    const failed = await waitForSnapshot(snapshots, (state) => state.status === 'failed');

    expect(failed.refreshRevision).toBe(1);
    expect(failed.lastChangedKind).toBe('clipboard');
    expect(failed.fatalFailure).toEqual({ code: 7001, category: 'runtime', retryable: false });
    expect(shutdown).not.toHaveBeenCalled();

    await service.stop();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('publishes lifecycle transition failures from the unified event stream', async () => {
    const pendingEvent = deferred<EngineEvent | null>();
    const events: EngineEvent[] = [
      {
        type: 'lifecycleFailed',
        action: 'resume',
        failure: { code: 1214, category: 'unavailable', retryable: true },
      },
    ];
    const snapshots: UnifiedEngineSnapshot[] = [];
    const service = new UnifiedEngineService(
      {
        start: async () => undefined,
        shutdown: async () => pendingEvent.resolve(null),
        nextEvent: async () => events.shift() ?? pendingEvent.promise,
      },
      (snapshot) => snapshots.push(snapshot),
      0
    );

    await service.start(config());
    const failed = await waitForSnapshot(snapshots, (state) => state.lifecycleFailure != null);

    expect(failed.lifecycleFailure).toEqual({
      action: 'resume',
      failure: { code: 1214, category: 'unavailable', retryable: true },
    });
    expect(failed.isStarted).toBe(true);

    await service.stop();
  });

  it('publishes a failed state when native startup rejects', async () => {
    const snapshots: UnifiedEngineSnapshot[] = [];
    const nextEvent = jest.fn<UnifiedEngineApi['nextEvent']>();
    const service = new UnifiedEngineService(
      {
        start: async () => {
          throw new Error('native start failed');
        },
        shutdown: async () => undefined,
        nextEvent,
      },
      (snapshot) => snapshots.push(snapshot),
      10
    );

    await expect(service.start(config())).rejects.toThrow('native start failed');

    expect(nextEvent).not.toHaveBeenCalled();
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        isStarted: false,
        lastError: 'native start failed',
      })
    );
  });

  it('can start again after the native engine reports that it stopped', async () => {
    const pendingEvent = deferred<EngineEvent | null>();
    const events: EngineEvent[] = [{ type: 'stateChanged', state: 'stopped' }];
    const start = jest.fn(async () => undefined);
    const shutdown = jest.fn(async () => {
      pendingEvent.resolve(null);
    });
    const snapshots: UnifiedEngineSnapshot[] = [];
    const service = new UnifiedEngineService(
      {
        start,
        shutdown,
        nextEvent: async () => events.shift() ?? pendingEvent.promise,
      },
      (snapshot) => snapshots.push(snapshot),
      10
    );

    await service.start(config());
    await waitForSnapshot(snapshots, (state) => state.status === 'stopped');
    await service.start(config());

    expect(start).toHaveBeenCalledTimes(2);

    await service.stop();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
