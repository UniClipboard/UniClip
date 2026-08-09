/**
 * PendingShareStore — 跨平台暂存队列抽象(§4)
 *
 * 统一两端「分享接收 → 主应用分享页」之间的持久队列:
 * - iOS 由分享扩展负责 stage(写 App Group `outbound-handoff`),JS 侧仅委托
 *   `app-group-store` 原生模块做 claim/complete/release;
 * - Android 由应用内 redirector 转存到应用私有目录 `pending-share/`
 *   (`files/{id}.payload` + `pending|processing/{id}.json`,原子写),
 *   实现同语义的租约与 7 天过期。
 *
 * 核心不变量:接收端不发送;发送统一在分享页完成。
 */

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  claimOutboundShareJobs,
  completeOutboundShareJob,
  releaseOutboundShareJob,
} from 'app-group-store';
import { createLogger } from '@/support/observability';

const log = createLogger('PendingShareStore');

export type PendingShareKind = 'text' | 'image' | 'file';

export interface PendingShareJob {
  id: string;
  kind: PendingShareKind;
  displayName: string;
  byteCount: number;
  mimeType: string | null;
  /** Payload 文件 URI(文本为 UTF-8 文件,图片/文件为原始字节)。 */
  fileUri: string;
  createdAtMs: number;
}

export interface PendingShareStore {
  claimPending(): Promise<PendingShareJob[]>;
  completeJob(id: string): Promise<void>;
  releaseJob(id: string): Promise<void>;
  /** Android 转存专用:把分享文本暂存为 UTF-8 payload。iOS 由扩展完成,JS 侧不可用。 */
  stageText(text: string): Promise<PendingShareJob>;
  /** Android 转存专用:把分享图片/文件复制为 payload。iOS 由扩展完成,JS 侧不可用。 */
  stageAsset(uri: string, displayName: string, mimeType: string | null): Promise<PendingShareJob>;
  /** 过期清理(7 天),启动/分享页挂载时调用。 */
  cleanup(): Promise<void>;
  /**
   * staging 侧是否已把内容写入主页历史后再入队:
   * - iOS:分享扩展先写历史再 enqueue(有 job 记录必有历史),因此关闭分享页或
   *   清除陈旧 job 可以直接出队,内容不丢失(每次分享页都是崭新的一次分享);
   * - Android:redirector 只入队,内容尚未入历史,取消时必须保留(releaseJob)。
   */
  readonly contentPersistedOnStage: boolean;
}

/**
 * iOS 实现:委托 `app-group-store` 的既有 OutboundShareStore。
 * staging 由分享扩展完成,因此 `stageText` / `stageAsset` 在此端不可用
 * (spec §13 Q3:注释说明方案)。
 */
export class IosPendingShareStore implements PendingShareStore {
  /** iOS 分享扩展先写主页历史再 enqueue,队列内容可安全清除。 */
  readonly contentPersistedOnStage = true;

  claimPending(): Promise<PendingShareJob[]> {
    return claimOutboundShareJobs();
  }

  completeJob(id: string): Promise<void> {
    return completeOutboundShareJob(id);
  }

  releaseJob(id: string): Promise<void> {
    return releaseOutboundShareJob(id);
  }

  stageText(): Promise<PendingShareJob> {
    return Promise.reject(
      new Error('PendingShareStore.stageText is unavailable on iOS (handled by the extension)')
    );
  }

  stageAsset(): Promise<PendingShareJob> {
    return Promise.reject(
      new Error('PendingShareStore.stageAsset is unavailable on iOS (handled by the extension)')
    );
  }

  /** iOS 的 claim 内部已含过期回收与租约恢复,无需额外清理。 */
  cleanup(): Promise<void> {
    return Promise.resolve();
  }
}

const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1_000;
const TEXT_DISPLAY_NAME = '分享的文本.txt';

function createJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface StoredJob {
  id: string;
  kind: PendingShareKind;
  displayName: string;
  byteCount: number;
  mimeType: string | null;
  targetDeviceIds?: string[];
  createdAtMs: number;
}

