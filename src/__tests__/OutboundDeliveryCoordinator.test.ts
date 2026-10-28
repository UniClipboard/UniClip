import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { setImmediate as nextTurn } from 'node:timers';
import type { EngineEvent, OutboundProgress, SendReport } from 'uc-engine';
import { OutboundDeliveryCoordinator } from '../features/transfer/internal/outboundDeliveryCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function report(accepted: number): SendReport {
  return {
    entryId: 'entry-1',
    atMs: 1,
    totalAccepted: accepted,
    totalDuplicate: 0,
    totalOffline: 0,
    totalErrored: 0,
    totalPending: 0,
  };
}

function eventSource(peerCount = 2) {
  let listener: ((event: EngineEvent) => void) | null = null;
  const snapshots = new Map<string, OutboundProgress>();
  return {
    source: {
      listDevices: async () => Array.from({ length: peerCount }, (_, index) => ({
        deviceId: `peer-${index + 1}`,
        displayName: `Peer ${index + 1}`,
        isLocal: false,
        online: true,
      })),
      listOutboundProgress: async () => [...snapshots.values()],
      subscribeEvents(next: (event: EngineEvent) => void) {
        listener = next;
        return () => {
          if (listener === next) listener = null;
        };
      },
    },
    emit(snapshot: OutboundProgress) {
      snapshots.set(JSON.stringify([snapshot.entryId, snapshot.targetDeviceId]), snapshot);
      listener?.({ type: 'outboundProgressChanged' });
    },
    hasListener() {
      return listener !== null;
    },
  };
}

function progress(entryId: string, peerId: string): OutboundProgress {
  return {
    entryId,
    targetDeviceId: peerId,
    attemptId: 'attempt-1',
    revision: '1',
    freshness: 'live',
    freshnessAvailable: true,
    state: 'in_progress',
    itemsTotal: 1,
    itemsWaiting: 0,
    itemsRunning: 1,
    itemsCompleted: 0,
    itemsFailed: 0,
    itemsCancelled: 0,
    itemsUnconfirmed: 0,
    items: [{
      kind: 'file', index: 0, state: 'transferring', lastKnownPhase: 'transferring',
      round: null, completedBytes: '10', totalBytes: '20',
      failureReason: null, cancellationReason: null,
    }],
  };
}

function terminal(
  entryId: string,
  peerId: string,
  status: 'completed' | 'failed' | 'cancelled',
  reason: string | null = null
): OutboundProgress {
  return {
    ...progress(entryId, peerId),
    revision: '2',
    freshness: 'settled',
    state: status,
    itemsRunning: 0,
    itemsCompleted: status === 'completed' ? 1 : 0,
    itemsFailed: status === 'failed' ? 1 : 0,
    itemsCancelled: status === 'cancelled' ? 1 : 0,
    items: [{
      kind: 'file', index: 0, state: status, lastKnownPhase: 'transferring',
      round: null, completedBytes: '20', totalBytes: '20',
      failureReason: status === 'failed' ? reason : null,
      cancellationReason: status === 'cancelled' ? reason : null,
    }],
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('OutboundDeliveryCoordinator', () => {
  it('subscribes before dispatch and waits for every accepting peer of one entry', async () => {
    const events = eventSource();
    const dispatch = deferred<SendReport>();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);

    const outcomePromise = coordinator.run(() => dispatch.promise, ['peer-1', 'peer-2']);

    expect(events.hasListener()).toBe(true);
    events.emit(progress('entry-1', 'peer-1'));
    events.emit(terminal('entry-1', 'peer-1', 'completed'));
    dispatch.resolve(report(2));
    await new Promise<void>((resolve) => nextTurn(resolve));

    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    events.emit(progress('entry-1', 'peer-2'));
    events.emit(terminal('entry-1', 'peer-2', 'completed'));

    await expect(outcomePromise).resolves.toMatchObject({
      report: report(2),
      completed: 2,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('returns failed and cancelled peer counts without reporting completion', async () => {
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(2));
    await Promise.resolve();

    events.emit(progress('entry-1', 'peer-1'));
    events.emit(terminal('entry-1', 'peer-1', 'failed', 'source unavailable'));
    events.emit(progress('entry-1', 'peer-2'));
    events.emit(terminal('entry-1', 'peer-2', 'cancelled', 'peer closed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 0,
      failed: 1,
      cancelled: 1,
      pending: 0,
      reasons: ['source unavailable', 'peer closed'],
    });
    expect(events.hasListener()).toBe(false);
  });

  it('counts every peer when entry snapshots interleave before terminal snapshots', async () => {
    jest.useFakeTimers();
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(2));
    await Promise.resolve();

    events.emit(progress('entry-1', 'peer-1'));
    events.emit(progress('entry-1', 'peer-2'));
    events.emit(terminal('entry-1', 'peer-1', 'completed'));
    events.emit(terminal('entry-1', 'peer-2', 'completed'));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 2,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('keeps unfinished peers pending when the delivery wait times out', async () => {
    jest.useFakeTimers();
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(2));
    await Promise.resolve();

    events.emit(progress('entry-1', 'peer-1'));
    events.emit(terminal('entry-1', 'peer-1', 'completed'));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 1,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('does not wait when no peer accepted the dispatch', async () => {
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);

    await expect(coordinator.run(async () => report(0))).resolves.toMatchObject({
      completed: 0,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('keeps waiting when a pending dispatch can still begin a remote pull', async () => {
    const events = eventSource(1);
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const pendingReport = { ...report(0), totalPending: 1 };
    const outcomePromise = coordinator.run(async () => pendingReport);
    await Promise.resolve();

    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    events.emit(progress('entry-1', 'peer-1'));
    events.emit(terminal('entry-1', 'peer-1', 'completed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('accepts a terminal snapshot even when an empty or fast file has no progress event', async () => {
    const events = eventSource(1);
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(1));
    await Promise.resolve();

    events.emit(terminal('entry-1', 'peer-1', 'completed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });
});
