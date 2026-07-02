import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppGroupStoreNativeModule {
  saveServers(json: string): Promise<void>;
  getServers(): Promise<string>;
  saveSettings(json: string): Promise<void>;
  getSettings(): Promise<string>;
  getContainerUrl(): Promise<string | null>;
  getLegacyHistory(): Promise<string | null>;
  getPayloadFileUri(profileId: string): Promise<string | null>;
  writePayload(profileId: string, bytes: Uint8Array): Promise<string | null>;
  deletePayload(profileId: string): Promise<void>;
  clearPayloads(): Promise<void>;
  getPayloadStats(): Promise<PayloadStats>;
  getLastSyncedHash(): Promise<string | null>;
  getLastSyncedContentId(): Promise<string | null>;
  getLiveUrl(configId: string): Promise<string | null>;
  saveLiveUrl(configId: string, url: string | null): Promise<void>;
  migrateLegacyContainer(): Promise<LegacyMigrationResult>;
  getKeyboardStatus(): Promise<NativeKeyboardStatus>;
}

interface NativeKeyboardStatus {
  enabledInSystem?: boolean;
  everUsed: boolean;
  lastKnownFullAccess: boolean;
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

export interface KeyboardStatusDTO {
  /**
   * Whether the keyboard extension appears in the system keyboard list right
   * now. `null` when the OS does not expose the list (fall back to
   * {@link KeyboardStatusDTO.everUsed}).
   */
  enabledInSystem: boolean | null;
  /** The keyboard extension has appeared on screen at least once. */
  everUsed: boolean;
  /**
   * Full Access as of the keyboard's last appearance — a heartbeat, not a live
   * read; stale until the user opens the keyboard again.
   */
  lastKnownFullAccess: boolean;
}

export interface PayloadStats {
  count: number;
  totalSize: number;
}

const EMPTY_SERVERS: ServerConfigListDTO = { configs: [], activeConfigId: null };
const EMPTY_MIGRATION: LegacyMigrationResult = { migrated: false, keys: 0 };
const EMPTY_PAYLOAD_STATS: PayloadStats = { count: 0, totalSize: 0 };

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

export function getContainerUrl(): Promise<string | null> {
  return NativeModule?.getContainerUrl() ?? Promise.resolve(null);
}

export function getLegacyHistory(): Promise<string | null> {
  return NativeModule?.getLegacyHistory() ?? Promise.resolve(null);
}

export function getPayloadFileUri(profileId: string): Promise<string | null> {
  return NativeModule?.getPayloadFileUri(profileId) ?? Promise.resolve(null);
}

export function writePayload(profileId: string, bytes: Uint8Array): Promise<string | null> {
  return NativeModule?.writePayload(profileId, bytes) ?? Promise.resolve(null);
}

export function deletePayload(profileId: string): Promise<void> {
  return NativeModule?.deletePayload(profileId) ?? Promise.resolve();
}

export function clearPayloads(): Promise<void> {
  return NativeModule?.clearPayloads() ?? Promise.resolve();
}

export function getPayloadStats(): Promise<PayloadStats> {
  return NativeModule?.getPayloadStats() ?? Promise.resolve(EMPTY_PAYLOAD_STATS);
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

const EMPTY_KEYBOARD_STATUS: KeyboardStatusDTO = {
  enabledInSystem: null,
  everUsed: false,
  lastKnownFullAccess: false,
};

export async function getKeyboardStatus(): Promise<KeyboardStatusDTO> {
  // typeof guard: dev clients built before this function shipped expose the
  // module without it, and a plain optional call would throw.
  if (typeof NativeModule?.getKeyboardStatus !== 'function') return EMPTY_KEYBOARD_STATUS;
  const status = await NativeModule.getKeyboardStatus();
  if (!status) return EMPTY_KEYBOARD_STATUS;
  return {
    enabledInSystem: status.enabledInSystem ?? null,
    everUsed: status.everUsed ?? false,
    lastKnownFullAccess: status.lastKnownFullAccess ?? false,
  };
}
