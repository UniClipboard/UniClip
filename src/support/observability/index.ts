export {
  calculateLogSize,
  cleanOldLogs,
  clearLogs,
  createLogger,
  createLogArchive,
  customFileTransport,
  deleteExportedLogArchive,
  getAppLogFileUris,
  getLogDirectory,
  getEngineLogFileUris,
  getLogFilePaths,
  getLogFileUris,
  getLogger,
  initLogger,
  saveLogsToFile,
  scheduleExportedLogArchiveCleanup,
  setLogLevel,
} from './internal/logger';
export { redactLogText } from './internal/logRedaction';
export type { AppLogger, ExportedLogArchive, LogConfig, LogLevel } from './internal/logger';

export {
  capturePostHogScreen,
  configurePostHogAnalytics,
  createPostHogOptions,
  filterPostHogEvent,
  PostHogAnalyticsController,
  startPostHogAnalytics,
  stopPostHogAnalytics,
} from './internal/postHogAnalytics';
