import {
  claimOutboundShareJobs,
  completeOutboundShareJob,
  releaseOutboundShareJob,
  type OutboundShareJobDTO,
} from 'app-group-store';
import type { ImportResult } from '@/utils/uploadFile';
import { log } from './Logger';
import {
  getUnifiedContentService,
  type ImportedAssetSendOptions,
  type ImportedContentAsset,
} from './UnifiedContentService';

interface HandoffSendResult {
  channel: 'p2p' | 'lan';
  success: boolean;
  deliveryState?: string;
}

interface OutboundShareHandoffDependencies {
  claimJobs(): Promise<OutboundShareJobDTO[]>;
  completeJob(id: string): Promise<void>;
  releaseJob(id: string): Promise<void>;
  importFile(
    sourceUri: string,
    fileName: string,
    mimeType: string | null | undefined,
    fileSize: number | undefined,
    options?: { skipInitialCopyOnIOS?: boolean }
  ): Promise<ImportResult>;
  sendImportedAsset(
    asset: ImportedContentAsset,
    profileHash: string,
    options: ImportedAssetSendOptions
  ): Promise<HandoffSendResult>;
}

export interface OutboundShareResumeSummary {
  completed: number;
  deferred: number;
}

export class OutboundShareHandoffManager {
  private running: Promise<OutboundShareResumeSummary> | null = null;

  constructor(private readonly deps: OutboundShareHandoffDependencies = defaultDependencies()) {}

  resume(): Promise<OutboundShareResumeSummary> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<OutboundShareResumeSummary> {
    const jobs = await this.deps.claimJobs();
    let completed = 0;
    let deferred = 0;

    for (const job of jobs) {
      try {
        const imported = await this.deps.importFile(
          job.fileUri,
          job.displayName,
          job.mimeType,
          job.byteCount,
          { skipInitialCopyOnIOS: true }
        );
        const result = await this.deps.sendImportedAsset(
          {
            kind: 'file',
            uri: imported.fileUri,
            fileName: imported.fileName,
            mimeType: job.mimeType,
          },
          imported.profileHash,
          {
            channel: job.channel,
            awaitLanDelivery: true,
            serverId: job.serverId,
            targetDeviceIds: job.targetDeviceIds,
            byteCount: job.byteCount,
          }
        );
        const delivered =
          result.channel === 'lan'
            ? result.success
            : result.success && result.deliveryState === 'delivered';
        if (!delivered) {
          await this.release(job.id);
          deferred += 1;
          continue;
        }
        await this.deps.completeJob(job.id);
        completed += 1;
      } catch (error) {
        log.warn('[OutboundShareHandoff] Deferred pending share job', {
          jobId: job.id,
          reason: error instanceof Error ? error.name : 'unknown',
        });
        await this.release(job.id);
        deferred += 1;
      }
    }

    return { completed, deferred };
  }

  private async release(id: string): Promise<void> {
    try {
      await this.deps.releaseJob(id);
    } catch (error) {
      log.error('[OutboundShareHandoff] Failed to release pending share job', {
        jobId: id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}

function defaultDependencies(): OutboundShareHandoffDependencies {
  return {
    claimJobs: claimOutboundShareJobs,
    completeJob: completeOutboundShareJob,
    releaseJob: releaseOutboundShareJob,
    importFile: (sourceUri, fileName, mimeType, fileSize, options) =>
      require('@/utils/uploadFile').importFileToHistory(
        sourceUri,
        fileName,
        mimeType,
        fileSize,
        options
      ),
    sendImportedAsset: (asset, profileHash, options) =>
      getUnifiedContentService().sendImportedAsset(asset, profileHash, options),
  };
}

const manager = new OutboundShareHandoffManager();

export function resumeOutboundShareHandoffs(): Promise<OutboundShareResumeSummary> {
  return manager.resume();
}
