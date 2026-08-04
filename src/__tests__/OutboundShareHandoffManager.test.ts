/// <reference types="jest" />

import type { OutboundShareJobDTO } from '../../modules/app-group-store/src/index';
import { OutboundShareHandoffManager } from '../features/transfer/internal/outboundShareHandoffManager';

const job: OutboundShareJobDTO = {
  id: 'job-1',
  fileUri: 'file:///group/outbound-handoff/files/job-1.payload',
  displayName: 'archive.zip',
  byteCount: 100 * 1024 * 1024 + 1,
  mimeType: 'application/zip',
  targetDeviceIds: ['desktop-1'],
  createdAtMs: 1_700_000_000_000,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    claimJobs: jest.fn(async () => [job]),
    completeJob: jest.fn(async () => {}),
    releaseJob: jest.fn(async () => {}),
    importFile: jest.fn(async () => ({
      profileHash: 'HASH',
      fileUri: 'file:///group/payloads/File-HASH',
      fileName: 'archive.zip',
      fileSize: job.byteCount,
      contentType: 'File' as const,
    })),
    sendImportedAsset: jest.fn(async () => ({
      success: true,
      deliveryState: 'delivered' as const,
    })),
    ...overrides,
  };
}

describe('OutboundShareHandoffManager', () => {
  it('imports and sends a claimed file to its selected devices before completing it', async () => {
    const deps = dependencies();
    const manager = new OutboundShareHandoffManager(deps);

    await expect(manager.resume()).resolves.toEqual({ completed: 1, deferred: 0 });

    expect(deps.importFile).toHaveBeenCalledWith(
      job.fileUri,
      job.displayName,
      job.mimeType,
      job.byteCount,
      { skipInitialCopyOnIOS: true }
    );
    expect(deps.sendImportedAsset).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'file', fileName: 'archive.zip' }),
      'HASH',
      {
        targetDeviceIds: ['desktop-1'],
      }
    );
    expect(deps.completeJob).toHaveBeenCalledWith('job-1');
    expect(deps.releaseJob).not.toHaveBeenCalled();
  });

  it.each(['partial', 'pending', 'failed', 'offline'] as const)(
    'releases a P2P job when delivery is %s',
    async (deliveryState) => {
      const deps = dependencies({
        sendImportedAsset: jest.fn(async () => ({
          success: false,
          deliveryState,
        })),
      });

      await expect(new OutboundShareHandoffManager(deps).resume()).resolves.toEqual({
        completed: 0,
        deferred: 1,
      });

      expect(deps.releaseJob).toHaveBeenCalledWith('job-1');
      expect(deps.completeJob).not.toHaveBeenCalled();
    }
  );

  it('releases a job after an import or send error and coalesces concurrent resumes', async () => {
    let rejectImport!: (error: Error) => void;
    const importPromise = new Promise<never>((_resolve, reject) => {
      rejectImport = reject;
    });
    const deps = dependencies({ importFile: jest.fn(() => importPromise) });
    const manager = new OutboundShareHandoffManager(deps);

    const first = manager.resume();
    const second = manager.resume();
    rejectImport(new Error('disk unavailable'));

    await expect(first).resolves.toEqual({ completed: 0, deferred: 1 });
    await expect(second).resolves.toEqual({ completed: 0, deferred: 1 });
    expect(deps.claimJobs).toHaveBeenCalledTimes(1);
    expect(deps.releaseJob).toHaveBeenCalledWith('job-1');
  });
});
