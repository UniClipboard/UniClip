import { Platform } from 'react-native';

export interface SharedSettings {
  // Sync behavior
  autoApplyRemote: boolean;
  autoPushLocal: boolean;

  // Attachment & cache
  attachmentAutoDownload: 'wifi' | 'always' | 'off';
  payloadCacheMaxBytes: number;

  // History
  maxHistoryItems: number;

  // Updates
  autoCheckUpdate: boolean;
  updateToBeta: boolean;
  ignoredVersion: string | null;

  // Appearance
  appearance: 'system' | 'light' | 'dark';
  /** 界面语言偏好:'system' 跟随系统,或具体语言代码('zh-CN' | 'en' | 'ru' | 'pt-BR')。见 src/i18n */
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
  /** One-time recovery state for users upgraded from the removed LAN connection flow. */
  legacyPairingGuide: 'none' | 'pending';
}

export type ClipboardAccessMethod = 'overlay-polling' | 'overlay-event' | 'shizuku';

export interface AndroidSettings {
  // Background tasks
  enableBackgroundTasks: boolean;
  enableBackgroundDownload: boolean;
  enableBackgroundUpload: boolean;
  /** Whether background synchronization may use mobile data or requires Wi-Fi. */
  backgroundSyncNetwork: 'any' | 'wifi';
  clipboardAccessMethod: ClipboardAccessMethod;
  enableClipboardOverlay: boolean;
  enableForegroundNotification: boolean;

  // Notifications
  enableNotifications: boolean;
  syncToastEnabled: boolean;

  // UI
  hideFromRecents: boolean;
  showImageCopyButton: boolean;

  // Debug
  debugOverlayVisible: boolean;
  debugUrlScheme: boolean;
  debugUpdateCheckNoLimit: boolean;
}

export type AppSettings = SharedSettings & AndroidSettings;

export interface RuntimeState {
  lastUpdateCheckDate: string;
  needsHistoryReorganize: boolean;
}

export const SHARED_DEFAULTS: SharedSettings = {
  autoApplyRemote: true,
  autoPushLocal: true,

  attachmentAutoDownload: 'wifi',
  payloadCacheMaxBytes: 200 * 1024 * 1024,

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
  legacyPairingGuide: 'none',
};

export const ANDROID_DEFAULTS: AndroidSettings = {
  enableBackgroundTasks: false,
  enableBackgroundDownload: false,
  enableBackgroundUpload: false,
  backgroundSyncNetwork: 'any',
  clipboardAccessMethod: 'overlay-polling',
  enableClipboardOverlay: false,
  enableForegroundNotification: true,

  enableNotifications: true,
  syncToastEnabled: true,

  hideFromRecents: false,
  showImageCopyButton: false,

  debugOverlayVisible: false,
  debugUrlScheme: false,
  debugUpdateCheckNoLimit: false,
};

export const IOS_DEFAULTS: Pick<SharedSettings, 'autoApplyRemote' | 'autoPushLocal'> = {
  autoApplyRemote: true,
  autoPushLocal: true,
};

export function createDefaultSettings(platform: string): AppSettings {
  const platformDefaults = platform === 'ios' ? IOS_DEFAULTS : {};

  return {
    ...SHARED_DEFAULTS,
    ...ANDROID_DEFAULTS,
    ...platformDefaults,
  };
}

export const DEFAULT_SETTINGS: AppSettings = createDefaultSettings(Platform.OS);

export const RUNTIME_STATE_DEFAULTS: RuntimeState = {
  lastUpdateCheckDate: '',
  needsHistoryReorganize: false,
};

export const SETTINGS_SCHEMA_VERSION = 9;
