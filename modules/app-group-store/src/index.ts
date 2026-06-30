import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppGroupStoreNativeModule {
  saveServers(json: string): Promise<void>;
  getServers(): Promise<string>;
  saveSettings(json: string): Promise<void>;
  getSettings(): Promise<string>;
  getLastSyncedHash(): Promise<string | null>;
  getLastSyncedContentId(): Promise<string | null>;
  getLiveUrl(configId: string): Promise<string | null>;
  saveLiveUrl(configId: string, url: string | null): Promise<void>;
  migrateLegacyContainer(): Promise<LegacyMigrationResult>;
}

const NativeModule = requireOptionalNativeModule<AppGroupStoreNativeModule>('AppGroupStore');

export interface ServerConfigDTO {
  id: string;
  name?: string;
  urls: string[];
  username: string;
  password: string;
}

export interface ServerConfigListDTO {
  configs: ServerConfigDTO[];
  activeConfigId: string | null;
}

export interface AppSettingsDTO {
  trustInsecureCert?: boolean;
  autoApplyServerChanges?: boolean;
  autoPushDeviceChanges?: boolean;
  prefetchAttachments?: boolean;
  prefetchOnCellular?: boolean;
  payloadCacheMaxBytes?: number;
  appearance?: 'system' | 'light' | 'dark';
  autoCheckUpdate?: boolean;
  ignoredVersion?: string | null;
  downloadRelativePath?: string;
  logViewLevelFilter?: string;
  keyboardSoundFeedback?: boolean;
  keyboardHapticFeedback?: boolean;
}

export interface LegacyMigrationResult {
  migrated: boolean;
  keys: number;
}

const EMPTY_SERVERS: ServerConfigListDTO = { configs: [], activeConfigId: null };
const EMPTY_MIGRATION: LegacyMigrationResult = { migrated: false, keys: 0 };

export function saveServers(list: ServerConfigListDTO): Promise<void> {
  return NativeModule?.saveServers(JSON.stringify(list)) ?? Promise.resolve();
}

export async function getServers(): Promise<ServerConfigListDTO> {
  const json = await NativeModule?.getServers();
  return json ? (JSON.parse(json) as ServerConfigListDTO) : EMPTY_SERVERS;
}

export function saveSettings(settings: AppSettingsDTO): Promise<void> {
  return NativeModule?.saveSettings(JSON.stringify(settings)) ?? Promise.resolve();
}

export async function getSettings(): Promise<AppSettingsDTO> {
  const json = await NativeModule?.getSettings();
  return json ? (JSON.parse(json) as AppSettingsDTO) : {};
}

export function getLastSyncedHash(): Promise<string | null> {
  return NativeModule?.getLastSyncedHash() ?? Promise.resolve(null);
}

/**
 * The opaque server identity (`blake3v1:<hex>`) paired with the App Group
 * last-synced hash watermark, or null when absent (legacy server, freshly
 * pushed and not re-learned, or no extension activity). Written verbatim by
 * the keyboard extension once it learns the identity from a GET; the main
 * app reads it alongside {@link getLastSyncedHash} so its SyncEngine prefers
 * contentId over hash for dedup (stable across server re-encodes).
 */
export function getLastSyncedContentId(): Promise<string | null> {
  return NativeModule?.getLastSyncedContentId() ?? Promise.resolve(null);
}

export function getLiveUrl(configId: string): Promise<string | null> {
  return NativeModule?.getLiveUrl(configId) ?? Promise.resolve(null);
}

export function saveLiveUrl(configId: string, url: string | null): Promise<void> {
  return NativeModule?.saveLiveUrl(configId, url) ?? Promise.resolve();
}

export function migrateLegacyContainer(): Promise<LegacyMigrationResult> {
  return NativeModule?.migrateLegacyContainer() ?? Promise.resolve(EMPTY_MIGRATION);
}
