/// <reference types="jest" />

import type {
  PendingShareJob,
  PendingShareStore,
} from '../features/transfer/internal/pendingShareStore';
import { OutboundShareHandoffManager } from '../features/transfer/internal/outboundShareHandoffManager';

const job: PendingShareJob = {
  id: 'job-1',
  kind: 'file',
  fileUri: 'file:///group/outbound-handoff/files/job-1.payload',
  displayName: 'archive.zip',
  byteCount: 100 * 1024 * 1024 + 1,
  mimeType: 'application/zip',
  createdAtMs: 1_700_000_000_000,
};

function store(overrides: Record<string, unknown> = {}): PendingShareStore {
  return {
    claimPending: jest.fn(async () => [job]),
    completeJob: jest.fn(async () => {}),
    releaseJob: jest.fn(async () => {}),
    stageText: jest.fn(async () => job),
    stageAsset: jest.fn(async () => job),
    cleanup: jest.fn(async () => {}),
    contentPersistedOnStage: true,
    ...overrides,
  } as unknown as PendingShareStore;
}

describe('OutboundShareHandoffManager', () => {
  it('claims pending jobs once and coalesces concurrent claims', async () => {
    const deps = store();
    const manager = new OutboundShareHandoffManager(deps);

    const first = manager.claimPending();
    const second = manager.claimPending();

    await expect(first).resolves.toEqual([job]);
    await expect(second).resolves.toEqual([job]);
    expect(deps.claimPending).toHaveBeenCalledTimes(1);
  });

  it('re-claims after the previous claim settles', async () => {
    const deps = store();
    const manager = new OutboundShareHandoffManager(deps);

    await expect(manager.claimPending()).resolves.toEqual([job]);
    await expect(manager.claimPending()).resolves.toEqual([job]);
    expect(deps.claimPending).toHaveBeenCalledTimes(2);
  });

  it('surfaces claim failures to the caller', async () => {
    const deps = store({ claimPending: jest.fn(async () => Promise.reject(new Error('busy'))) });
    const manager = new OutboundShareHandoffManager(deps);

    await expect(manager.claimPending()).rejects.toThrow('busy');
  });

  it('delegates complete and release to the store without throwing on store errors', async () => {
    const deps = store({
      completeJob: jest.fn(async () => Promise.reject(new Error('disk unavailable'))),
      releaseJob: jest.fn(async () => Promise.reject(new Error('disk unavailable'))),
    });
    const manager = new OutboundShareHandoffManager(deps);

    await expect(manager.completeJob('job-1')).resolves.toBeUndefined();
    await expect(manager.releaseJob('job-1')).resolves.toBeUndefined();
    expect(deps.completeJob).toHaveBeenCalledWith('job-1');
    expect(deps.releaseJob).toHaveBeenCalledWith('job-1');
  });
});
