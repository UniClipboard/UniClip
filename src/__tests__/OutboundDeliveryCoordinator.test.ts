import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { EngineEvent, SendReport } from 'uc-engine';
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

function eventSource() {
  let listener: ((event: EngineEvent) => void) | null = null;
  return {
    source: {
      subscribeEvents(next: (event: EngineEvent) => void) {
        listener = next;
        return () => {
          if (listener === next) listener = null;
        };
      },
    },
    emit(event: EngineEvent) {
      listener?.(event);
    },
    hasListener() {
      return listener !== null;
    },
  };
}

function progress(transferId: string, peerId: string): EngineEvent {
  return {
    type: 'transferProgress',
    transferId,
    entryId: 'entry-1',
    attemptId: null,
    peerId,
    direction: 'sending',
    completedBytes: 10,
    totalBytes: 20,
  };
}

function terminal(
  transferId: string,
  status: 'completed' | 'failed' | 'cancelled',
  reason: string | null = null
): EngineEvent {
  return {
    type: 'transferStatusChanged',
    transferId,
    entryId: 'entry-1',
    attemptId: null,
    status,
    reason,
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('OutboundDeliveryCoordinator', () => {
  it('subscribes before dispatch and waits for every accepting peer sharing one transfer id', async () => {
    const events = eventSource();
    const dispatch = deferred<SendReport>();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);

    const outcomePromise = coordinator.run(() => dispatch.promise);

    expect(events.hasListener()).toBe(true);
    events.emit(progress('entry-1', 'peer-1'));
    events.emit(terminal('entry-1', 'completed'));
    dispatch.resolve(report(2));
    await Promise.resolve();

    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    events.emit(progress('entry-1', 'peer-2'));
    events.emit(terminal('entry-1', 'completed'));

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

    events.emit(progress('transfer-1', 'peer-1'));
    events.emit(terminal('transfer-1', 'failed', 'source unavailable'));
    events.emit(progress('transfer-2', 'peer-2'));
    events.emit(terminal('transfer-2', 'cancelled', 'peer closed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 0,
      failed: 1,
      cancelled: 1,
      pending: 0,
      reasons: ['source unavailable', 'peer closed'],
    });
    expect(events.hasListener()).toBe(false);
  });

  it('counts every peer when shared-transfer progress interleaves before terminal events', async () => {
    jest.useFakeTimers();
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(2));
    await Promise.resolve();

    events.emit(progress('entry-1', 'peer-1'));
    events.emit(progress('entry-1', 'peer-2'));
    events.emit(terminal('entry-1', 'completed'));
    events.emit(terminal('entry-1', 'completed'));
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

    events.emit(progress('transfer-1', 'peer-1'));
    events.emit(terminal('transfer-1', 'completed'));
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
    const events = eventSource();
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

    events.emit(progress('transfer-1', 'peer-1'));
    events.emit(terminal('transfer-1', 'completed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });

  it('accepts a terminal transfer even when an empty or fast file has no progress event', async () => {
    const events = eventSource();
    const coordinator = new OutboundDeliveryCoordinator(events.source, 1_000);
    const outcomePromise = coordinator.run(async () => report(1));
    await Promise.resolve();

    events.emit(terminal('transfer-1', 'completed'));

    await expect(outcomePromise).resolves.toMatchObject({
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
    });
    expect(events.hasListener()).toBe(false);
  });
});
