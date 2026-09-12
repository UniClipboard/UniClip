import * as Application from 'expo-application';
import { File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { getShareDiagnostics } from 'app-group-store';
import { prepareEngineDiagnosticExport, type EngineDiagnosticExportReport, coreVersion, flushEngineLogs, getEngineLogStatus, getNativeDiagnostics, type EngineLogStatus, type NativeDiagnosticsSnapshot } from 'uc-engine';

import type { SharedSettings } from '@/types/settings';
import type { PeerConnectionStatus, UnifiedEngineStatus } from '@/stores/unifiedEngineStore';
import { flushAppLogs, getAppLogCaptureStatus, getAppLogFileUris, getEngineLogFileUris, redactLogText } from '@/support/observability';
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

function readBoundedLogTail(file: File): string {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    const start = Math.max(0, size - MAX_LOG_BYTES_PER_FILE);
    // Include the preceding byte so a tail starting exactly at a line boundary is preserved.
    handle.offset = Math.max(0, start - 1);
    const bytes = handle.readBytes(Math.min(size, MAX_LOG_BYTES_PER_FILE + 1));
    if (start === 0) return strFromU8(bytes);
    // Discard a clipped first record before decoding, including a possible partial UTF-8 character.
    const boundary = bytes.indexOf(10);
    return boundary < 0 ? '' : strFromU8(bytes.subarray(boundary + 1));
  } finally {
    handle.close();
  }
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
      const truncated = file.size > MAX_LOG_BYTES_PER_FILE;
      const content = truncated ? readBoundedLogTail(file) : await file.text();
      if (truncated) truncatedFileCount += 1;
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
  return result.unreadableFileCount > 0 || result.truncatedFileCount > 0 ? 'partial' : 'included';
}

function nativeSourceCoverage(entries: Record<string, Uint8Array>, metadata: NativeDiagnosticsSnapshot | null) {
  const roles = Platform.OS === 'ios' ? ['main', 'keyboard', 'share'] : ['main'];
  return Object.fromEntries(roles.map((role) => {
    let recordCount = 0;
    let malformedRecordCount = 0;
    const timestamps: string[] = [];
    const sessions = new Set<string>();
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name.startsWith(`logs/native/native-runtime.${role}.`)) continue;
      for (const line of strFromU8(bytes).split('\n').filter(Boolean)) {
        try {
          const record = JSON.parse(line);
          if (record.role !== role || typeof record.timestamp !== 'string' || !Number.isFinite(Date.parse(record.timestamp))) {
            malformedRecordCount += 1;
            continue;
          }
          recordCount += 1;
          timestamps.push(record.timestamp);
          if (typeof record.sessionId === 'string') sessions.add(record.sessionId);
        } catch { malformedRecordCount += 1; }
      }
    }
    timestamps.sort();
    const discoveredFiles = metadata?.fileUris.filter((uri) => uri.split('/').at(-1)?.startsWith(`native-runtime.${role}.`)).length ?? 0;
    const includedFiles = Object.keys(entries).filter((name) => name.startsWith(`logs/native/native-runtime.${role}.`)).length;
    const unavailable = metadata?.discoveryStatus !== 'completed' || (metadata.writer.role === role && metadata.writer.writerStatus === 'unavailable');
    const status = recordCount > 0
      ? (malformedRecordCount > 0 || includedFiles < discoveredFiles ? 'partial' : 'included')
      : metadata === null ? 'notCollected'
      : discoveredFiles > includedFiles ? 'unreadable'
      : malformedRecordCount > 0 ? 'invalidRecords'
      : unavailable ? 'unavailable' : 'noRetainedEvents';
    return [role, {
      status, discoveredFileCount: discoveredFiles, includedFileCount: includedFiles,
      unreadableFileCount: Math.max(0, discoveredFiles - includedFiles),
      flushStatus: metadata?.writer.role === role ? metadata.flushStatus : 'notObserved',
      recordingStatus: metadata?.writer.role === role ? metadata.writer.writerStatus : 'notObserved',
      recordCount, malformedRecordCount, sessionCount: sessions.size,
      firstRecordAt: timestamps[0] ?? null, lastRecordAt: timestamps.at(-1) ?? null,
    }];
  }));
}

