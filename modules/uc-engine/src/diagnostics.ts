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
