/**
 * Services Entry Point
 * Exports all API clients and services
 */

// Error classes
export * from './errors';

// Clipboard Services
export { ClipboardManager, clipboardManager } from './ClipboardManager';
export { ClipboardMonitor, clipboardMonitor } from './ClipboardMonitor';

// Shortcut Service
export { ShortcutService } from './ShortcutService';

// Update Service
export {
  checkForUpdate,
  checkForAutomaticUpdate,
  parseVersion,
  compareVersions,
  versionToStr,
} from './UpdateService';
export type {
  UpdateCheckResult,
  ParsedVersion,
  ReleaseAssetInfo,
  AutomaticUpdateSettings,
  AutomaticUpdateDependencies,
} from './UpdateService';

// APK Download Service
export {
  getPreferredAbi,
  findAssetForAbi,
  checkApkCache,
  downloadApk,
  installApk,
  getApkCachePath,
  cleanOldApkCache,
} from './ApkDownloadService';
export type { ApkDownloadOptions, ApkDownloadProgress, ApkSource } from './ApkDownloadService';
// Storage Services
export { ConfigStorage, configStorage } from './ConfigStorage';
export { HistoryStorage, historyStorage } from './HistoryStorage';
export { CacheManager, cacheManager } from './CacheManager';

// Logger Service
export {
  initLogger,
  getLogger,
  setLogLevel,
  getLogDirectory,
  getLogFilePaths,
  getLogFileUris,
  calculateLogSize,
  clearLogs,
  cleanOldLogs,
  log,
  createLogArchive,
  saveLogsToFile,
  deleteExportedLogArchive,
  scheduleExportedLogArchiveCleanup,
  type ExportedLogArchive,
  type LogConfig,
  type LogLevel,
} from './Logger';