function parseStoredJob(json: string): StoredJob | null {
  try {
    const parsed = JSON.parse(json) as Partial<StoredJob>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.displayName !== 'string' ||
      typeof parsed.byteCount !== 'number' ||
      typeof parsed.createdAtMs !== 'number'
    ) {
      return null;
    }
    return {
      id: parsed.id,
      kind: parsed.kind ?? 'file',
      displayName: parsed.displayName,
      byteCount: parsed.byteCount,
      mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : null,
      targetDeviceIds: Array.isArray(parsed.targetDeviceIds) ? parsed.targetDeviceIds : undefined,
      createdAtMs: parsed.createdAtMs,
    };
  } catch {
    return null;
  }
}

/**
 * Android 实现:应用文档目录 `pending-share/` 下镜像 iOS 的
 * `files|pending|processing` 布局(§3.3),JSON 编码字段与 iOS
 * `OutboundShareJob` 一致;原子写 = 先写 `{id}.tmp` 再 move。
 */
export class AndroidPendingShareStore implements PendingShareStore {
  /** Android redirector 只入队不写历史,内容仅存在于队列,不可随意清除。 */
  readonly contentPersistedOnStage = false;

  private readonly root = new Directory(Paths.document, 'pending-share');
  private readonly files = new Directory(this.root, 'files');
  private readonly pending = new Directory(this.root, 'pending');
  private readonly processing = new Directory(this.root, 'processing');

  private ensureDirectories(): void {
    for (const dir of [this.root, this.files, this.pending, this.processing]) {
      if (!dir.exists) dir.create({ intermediates: true });
    }
  }

  private recordIn(dir: Directory, id: string): File {
    return new File(dir, `${id}.json`);
  }

  private payload(id: string): File {
    return new File(this.files, `${id}.payload`);
  }

  private toJob(stored: StoredJob, fileUri: string): PendingShareJob {
    return {
      id: stored.id,
      kind: stored.kind,
      displayName: stored.displayName,
      byteCount: stored.byteCount,
      mimeType: stored.mimeType,
      fileUri,
      createdAtMs: stored.createdAtMs,
    };
  }

  private serializeJob(
    job: Pick<StoredJob, 'id' | 'kind' | 'displayName' | 'byteCount' | 'mimeType'>,
    createdAtMs: number
  ): string {
    const record: Record<string, unknown> = {
      id: job.id,
      kind: job.kind,
      displayName: job.displayName,
      byteCount: job.byteCount,
      mimeType: job.mimeType,
      createdAtMs,
    };
    return JSON.stringify(record);
  }

  /** 原子写记录:先写 `{id}.tmp` 再 move(与 iOS 的 `.atomic` 语义对齐)。 */
  private writeRecordAtomic(dir: Directory, id: string, json: string): void {
    const temporary = new File(dir, `${id}.tmp`);
    temporary.write(json, { encoding: 'utf8' });
    temporary.moveSync(this.recordIn(dir, id), { overwrite: true });
  }

  async stageText(text: string): Promise<PendingShareJob> {
    this.ensureDirectories();
    const id = createJobId();
    const createdAtMs = Date.now();
    const target = this.payload(id);
    const temporary = new File(this.files, `${id}.tmp`);
    temporary.write(text, { encoding: 'utf8' });
    await temporary.move(target, { overwrite: true });

    const job = {
      id,
      kind: 'text' as const,
      displayName: TEXT_DISPLAY_NAME,
      byteCount: new TextEncoder().encode(text).byteLength,
      mimeType: 'text/plain' as const,
    };
    this.writeRecordAtomic(this.pending, id, this.serializeJob(job, createdAtMs));
    return this.toJob({ ...job, createdAtMs }, target.uri);
  }

