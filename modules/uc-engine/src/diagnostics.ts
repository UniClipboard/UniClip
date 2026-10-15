export interface EngineCaptureStatus {
  mode: 'standard' | 'detailed';
  captureId: string | null;
  remainingMs: number;
  startedAtUtc: string | null;
  endReason: string | null;
  lastCaptureId: string | null;
  revision: number;
}
export interface EngineDiagnosticStatus {
  runId: string;
  capture: EngineCaptureStatus;
  observedRecords: number;
  policyFilteredRecords: number;
  schemaRejectedRecords: number;
  correlationLimitedRecords: number;
  engineVersion: string;
  sourceCommit: string;
  counterScope: string;
  sources: Array<{ source: string; capability: string; collection: string; observedCount: number; policyFilteredCount: number }>;
  localFile: string;
  closed: boolean;
}
export interface EngineDiagnosticExportReport {
  flush: 'completed' | 'failed' | 'timedOut' | 'alreadyShutdown';
  status: EngineDiagnosticStatus;
  requestedAtUtc: string;
  completedAtUtc: string;
  otherProcessesFlushed: boolean;
  files: Array<{ source: string; acceptedCount: number; writtenCount: number; queueDroppedCount: number; quotaDroppedCount: number; writeFailedCount: number; lastWrittenAtMs: number | null }>;
}

/** Error names the native network-log host returns; they are fixed identifiers, never message text. */
export type NetworkLogError =
  | 'notConfigured'
  | 'notInstalled'
  | 'alreadyInstalled'
  | 'invalidConfig'
  | 'invalidDuration'
  | 'captureMismatch'
  | 'alreadyShutdown'
  | 'invalidDeadline'
  | 'stagingFailed'
  | 'internal'
  /** The installed native module predates the network log API. */
  | 'unsupported';
export type NetworkLogResult<T> =
  | { ok: true; value: T }
  /** `configuration` is how this process configured the log before install, e.g. `notConfigured`. */
  | { ok: false; error: NetworkLogError; configuration?: string };
export interface NetworkLogCounters {
  accepted: number;
  written: number;
  policyFiltered: number;
  rateLimited: number;
  oversized: number;
  queueDropped: number;
  closedDropped: number;
  writeFailed: number;
  rotatedOutFiles: number;
  pathRecovered: number;
  unreviewedCallsites: number;
}
export interface NetworkLogStatus {
  schemaVersion: number;
  state: 'starting' | 'ready' | 'unavailable' | 'closed';
  runId: string;
  role: 'daemon' | 'mobile_app' | 'keyboard_extension' | 'share_extension' | 'background_service';
  mode: 'standard' | 'detailed';
  detailedRemainingMs: number | null;
  counters: NetworkLogCounters;
  libraries: Array<{ library: string; versionDir: string | null; approvedRules: number; observedRecords: number }>;
  sampledAtUtc: string;
}
export interface NetworkLogCaptureStatus {
  captureId: string;
  startedAtUtc: string;
  durationMs: number;
  alreadyActive: boolean;
}
export interface NetworkLogEngineExportReport {
  flush: 'completed' | 'failed' | 'timedOut' | 'alreadyShutdown';
  status: NetworkLogStatus;
  requestedAtUtc: string;
  completedAtUtc: string;
  otherProcessesFlushed: boolean;
  /** What the Engine saw when it flushed: file names, sizes and SHA-256 of this process's current run. */
  files: Array<{ name: string; bytes: number; sha256: string }>;
}
export interface NetworkLogExportFile {
  role: string;
  runId: string;
  name: string;
  /** Size and SHA-256 of the staged copy that `uri` points to. */
  bytes: number;
  sha256: string;
  uri: string;
  isCurrentRun: boolean;
  /** `appendedAfterSnapshot` means the live writer added bytes after the Engine flushed. */
  engineCheck: 'exact' | 'appendedAfterSnapshot' | 'mismatch' | 'notReported';
}
export interface NetworkLogExport {
  /** Null when the Engine could not flush (for example `notConfigured`); see `engineError`. */
  engine: NetworkLogEngineExportReport | null;
  engineError: NetworkLogError | null;
  rootAvailable: boolean;
  /** Pass to `releaseNetworkLogExport` once the staged files were read. Null when nothing was staged. */
  exportId: string | null;
  files: NetworkLogExportFile[];
  discoveredRunCount: number;
  /** Lease locks, links and unexpected files are never exported; this counts them. */
  skippedEntryCount: number;
  unreadableFileCount: number;
  /** Only the exporting process was flushed; the keyboard extension is never woken for logs. */
  flushScope: 'currentProcessOnly';
}
