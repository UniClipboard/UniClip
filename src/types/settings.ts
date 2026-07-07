import { ServerConfig } from './api';
import { SyncMode, ConflictResolution } from './sync';

export interface ServerData {
  servers: ServerConfig[];
  activeServerIndex: number;
}

export interface SharedSettings {
  // Sync behavior
  trustInsecureCert: boolean;
  autoApplyRemote: boolean;
  autoPushLocal: boolean;
  syncOnStartup: boolean;
  /** SSE 推送通道开关；实际是否生效还叠加 feature-detect（服务端不支持则自动回退轮询）。 */
  enableSse: boolean;

  // Attachment & cache
  attachmentAutoDownload: 'wifi' | 'always' | 'off';
  payloadCacheMaxBytes: number;
  autoDownloadMaxSize: number;

  // History
  maxHistoryItems: number;

  // Updates
  autoCheckUpdate: boolean;
  updateToBeta: boolean;
  ignoredVersion: string | null;

  // Appearance
  appearance: 'system' | 'light' | 'dark';
  /** 界面语言偏好:'system' 跟随系统,或具体语言代码('zh-CN' | 'en')。见 src/i18n */
  language: string;

  // Logging & debug
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugMode: boolean;

  // Downloads
  downloadRelativePath: string;

  // iOS keyboard extension (consumed by the native keyboard via App Group)
  keyboardSoundFeedback: boolean;
  keyboardHapticFeedback: boolean;

  // Onboarding
  /** 首次启动引导是否已完成(RN 侧门控,不供原生扩展消费)。 */
  onboardingCompleted: boolean;
}

export interface AndroidSettings {
  // Background tasks
  enableBackgroundTasks: boolean;
  enableBackgroundDownload: boolean;
  enableBackgroundUpload: boolean;
  enableClipboardOverlay: boolean;
  enableSmsForwarding: boolean;
  enableForegroundNotification: boolean;

  // Notifications
  enableNotifications: boolean;
  syncToastEnabled: boolean;

  // UI
  hideFromRecents: boolean;
  showImageCopyButton: boolean;

  // Polling intervals
  remotePollingInterval: number;
  localPollingInterval: number;

  // Debug
  debugOverlayVisible: boolean;
  debugUrlScheme: boolean;
  debugUpdateCheckNoLimit: boolean;

  // SyncManager internals (not exposed in settings UI, kept for runtime)
  syncMode: SyncMode;
  syncInterval: number;
  conflictResolution: ConflictResolution;
  enableOfflineQueue: boolean;
  maxOfflineQueueSize: number;
  syncLargeFiles: boolean;
  largeFileThreshold: number;
}

export type AppSettings = ServerData & SharedSettings & AndroidSettings;

export interface RuntimeState {
  lastUpdateCheckDate: string;
  needsHistoryReorganize: boolean;
}

export const SERVER_DATA_DEFAULTS: ServerData = {
  servers: [],
  activeServerIndex: -1,
};

export const SHARED_DEFAULTS: SharedSettings = {
  trustInsecureCert: false,
  autoApplyRemote: true,
  autoPushLocal: false,
  syncOnStartup: true,
  enableSse: true,

  attachmentAutoDownload: 'wifi',
  payloadCacheMaxBytes: 200 * 1024 * 1024,
  autoDownloadMaxSize: 5 * 1024 * 1024,

  maxHistoryItems: 1000,

  autoCheckUpdate: true,
  updateToBeta: false,
  ignoredVersion: null,

  appearance: 'system',
  language: 'system',

  logLevel: __DEV__ ? 'debug' : 'info',
  debugMode: false,

  downloadRelativePath: '',

  keyboardSoundFeedback: true,
  keyboardHapticFeedback: true,

  onboardingCompleted: false,
};

export const ANDROID_DEFAULTS: AndroidSettings = {
  enableBackgroundTasks: false,
  enableBackgroundDownload: false,
  enableBackgroundUpload: false,
  enableClipboardOverlay: false,
  enableSmsForwarding: false,
  enableForegroundNotification: true,

  enableNotifications: true,
  syncToastEnabled: true,

  hideFromRecents: false,
  showImageCopyButton: false,

  remotePollingInterval: 3000,
  localPollingInterval: 1000,

  debugOverlayVisible: false,
  debugUrlScheme: false,
  debugUpdateCheckNoLimit: false,

  syncMode: SyncMode.Manual,
  syncInterval: 5000,
  conflictResolution: ConflictResolution.UseNewest,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 100,
  syncLargeFiles: true,
  largeFileThreshold: 10 * 1024 * 1024,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ...SERVER_DATA_DEFAULTS,
  ...SHARED_DEFAULTS,
  ...ANDROID_DEFAULTS,
};

export const RUNTIME_STATE_DEFAULTS: RuntimeState = {
  lastUpdateCheckDate: '',
  needsHistoryReorganize: false,
};

export const SETTINGS_SCHEMA_VERSION = 2;
