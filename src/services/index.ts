/**
 * Services Entry Point
 * Exports all API clients and services
 */

// Error classes
export * from './errors';

// Authentication
export { AuthService, type Credentials } from './AuthService';

// API Clients
export { APIClient, type APIClientConfig, type ISyncClipboardAPI } from './APIClient';
export { SyncClipboardClient } from './SyncClipboardClient';
export { WebDAVClient, type WebDAVConfig } from './WebDAVClient';
export { S3Client, type S3ClientConfig } from './S3Client';

// Clipboard Services
export { ClipboardManager, clipboardManager } from './ClipboardManager';
export { ClipboardMonitor, clipboardMonitor } from './ClipboardMonitor';

// Sync Manager
export { SyncManager } from './SyncManager';

// Remote Clipboard Sync Service
export { getClipboardSyncService as getClipboardSyncService } from './ClipboardSyncService';

// Shortcut Service
export { ShortcutService } from './ShortcutService';

// Update Service
export { checkForUpdate, parseVersion, compareVersions, versionToStr } from './UpdateService';
export type { UpdateCheckResult, ParsedVersion, ReleaseAssetInfo } from './UpdateService';

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
export { createAPIClient } from './apiClientFactory';

// Storage Services
export { ConfigStorage, configStorage } from './ConfigStorage';
export { HistoryStorage, historyStorage } from './HistoryStorage';
export { CacheManager, cacheManager } from './CacheManager';
export { SecureStorage, secureStorage } from './SecureStorage';

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
