import { describe, expect, it, jest } from '@jest/globals';
import type {
  EngineEvent,
  EntryReceiveCancellation,
  ReceiveItem,
  ReceiveProgress,
  ReceiveRetryOutcome,
} from 'uc-engine';
import {
  ReceiveResultsService,
  describeReceiveEntry,
  type ReceiveResultsApi,
  type ReceiveResultsSnapshot,
} from '../features/transfer/internal/receiveResults';

jest.mock('@/support/observability', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function item(itemId: string, state: string, failureReason: string | null = null): ReceiveItem {
  return { itemId, kind: 'file', state, failureReason };
}

function progress(
  state: string,
  items: ReceiveItem[],
  overrides: Partial<ReceiveProgress> = {}
): ReceiveProgress {
  return {
    entryId: 'entry-1',
    attemptId: 'attempt-1',
    state,
    totalBytes: 300,
    completedBytes: 100,
    itemsTotal: items.length,
    itemsCompleted: items.filter((candidate) => candidate.state === 'completed').length,
    items,
    ...overrides,
  };
}

class FakeEvents {
  private readonly subscribers = new Set<(event: EngineEvent) => void>();
  subscribeEvents(subscriber: (event: EngineEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
  emit(event: EngineEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
  get size(): number {
    return this.subscribers.size;
  }
}

function stateEvent(entryId: string, attemptId: string, state: string): EngineEvent {
  return { type: 'receiveAttemptStateChanged', entryId, attemptId, state };
}

function createApi(overrides: Partial<ReceiveResultsApi> = {}): jest.Mocked<ReceiveResultsApi> {
  return {
    listEntryReceiveProgress: jest.fn<ReceiveResultsApi['listEntryReceiveProgress']>(async () => []),
    queryEntryReceiveProgress: jest.fn<ReceiveResultsApi['queryEntryReceiveProgress']>(
      async () => null
    ),
    retryEntryReceive: jest.fn<ReceiveResultsApi['retryEntryReceive']>(async () => ({
      kind: 'alreadyReceiving',
    })),
    cancelEntryReceive: jest.fn<ReceiveResultsApi['cancelEntryReceive']>(async () => 'cancelled'),
    ...overrides,
  } as jest.Mocked<ReceiveResultsApi>;
}

function createService(api: ReceiveResultsApi, events = new FakeEvents()) {
  const snapshots: ReceiveResultsSnapshot[] = [];
  const service = new ReceiveResultsService(api, events, (snapshot) => snapshots.push(snapshot));
  return { service, events, snapshots };
}

describe('describeReceiveEntry', () => {
  it('keeps delivered items completed and offers only failed or cancelled items after a terminal failure', () => {
    const view = describeReceiveEntry(
      progress('failed', [
        item('a', 'completed'),
        item('b', 'failed', 'storage_unavailable'),
        item('c', 'cancelled'),
      ])
    );

    expect(view.settled).toBe(true);
    expect(view.items.map((entry) => [entry.itemId, entry.state, entry.selectable])).toEqual([
      ['a', 'completed', false],
      ['b', 'failed', true],
      ['c', 'cancelled', true],
    ]);
    expect(view.retryableItemIds).toEqual(['b', 'c']);
  });

  it('offers nothing while the attempt is cancelling, failing or still receiving', () => {
    for (const state of ['receiving', 'committing', 'cancelling', 'failing']) {
      const view = describeReceiveEntry(progress(state, [item('a', 'failed', 'interrupted')]));
      expect(view.settled).toBe(false);
      expect(view.retryableItemIds).toEqual([]);
    }
  });

  it('treats a directory as one selectable unit and does not mix in member counts', () => {
    const view = describeReceiveEntry(
      progress('failed', [{ ...item('directory_unit', 'failed', 'integrity_check_failed'), kind: 'directory_unit' }], {
        itemsTotal: 7,
        itemsCompleted: 3,
      })
    );

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ itemId: 'directory_unit', kind: 'directory_unit' });
    expect(view.retryableItemIds).toEqual(['directory_unit']);
    expect(view.memberCounts).toEqual({ total: 7, completed: 3 });
  });

  it('preserves unknown strings from a newer Engine and never offers them for retry', () => {
    const view = describeReceiveEntry(
      progress('failed', [item('x', 'quarantined', 'brand_new_reason')])
    );

    expect(view.items[0]).toMatchObject({
      state: 'unknown',
      rawState: 'quarantined',
      failureReason: 'brand_new_reason',
      selectable: false,
    });
    expect(view.retryableItemIds).toEqual([]);
  });
});

describe('ReceiveResultsService', () => {
  it('rebuilds all state from the Engine list on start without any event', async () => {
    const api = createApi({
      listEntryReceiveProgress: jest.fn(async () => [
        progress('failed', [item('a', 'completed'), item('b', 'failed', 'timed_out')]),
      ]),
    });
    const { service } = createService(api);

    await service.refresh();

    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.items.map((candidate) => candidate.state)).toEqual(['completed', 'failed']);
    expect(service.getSnapshot().stale).toBe(false);
  });

  it('uses events only to invalidate and always reads the snapshot from the Engine', async () => {
    const api = createApi({
      queryEntryReceiveProgress: jest.fn(async () =>
        progress('completed', [item('a', 'completed')])
      ),
    });
    const { service, events } = createService(api);
    service.start();

    events.emit(stateEvent('entry-1', 'attempt-1', 'failed'));
    await settle();

    expect(api.queryEntryReceiveProgress).toHaveBeenCalledWith('entry-1');
    expect(service.getSnapshot().entries['entry-1'].progress.state).toBe('completed');
  });

  it('rebuilds from the Engine when it reports running after a start or foreground resume', async () => {
    const api = createApi();
    const { service, events } = createService(api);
    service.start();

    events.emit({ type: 'stateChanged', state: 'running' });
    await settle();
    events.emit({ type: 'stateChanged', state: 'suspended' });
    await settle();
    events.emit({ type: 'stateChanged', state: 'running' });
    await settle();

    expect(api.listEntryReceiveProgress).toHaveBeenCalledTimes(2);
  });

  it('ignores events that carry no receive meaning', async () => {
    const api = createApi();
    const { service, events } = createService(api);
    service.start();

    events.emit({ type: 'peerPresenceChanged', deviceId: 'peer', state: 'online', atMs: 1 });
    await settle();

    expect(api.listEntryReceiveProgress).not.toHaveBeenCalled();
    expect(api.queryEntryReceiveProgress).not.toHaveBeenCalled();
  });

  it('subscribes once and releases the subscription on stop', () => {
    const { service, events } = createService(createApi());

    service.start();
    service.start();
    expect(events.size).toBe(1);

    service.stop();
    expect(events.size).toBe(0);
  });

  it('rebuilds everything on a refresh-required event and on foreground refresh', async () => {
    const api = createApi();
    const { service, events } = createService(api);
    service.start();

    events.emit({ type: 'refreshRequired', reason: 'lagged' });
    await settle();
    await service.refresh();

    expect(api.listEntryReceiveProgress).toHaveBeenCalledTimes(2);
  });

  it('drops an older query response that completes after a newer one', async () => {
    const older = deferred<ReceiveProgress | null>();
    const newer = deferred<ReceiveProgress | null>();
    const api = createApi();
    api.queryEntryReceiveProgress
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { service, events } = createService(api);
    service.start();

    events.emit(stateEvent('entry-1', 'attempt-1', 'failed'));
    await settle();
    events.emit(stateEvent('entry-1', 'attempt-2', 'receiving'));
    await settle();
    newer.resolve(progress('receiving', [item('b', 'transferring')], { attemptId: 'attempt-2' }));
    await settle();
    older.resolve(progress('failed', [item('b', 'failed', 'interrupted')]));
    await settle();

    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.progress.attemptId).toBe('attempt-2');
    expect(entry.progress.state).toBe('receiving');
  });

  it('does not let a late event for an old attempt replace a newer attempt', async () => {
    const api = createApi({
      queryEntryReceiveProgress: jest.fn(async () =>
        progress('receiving', [item('b', 'transferring')], { attemptId: 'attempt-2' })
      ),
    });
    const { service, events } = createService(api);
    service.start();

    events.emit(stateEvent('entry-1', 'attempt-1', 'failed'));
    await settle();

    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.progress.attemptId).toBe('attempt-2');
    expect(entry.progress.state).toBe('receiving');
  });

  it('keeps the last snapshot and marks it stale when a query fails', async () => {
    const api = createApi();
    api.listEntryReceiveProgress
      .mockResolvedValueOnce([progress('failed', [item('a', 'failed', 'timed_out')])])
      .mockRejectedValueOnce(new Error('runtime unavailable'));
    const { service } = createService(api);

    await service.refresh();
    await service.refresh();

    const snapshot = service.getSnapshot();
    expect(snapshot.entries['entry-1']).toBeDefined();
    expect(snapshot.stale).toBe(true);
    expect(snapshot.error).toBe('runtime unavailable');
  });

  it('removes an entry the Engine no longer reports', async () => {
    const api = createApi();
    api.listEntryReceiveProgress.mockResolvedValueOnce([
      progress('failed', [item('a', 'failed', 'timed_out')]),
    ]);
    api.queryEntryReceiveProgress.mockResolvedValueOnce(null);
    const { service, events } = createService(api);
    service.start();
    await service.refresh();

    events.emit(stateEvent('entry-1', 'attempt-1', 'failed'));
    await settle();

    expect(service.getSnapshot().entries['entry-1']).toBeUndefined();
  });
});

