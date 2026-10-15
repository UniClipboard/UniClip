export type DiagnosticArchiveWarningCode =
  | 'engine_logs_missing'
  | 'engine_logs_unreadable'
  | 'engine_logs_written_not_found'
  | 'network_logs_incomplete';

export type DiagnosticWarningMessageKey =
  | 'engineLogsMissing'
  | 'engineLogsUnreadable'
  | 'engineLogsWrittenNotFound'
  | 'networkLogsIncomplete';

const MESSAGE_KEY: Record<DiagnosticArchiveWarningCode, DiagnosticWarningMessageKey> = {
  engine_logs_missing: 'engineLogsMissing',
  engine_logs_unreadable: 'engineLogsUnreadable',
  engine_logs_written_not_found: 'engineLogsWrittenNotFound',
  network_logs_incomplete: 'networkLogsIncomplete',
};

export function diagnosticWarningMessageKeys(
  warnings: readonly DiagnosticArchiveWarningCode[]
): DiagnosticWarningMessageKey[] {
  return warnings.map((warning) => MESSAGE_KEY[warning]);
}
