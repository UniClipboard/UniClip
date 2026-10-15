export type DiagnosticArchiveWarningCode =
  | 'engine_logs_missing'
  | 'engine_logs_unreadable'
  | 'engine_logs_written_not_found';

export type DiagnosticWarningMessageKey =
  | 'engineLogsMissing'
  | 'engineLogsUnreadable'
  | 'engineLogsWrittenNotFound';

const MESSAGE_KEY: Record<DiagnosticArchiveWarningCode, DiagnosticWarningMessageKey> = {
  engine_logs_missing: 'engineLogsMissing',
  engine_logs_unreadable: 'engineLogsUnreadable',
  engine_logs_written_not_found: 'engineLogsWrittenNotFound',
};

export function diagnosticWarningMessageKeys(
  warnings: readonly DiagnosticArchiveWarningCode[]
): DiagnosticWarningMessageKey[] {
  return warnings.map((warning) => MESSAGE_KEY[warning]);
}