describe('ReceiveResultsService.retry', () => {
  async function failedEntryService(retry: ReceiveResultsApi['retryEntryReceive']) {
    const api = createApi({
      listEntryReceiveProgress: jest.fn(async () => [
        progress('failed', [
          item('a', 'completed'),
          item('b', 'failed', 'storage_unavailable'),
          item('c', 'failed', 'timed_out'),
        ]),
      ]),
      retryEntryReceive: jest.fn(retry),
    });
    const created = createService(api);
    await created.service.refresh();
    return { api, ...created };
  }

  it('sends the entry, the current attempt and only the selected item identities', async () => {
    const { api, service } = await failedEntryService(async () => ({
      kind: 'accepted',
      attemptId: 'attempt-2',
    }));

    await service.retry('entry-1', ['b']);

    expect(api.retryEntryReceive).toHaveBeenCalledWith('entry-1', 'attempt-1', ['b']);
  });

  it('treats accepted as a new attempt in flight, not as saved files', async () => {
    const { api, service } = await failedEntryService(async () => ({
      kind: 'accepted',
      attemptId: 'attempt-2',
    }));
    api.queryEntryReceiveProgress.mockResolvedValue(
      progress(
        'receiving',
        [item('a', 'completed'), item('b', 'transferring'), item('c', 'failed', 'timed_out')],
        { attemptId: 'attempt-2' }
      )
    );

    const result = await service.retry('entry-1', ['b']);

    expect(result).toEqual({ kind: 'accepted', attemptId: 'attempt-2' });
    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.items.find((candidate) => candidate.itemId === 'b')?.state).toBe('transferring');
    expect(entry.items.find((candidate) => candidate.itemId === 'a')?.state).toBe('completed');
    expect(entry.items.find((candidate) => candidate.itemId === 'c')?.state).toBe('failed');
    expect(entry.retryableItemIds).toEqual([]);
  });

  it('does not call the Engine for an empty selection or an item that is not offered', async () => {
    const { api, service } = await failedEntryService(async () => ({ kind: 'alreadyReceiving' }));

    await expect(service.retry('entry-1', [])).rejects.toMatchObject({ code: 'invalidSelection' });
    await expect(service.retry('entry-1', ['a'])).rejects.toMatchObject({
      code: 'invalidSelection',
    });
    await expect(service.retry('entry-1', ['not-in-snapshot'])).rejects.toMatchObject({
      code: 'invalidSelection',
    });
    await expect(service.retry('missing-entry', ['b'])).rejects.toMatchObject({
      code: 'unknownEntry',
    });
    expect(api.retryEntryReceive).not.toHaveBeenCalled();
  });

  it.each<[ReceiveRetryOutcome]>([
    [{ kind: 'alreadyReceiving' }],
    [{ kind: 'superseded' }],
    [{ kind: 'cancellationIncomplete' }],
    [{ kind: 'unavailable', reason: 'source_unavailable' }],
    [{ kind: 'unavailable', reason: 'access_denied' }],
  ])('returns %j unchanged, refreshes, and keeps saved items', async (outcome) => {
    const { api, service } = await failedEntryService(async () => outcome);
    api.queryEntryReceiveProgress.mockResolvedValue(
      progress('failed', [
        item('a', 'completed'),
        item('b', 'failed', 'storage_unavailable'),
        item('c', 'failed', 'timed_out'),
      ])
    );

    const result = await service.retry('entry-1', ['b']);

    expect(result).toEqual(outcome);
    expect(api.retryEntryReceive).toHaveBeenCalledTimes(1);
    expect(api.queryEntryReceiveProgress).toHaveBeenCalledWith('entry-1');
    expect(
      service.getSnapshot().entries['entry-1'].items.find((candidate) => candidate.itemId === 'a')
        ?.state
    ).toBe('completed');
  });

  it('remembers that the source is unavailable without changing the failed items', async () => {
    const { api, service } = await failedEntryService(async () => ({
      kind: 'unavailable',
      reason: 'source_unavailable',
    }));
    api.queryEntryReceiveProgress.mockResolvedValue(
      progress('failed', [
        item('a', 'completed'),
        item('b', 'failed', 'storage_unavailable'),
        item('c', 'failed', 'timed_out'),
      ])
    );

    await service.retry('entry-1', ['b']);

    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.retryBlockedReason).toBe('source_unavailable');
    expect(entry.items.map((candidate) => candidate.state)).toEqual([
      'completed',
      'failed',
      'failed',
    ]);
  });

  it('propagates an Engine failure and refreshes instead of guessing the outcome', async () => {
    const failure = new Error('Engine failure invalidArgument');
    const { api, service } = await failedEntryService(async () => {
      throw failure;
    });

    await expect(service.retry('entry-1', ['b'])).rejects.toBe(failure);
    expect(api.queryEntryReceiveProgress).toHaveBeenCalledWith('entry-1');
  });
});