function nativeWriterMetadata(snapshot: NativeDiagnosticsSnapshot | null) {
  if (!snapshot) return null;
  const writer = snapshot.writer;
  return {
    policy: writer.policy, effectiveLevel: writer.effectiveLevel, writerStatus: writer.writerStatus,
    role: writer.role, sessionId: writer.sessionId, startedAt: writer.startedAt, capturedAt: writer.capturedAt,
    droppedRecords: writer.droppedRecords, writeFailures: writer.writeFailures, prunedFiles: writer.prunedFiles,
    filteredRecordCount: null, retentionDays: writer.retentionDays,
    maxFileBytes: writer.maxFileBytes, maxFiles: writer.maxFiles,
    counterScope: 'currentCaptureSession',
  };
}

export async function createDiagnosticArchive(
  input: DiagnosticArchiveInput,
  now = new Date(),
  signal?: AbortSignal
): Promise<DiagnosticArtifact> {
  throwIfArchiveAborted(signal);
  const fileName = `uniclip_diagnostics_${formatFileTimestamp(now)}.zip`;
  const artifact = new File(Paths.cache, fileName);
  let appFlushStatus: 'completed' | 'incomplete' | 'unavailable';
  try { appFlushStatus = (await flushAppLogs()) ? 'completed' : 'incomplete'; }
  catch { appFlushStatus = 'unavailable'; }
  throwIfArchiveAborted(signal);
  const appLogUris = getAppLogFileUris();
  const eligibleAppLogUris = appLogUris.filter((uri) => !uri.split('/').at(-1)?.startsWith('kotlin_'));
  const appLogs = await collectLogFiles(eligibleAppLogUris, 'logs/app', signal);
  let appCapture: ReturnType<typeof getAppLogCaptureStatus> | null = null;
  try { appCapture = getAppLogCaptureStatus(); } catch { /* Report unknown rather than guess. */ }
  let engineReport: EngineDiagnosticExportReport | null = null;
  let engineFlushStatus: 'completed' | 'incomplete' | 'unavailable';
  try {
    engineReport = await prepareEngineDiagnosticExport();
    engineFlushStatus = engineReport.flush === 'completed' ? 'completed' : 'incomplete';
  } catch {
    try { engineFlushStatus = (await flushEngineLogs()) ? 'completed' : 'incomplete'; }
    catch { engineFlushStatus = 'unavailable'; }
  }
  throwIfArchiveAborted(signal);
  let engineLogStatus: EngineLogStatus = {
    localFile: 'unavailable',
    droppedLocalRecords: null,
    installation: null,
  };
  try {
    engineLogStatus = await getEngineLogStatus();
  } catch {
    // Preserve existing evidence even when native status is unavailable.
  }
  throwIfArchiveAborted(signal);
  const engineLogs = await collectLogFiles(getEngineLogFileUris(), 'logs/engine', signal);

  const engineLogIssues: DiagnosticArchiveErrorCode[] = [];
  if (
    engineFlushStatus === 'completed' &&
    engineLogStatus.localFile === 'ready' &&
    input.sync.status === 'running' &&
    engineLogs.discoveredFileCount === 0
  ) {
    engineLogIssues.push('engine_logs_missing');
  }
  if (
    engineFlushStatus === 'completed' &&
    engineLogStatus.localFile === 'ready' &&
    input.sync.status === 'running' &&
    engineLogs.discoveredFileCount > 0 &&
    engineLogs.includedFileCount === 0
  ) {
    engineLogIssues.push('engine_logs_unreadable');
  }

  let nativeDiagnostics: NativeDiagnosticsSnapshot | null = null;
  try {
    const snapshot = await getNativeDiagnostics();
    if (snapshot?.writer && Array.isArray(snapshot.fileUris)) nativeDiagnostics = snapshot;
  } catch { /* Keep other evidence. */ }
  throwIfArchiveAborted(signal);
  const nativeLogs = await collectLogFiles(nativeDiagnostics?.fileUris ?? [], 'logs/native', signal);
  let engineVersion: string | null = null;
  try { engineVersion = coreVersion(); } catch { /* Older native modules may not report a version. */ }
  let shareDiagnostics: Awaited<ReturnType<typeof getShareDiagnostics>> = null;
  try { shareDiagnostics = await getShareDiagnostics(); } catch { /* Preserve independently collected sources. */ }
  throwIfArchiveAborted(signal);
  const shareArchive = shareDiagnostics ?? { schemaVersion: 1, attempts: [] };
  const nativeSources = nativeSourceCoverage(nativeLogs.entries, nativeDiagnostics);
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
    coverage: {
      complete: false,
      systemLogs: 'notCollected',
      legacyNativeDebugLogs: 'notCollected',
      engineCapturePolicy: engineReport ? 'reportedByEngine' : 'notReportedByEngine',
      crossProcessEngineCorrelation: engineReport ? 'processLocalOnly' : 'notReportedByEngine',
      nativeNetworkScope: 'defaultNetworkPathOnly',
    },
    engineBuild: { version: engineReport?.status.engineVersion ?? engineVersion, sourceRevision: engineReport?.status.sourceCommit ?? null, sourceRevisionStatus: engineReport ? 'reportedByEngine' : 'notReportedByEngine' },
    settings: input.settings,
    sync: input.sync,
    collection: {
      appLogs: {
        status: collectionStatus(appLogs),
        flushStatus: appFlushStatus,
        capturePolicy: appCapture,
        excludedLegacyNativeFileCount: appLogUris.length - eligibleAppLogUris.length,
        discoveredFileCount: appLogs.discoveredFileCount,
        includedFileCount: appLogs.includedFileCount,
        unreadableFileCount: appLogs.unreadableFileCount,
        truncatedFileCount: appLogs.truncatedFileCount,
      },
      engineLogs: {
        flushStatus: engineFlushStatus,
        flushScope: 'exportingProcess',
        issues: engineLogIssues,
        exportReport: engineReport,
        capturePolicy: {
          status: engineReport ? 'reportedByEngine' : 'notReportedByEngine',
          mode: engineReport?.status.capture.mode ?? null,
          effectiveLevel: null, filteredRecordCount: engineReport?.status.policyFilteredRecords ?? null,
          counterScope: engineReport?.status.counterScope ?? null,
          appLogLevelControlsEngine: false,
        },
        localFile: engineLogStatus.localFile,
        droppedLocalRecords: engineLogStatus.droppedLocalRecords,
        installation: engineLogStatus.installation ? {
          localFile: engineLogStatus.installation.localFile,
          droppedLocalRecords: engineLogStatus.installation.droppedLocalRecords,
        } : null,
        status: collectionStatus(engineLogs),
        discoveredFileCount: engineLogs.discoveredFileCount,
        includedFileCount: engineLogs.includedFileCount,
        unreadableFileCount: engineLogs.unreadableFileCount,
        truncatedFileCount: engineLogs.truncatedFileCount,
      },
      nativeLogs: {
        status: nativeLogs.includedFileCount > 0 && (Object.values(nativeSources).some((source) => source.malformedRecordCount > 0) || nativeDiagnostics?.discoveryStatus === 'partial') ? 'partial' : collectionStatus(nativeLogs),
        metadataStatus: nativeDiagnostics ? 'available' : 'unavailable',
        discoveryStatus: nativeDiagnostics?.discoveryStatus ?? 'unavailable',
        skippedFileCount: nativeDiagnostics?.skippedFileCount ?? null,
        flushStatus: nativeDiagnostics?.flushStatus ?? 'unavailable',
        flushScope: 'exportingProcess',
        discoveredFileCount: nativeLogs.discoveredFileCount,
        includedFileCount: nativeLogs.includedFileCount,
        unreadableFileCount: nativeLogs.unreadableFileCount,
        truncatedFileCount: nativeLogs.truncatedFileCount,
        writer: nativeWriterMetadata(nativeDiagnostics),
        sources: nativeSources,
      },
      shareAttempts: {
        status: shareDiagnostics === null ? 'missing' : 'included',
        sourceState: Platform.OS !== 'ios' ? 'notApplicable' : shareDiagnostics === null ? 'unavailable' : shareArchive.attempts.length === 0 ? 'noEvents' : 'available',
        attemptCount: shareArchive.attempts.length,
      },
    },
  };
  const entries = {
    ...appLogs.entries,
    ...engineLogs.entries,
    ...nativeLogs.entries,
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
