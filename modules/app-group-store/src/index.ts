import { requireNativeModule } from 'expo-modules-core';

const NativeModule = requireNativeModule('AppGroupStore');

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

export function saveServers(list: ServerConfigListDTO): Promise<void> {
  return NativeModule.saveServers(JSON.stringify(list));
}

export async function getServers(): Promise<ServerConfigListDTO> {
  return JSON.parse(await NativeModule.getServers()) as ServerConfigListDTO;
}

export function saveSettings(settings: AppSettingsDTO): Promise<void> {
  return NativeModule.saveSettings(JSON.stringify(settings));
}

export async function getSettings(): Promise<AppSettingsDTO> {
  return JSON.parse(await NativeModule.getSettings()) as AppSettingsDTO;
}

export function getLastSyncedHash(): Promise<string | null> {
  return NativeModule.getLastSyncedHash();
}

export function migrateLegacyContainer(): Promise<LegacyMigrationResult> {
  return NativeModule.migrateLegacyContainer();
}