describe('ReceiveResultsService.cancel', () => {
  async function receivingService(cancel: ReceiveResultsApi['cancelEntryReceive']) {
    const api = createApi({
      listEntryReceiveProgress: jest.fn(async () => [
        progress('receiving', [item('a', 'transferring')]),
      ]),
      cancelEntryReceive: jest.fn(cancel),
    });
    const created = createService(api);
    await created.service.refresh();
    return { api, ...created };
  }

  it('cancels the current attempt only and reports the Engine outcome', async () => {
    const { api, service } = await receivingService(async () => 'cancelled');
    api.queryEntryReceiveProgress.mockResolvedValue(
      progress('cancelled', [item('a', 'cancelled')])
    );

    const outcome = await service.cancel('entry-1');

    expect(api.cancelEntryReceive).toHaveBeenCalledWith('entry-1', 'attempt-1');
    expect(outcome).toBe('cancelled');
    expect(service.getSnapshot().entries['entry-1'].progress.state).toBe('cancelled');
  });

  it('never reports cancellation_incomplete as cancelled and keeps the nonterminal state', async () => {
    const { api, service } = await receivingService(async () => 'cancellation_incomplete');
    api.queryEntryReceiveProgress.mockResolvedValue(
      progress('cancelling', [item('a', 'transferring')])
    );

    const outcome: EntryReceiveCancellation = await service.cancel('entry-1');

    expect(outcome).toBe('cancellation_incomplete');
    const entry = service.getSnapshot().entries['entry-1'];
    expect(entry.progress.state).toBe('cancelling');
    expect(entry.settled).toBe(false);
    expect(entry.retryableItemIds).toEqual([]);
  });

  it.each(['not_receiving', 'too_late', 'already_terminal', 'superseded'])(
    'refreshes after %s so the view shows the real state',
    async (reported) => {
      const { api, service } = await receivingService(async () => reported);
      api.queryEntryReceiveProgress.mockResolvedValue(
        progress('completed', [item('a', 'completed')])
      );

      expect(await service.cancel('entry-1')).toBe(reported);
      expect(service.getSnapshot().entries['entry-1'].progress.state).toBe('completed');
    }
  );

  it('rejects an unknown entry without calling the Engine', async () => {
    const { api, service } = await receivingService(async () => 'cancelled');

    await expect(service.cancel('missing')).rejects.toMatchObject({ code: 'unknownEntry' });
    expect(api.cancelEntryReceive).not.toHaveBeenCalled();
  });
});

describe('ownership boundaries', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('keeps the 120-second outbound wait from cancelling or retrying Engine receive work', () => {
    const coordinator = read('src/features/transfer/internal/outboundDeliveryCoordinator.ts');
    expect(coordinator).not.toMatch(/cancelEntryReceive|retryEntryReceive|cancelInboundTransfer/);
  });

  it('adds no JavaScript blob downloader or second retry scheduler for receive work', () => {
    const service = read('src/features/transfer/internal/receiveResults.ts');
    expect(service).not.toMatch(/downloadAndSaveFile|fetch\(|setInterval|setTimeout/);
  });
});
