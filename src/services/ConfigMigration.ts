import {
  AppSettings,
  RuntimeState,
  DEFAULT_SETTINGS,
  RUNTIME_STATE_DEFAULTS,
  SETTINGS_SCHEMA_VERSION,
} from '../types/settings';

const RUNTIME_STATE_KEYS: (keyof RuntimeState)[] = [
  'lastUpdateCheckDate',
  'needsHistoryReorganize',
];

const DEPRECATED_KEYS = [
  'autoSync',
  'theme',
  'historyImageAutoDownload',
  'syncInBackground',
  'enableShizukuClipboard',
] as const;

export function migrateConfig(
  raw: unknown,
  sourceSchemaVersion = SETTINGS_SCHEMA_VERSION
): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const old = raw as Record<string, unknown>;
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(old)) {
    if (RUNTIME_STATE_KEYS.includes(key as keyof RuntimeState)) continue;
    if ((DEPRECATED_KEYS as readonly string[]).includes(key)) continue;
    if (key in DEFAULT_SETTINGS && value !== undefined) {
      result[key] = value;
    }
  }

  // autoSync → autoApplyRemote + autoPushLocal
  if ('autoSync' in old && !('autoApplyRemote' in old)) {
    result.autoApplyRemote = true;
    result.autoPushLocal = !!old.autoSync;
  }

  // theme → appearance
  if ('theme' in old && !('appearance' in old)) {
    const theme = old.theme as string;
    result.appearance = theme === 'auto' ? 'system' : theme;
  }

  // historyImageAutoDownload → attachmentAutoDownload
  if ('historyImageAutoDownload' in old && !('attachmentAutoDownload' in old)) {
    result.attachmentAutoDownload = old.historyImageAutoDownload;
  }

  // syncInBackground → enableBackgroundTasks
  if ('syncInBackground' in old && !('enableBackgroundTasks' in old)) {
    result.enableBackgroundTasks = !!old.syncInBackground;
  }

  // Before schema v4, Chinese was persisted as the implicit default before
  // "follow system" existed, so it cannot be distinguished from a user choice.
  if (sourceSchemaVersion < 4 && old.language === 'zh-CN') {
    result.language = 'system';
  }

  // Builds before schema v3 exposed Shizuku as a standalone boolean.
  if (!('clipboardAccessMethod' in old)) {
    result.clipboardAccessMethod = old.enableShizukuClipboard === true ? 'shizuku' : 'overlay';
  }

  return result as unknown as AppSettings;
}

export function extractRuntimeState(raw: unknown): RuntimeState {
  if (!raw || typeof raw !== 'object') {
    return { ...RUNTIME_STATE_DEFAULTS };
  }

  const old = raw as Record<string, unknown>;
  return {
    lastUpdateCheckDate:
      typeof old.lastUpdateCheckDate === 'string'
        ? old.lastUpdateCheckDate
        : RUNTIME_STATE_DEFAULTS.lastUpdateCheckDate,
    needsHistoryReorganize:
      typeof old.needsHistoryReorganize === 'boolean'
        ? old.needsHistoryReorganize
        : RUNTIME_STATE_DEFAULTS.needsHistoryReorganize,
  };
}