  async stageAsset(
    uri: string,
    displayName: string,
    mimeType: string | null
  ): Promise<PendingShareJob> {
    this.ensureDirectories();
    const id = createJobId();
    const createdAtMs = Date.now();
    const target = this.payload(id);
    const temporary = new File(this.files, `${id}.tmp`);
    await new File(uri).copy(temporary, { overwrite: true });
    await temporary.move(target, { overwrite: true });

    const job = {
      id,
      kind: (mimeType?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
      displayName: displayName || `shared_${Date.now()}`,
      byteCount: 0,
      mimeType,
    };
    this.writeRecordAtomic(this.pending, id, this.serializeJob(job, createdAtMs));
    return this.toJob({ ...job, createdAtMs }, target.uri);
  }

  async claimPending(): Promise<PendingShareJob[]> {
    this.ensureDirectories();
    this.recoverAbandonedProcessingJobs();
    this.removeExpiredJobs();

    const claimed: PendingShareJob[] = [];
    for (const entry of this.pending.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      const processingRecord = this.recordIn(this.processing, id);
      try {
        await entry.move(processingRecord, { overwrite: true });
      } catch {
        continue;
      }
      const stored = parseStoredJob(processingRecord.textSync());
      if (!stored || !this.payload(id).exists) {
        try {
          processingRecord.delete();
        } catch {
          // 记录损坏/缺 payload,尽力清除
        }
        continue;
      }
      claimed.push(this.toJob(stored, this.payload(id).uri));
    }
    return claimed.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  releaseJob(id: string): Promise<void> {
    const processingRecord = this.recordIn(this.processing, id);
    if (!processingRecord.exists) return Promise.resolve();
    const pendingRecord = this.recordIn(this.pending, id);
    try {
      if (pendingRecord.exists) pendingRecord.delete();
      return processingRecord.move(pendingRecord, { overwrite: true }).then(() => undefined);
    } catch (error) {
      log.warn('Failed to release pending share job', {
        jobId: id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return Promise.resolve();
    }
  }

  completeJob(id: string): Promise<void> {
    for (const record of [this.recordIn(this.processing, id), this.recordIn(this.pending, id)]) {
      try {
        if (record.exists) record.delete();
      } catch {
        // 尽力清除
      }
    }
    const payload = this.payload(id);
    try {
      if (payload.exists) payload.delete();
    } catch {
      // 尽力清除
    }
    return Promise.resolve();
  }

  cleanup(): Promise<void> {
    this.ensureDirectories();
    this.removeExpiredJobs();
    return Promise.resolve();
  }

  /** processing 中超过 15 分钟租约的 job 放回 pending(下次 claim 重新认领)。 */
  private recoverAbandonedProcessingJobs(): void {
    const now = Date.now();
    for (const entry of this.processing.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      const modified = entry.info().modificationTime;
      if (modified == null || now - modified <= PROCESSING_LEASE_MS) continue;
      const pendingRecord = this.recordIn(this.pending, entry.name.slice(0, -'.json'.length));
      try {
        if (pendingRecord.exists) pendingRecord.delete();
        entry.moveSync(pendingRecord);
      } catch {
        // 尽力恢复
      }
    }
  }

  /** 删除超过 7 天的 job(记录 + payload)与无主的孤儿 payload。 */
  private removeExpiredJobs(): void {
    const now = Date.now();
    const liveIDs = new Set<string>();

    for (const dir of [this.pending, this.processing]) {
      for (const entry of dir.list()) {
        if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -'.json'.length);
        const stored = parseStoredJob(entry.textSync());
        if (!stored || now - stored.createdAtMs > EXPIRATION_MS) {
          try {
            entry.delete();
          } catch {
            // 尽力清除
          }
          try {
            const payload = this.payload(id);
            if (payload.exists) payload.delete();
          } catch {
            // 尽力清除
          }
        } else {
          liveIDs.add(id);
        }
      }
    }

    for (const entry of this.files.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.payload')) continue;
      const id = entry.name.slice(0, -'.payload'.length);
      if (liveIDs.has(id)) continue;
      const modified = entry.info().modificationTime;
      if (modified == null || now - modified <= EXPIRATION_MS) continue;
      try {
        entry.delete();
      } catch {
        // 尽力清除
      }
    }
  }
}

let store: PendingShareStore | null = null;

/** 统一工厂:按平台选择实现(§4)。 */
export function createPendingShareStore(): PendingShareStore {
  if (store) return store;
  store = Platform.OS === 'ios' ? new IosPendingShareStore() : new AndroidPendingShareStore();
  return store;
}

/** 仅供测试重置单例。 */
export function resetPendingShareStoreForTest(): void {
  store = null;
}
