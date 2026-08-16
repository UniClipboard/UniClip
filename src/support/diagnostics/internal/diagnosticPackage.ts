import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { strToU8, zipSync } from 'fflate';
import { getShareDiagnostics } from 'app-group-store';

import type { SharedSettings } from '@/types/settings';
import type { PeerConnectionStatus, UnifiedEngineStatus } from '@/stores/unifiedEngineStore';
import { getAppLogFileUris, getEngineLogFileUris, redactLogText } from '@/support/observability';
import type { DiagnosticReason } from './diagnosticEventClassifier';

const DIAGNOSTIC_ARCHIVE_SCHEMA_VERSION = 1;
const MAX_LOG_BYTES_PER_FILE = 512 * 1024;
const DIAGNOSTIC_ARCHIVE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface DiagnosticSettingsSnapshot {
  autoApplyRemote: SharedSettings['autoApplyRemote'];
  autoPushLocal: SharedSettings['autoPushLocal'];
  attachmentAutoDownload: SharedSettings['attachmentAutoDownload'];
  logLevel: SharedSettings['logLevel'];
}

export interface DiagnosticSyncSnapshot {
  status: UnifiedEngineStatus;
  peerConnectionStatus: PeerConnectionStatus;
  hasSpace: boolean;
  deviceCount: number;
  lastErrorReason: DiagnosticReason | null;
}

export interface DiagnosticArchiveInput {
  settings: DiagnosticSettingsSnapshot;
  sync: DiagnosticSyncSnapshot;
}

export interface DiagnosticArtifact {
  uri: string;
  fileName: string;
}

export type DiagnosticArchiveErrorCode = 'engine_logs_missing' | 'engine_logs_unreadable';

export class DiagnosticArchiveError extends Error {
  constructor(public readonly code: DiagnosticArchiveErrorCode) {
    super(code);
    this.name = 'DiagnosticArchiveError';
  }
}

interface CollectedLogFiles {
  entries: Record<string, Uint8Array>;
  discoveredFileCount: number;
  includedFileCount: number;
  unreadableFileCount: number;
  truncatedFileCount: number;
}

function formatFileTimestamp(date: Date): string {
  const [calendarDate, time] = date.toISOString().split('T');
  return `${calendarDate}_${time.replace(/:/g, '-').replace(/\.\d{3}Z$/, '')}`;
}

function safeFileName(name: string): string {
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return safeName.length > 0 ? safeName : 'log.txt';
}

function createArchiveAbortError(): Error {
  const error = new Error('Diagnostic archive creation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfArchiveAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createArchiveAbortError();
}

async function collectLogFiles(
  fileUris: string[],
  directory: string,
  signal?: AbortSignal
): Promise<CollectedLogFiles> {
  const entries: Record<string, Uint8Array> = {};
  let unreadableFileCount = 0;
  let truncatedFileCount = 0;

  for (const uri of fileUris) {
    throwIfArchiveAborted(signal);
    try {
      const file = new File(uri);
      const content =
        file.size > MAX_LOG_BYTES_PER_FILE
          ? await file.slice(file.size - MAX_LOG_BYTES_PER_FILE).text()
          : await file.text();
      if (file.size > MAX_LOG_BYTES_PER_FILE) truncatedFileCount += 1;
      entries[`${directory}/${safeFileName(file.name)}`] = strToU8(redactLogText(content));
      throwIfArchiveAborted(signal);
    } catch {
      unreadableFileCount += 1;
    }
  }

  return {
    entries,
    discoveredFileCount: fileUris.length,
    includedFileCount: Object.keys(entries).length,
    unreadableFileCount,
    truncatedFileCount,
  };
}

function collectionStatus(result: CollectedLogFiles): 'included' | 'partial' | 'missing' {
  if (result.includedFileCount === 0) return 'missing';
  return result.unreadableFileCount > 0 ? 'partial' : 'included';
}

export async function createDiagnosticArchive(
  input: DiagnosticArchiveInput,
  now = new Date(),
  signal?: AbortSignal
): Promise<DiagnosticArtifact> {
  throwIfArchiveAborted(signal);
  const fileName = `uniclip_diagnostics_${formatFileTimestamp(now)}.zip`;
  const artifact = new File(Paths.cache, fileName);
  const appLogs = await collectLogFiles(getAppLogFileUris(), 'logs/app', signal);
  const engineLogs = await collectLogFiles(getEngineLogFileUris(), 'logs/engine', signal);

  if (input.sync.status === 'running' && engineLogs.discoveredFileCount === 0) {
    throw new DiagnosticArchiveError('engine_logs_missing');
  }
  if (
    input.sync.status === 'running' &&
    engineLogs.discoveredFileCount > 0 &&
    engineLogs.includedFileCount === 0
  ) {
    throw new DiagnosticArchiveError('engine_logs_unreadable');
  }

  const shareDiagnostics = await getShareDiagnostics();
  throwIfArchiveAborted(signal);
  const shareArchive = shareDiagnostics ?? { schemaVersion: 1, attempts: [] };
  const manifest = {
    schemaVersion: DIAGNOSTIC_ARCHIVE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    app: {
      version: Application.nativeApplicationVersion ?? 'unknown',
      build: Application.nativeBuildVersion ?? 'unknown',
    },
    system: {
      platform: Platform.OS,
      osVersion: String(Platform.Version),
    },
    settings: input.settings,
    sync: input.sync,
    collection: {
      appLogs: {
        status: collectionStatus(appLogs),
        discoveredFileCount: appLogs.discoveredFileCount,
        includedFileCount: appLogs.includedFileCount,
        unreadableFileCount: appLogs.unreadableFileCount,
        truncatedFileCount: appLogs.truncatedFileCount,
      },
      engineLogs: {
        status: collectionStatus(engineLogs),
        discoveredFileCount: engineLogs.discoveredFileCount,
        includedFileCount: engineLogs.includedFileCount,
        unreadableFileCount: engineLogs.unreadableFileCount,
        truncatedFileCount: engineLogs.truncatedFileCount,
      },
      shareAttempts: {
        status: shareDiagnostics === null ? 'missing' : 'included',
        attemptCount: shareArchive.attempts.length,
      },
    },
  };
  const entries = {
    ...appLogs.entries,
    ...engineLogs.entries,
    'extensions/share_attempts.json': strToU8(`${JSON.stringify(shareArchive, null, 2)}\n`),
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  try {
    if (artifact.exists) artifact.delete();
    artifact.write(zipSync(entries, { level: 6 }));
    return { uri: artifact.uri, fileName };
  } catch (error) {
    if (artifact.exists) artifact.delete();
    throw error;
  }
}

export function deleteDiagnosticArchive(uri: string): void {
  try {
    const artifact = new File(uri);
    if (artifact.exists) artifact.delete();
  } catch {
    // Cache cleanup is best-effort and must never leave the diagnostics UI stuck.
  }
}

export function scheduleDiagnosticArchiveCleanup(uri: string): void {
  setTimeout(() => deleteDiagnosticArchive(uri), DIAGNOSTIC_ARCHIVE_RETENTION_MS);
}
