import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServers, saveServers, saveSettings } from 'app-group-store';
import type { ServerConfig } from '../types/api';
import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings';
import { CONFIG_USER_STATE_KEY } from './ConfigStorage';

export interface AppGroupServerConfigDTO {
  id: string;
  name?: string;
  urls: string[];
  username: string;
  password: string;
}

export interface AppGroupServerConfigListDTO {
  configs: AppGroupServerConfigDTO[];
  activeConfigId: string | null;
}

export interface AppGroupSettingsDTO {
  trustInsecureCert?: boolean;
  autoApplyServerChanges?: boolean;
  autoPushDeviceChanges?: boolean;
  prefetchAttachments?: boolean;
  prefetchOnCellular?: boolean;
  payloadCacheMaxBytes?: number;
  appearance?: 'system' | 'light' | 'dark';
  language?: string;
  autoCheckUpdate?: boolean;
  ignoredVersion?: string | null;
  downloadRelativePath?: string;
  logViewLevelFilter?: string;
  keyboardSoundFeedback?: boolean;
  keyboardHapticFeedback?: boolean;
}

type SettingsSlice = {
  servers: ServerConfig[];
  activeServerIndex: number;
  settings: AppSettings;
};

export function mapServersToAppGroupDTO(
  servers: ServerConfig[],
  activeServerIndex: number
): AppGroupServerConfigListDTO {
  const activeServer = servers[activeServerIndex] ?? null;
  const idCounts = new Map<string, number>();
  const configs: AppGroupServerConfigDTO[] = [];
  let activeConfigId: string | null = null;

  for (const server of servers) {
    if (server.type !== 'syncclipboard') continue;

    const mapped = mapServerToAppGroupDTO(server, idCounts);
    if (!mapped) continue;

    if (server === activeServer) {
      activeConfigId = mapped.id;
    }
    configs.push(mapped);
  }

  return {
    configs,
    activeConfigId,
  };
}

export function mapSettingsToAppGroupDTO(settings: AppSettings): AppGroupSettingsDTO {
  const prefetch = mapAttachmentPrefetch(settings.attachmentAutoDownload);

  return {
    trustInsecureCert: settings.trustInsecureCert,
    autoApplyServerChanges: settings.autoApplyRemote,
    autoPushDeviceChanges: settings.autoPushLocal,
    prefetchAttachments: prefetch.attachments,
    prefetchOnCellular: prefetch.cellular,
    payloadCacheMaxBytes: settings.payloadCacheMaxBytes,
    appearance: settings.appearance,
    language: settings.language,
    autoCheckUpdate: settings.autoCheckUpdate,
    ignoredVersion: settings.ignoredVersion,
    downloadRelativePath: settings.downloadRelativePath,
    logViewLevelFilter: settings.logLevel,
    keyboardSoundFeedback: settings.keyboardSoundFeedback,
    keyboardHapticFeedback: settings.keyboardHapticFeedback,
  };
}

export function getAppGroupSyncSnapshot(config: AppSettings | null): string | null {
  const slice = selectSettingsSlice(config);
  if (!slice) return null;

  return JSON.stringify({
    servers: mapServersToAppGroupDTO(slice.servers, slice.activeServerIndex),
    settings: mapSettingsToAppGroupDTO(slice.settings),
  });
}

export async function syncConfigToAppGroup(config: AppSettings | null): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const slice = selectSettingsSlice(config);
  if (!slice) return;

  const servers = mapServersToAppGroupDTO(slice.servers, slice.activeServerIndex);
  const settings = mapSettingsToAppGroupDTO(slice.settings);
  if (await shouldSkipEmptyDefaultServerOverwrite(slice.settings, servers)) {
    const existingServers = await getServers();
    if (existingServers.configs.length > 0) {
      await saveSettings(settings);
      return;
    }
  }

  await Promise.all([saveServers(servers), saveSettings(settings)]);
}

function selectSettingsSlice(config: AppSettings | null): SettingsSlice | null {
  if (!config) return null;
  return {
    servers: config.servers,
    activeServerIndex: config.activeServerIndex,
    settings: config,
  };
}

function mapServerToAppGroupDTO(
  server: ServerConfig,
  idCounts: Map<string, number>
): AppGroupServerConfigDTO | null {
  const urls = normalizeServerUrls(server);
  if (urls.length === 0) return null;
  const id = makeUniqueConfigId(urls[0], idCounts);

  return {
    id,
    ...(server.name ? { name: server.name } : {}),
    urls,
    username: server.username ?? '',
    password: server.password ?? '',
  };
}

function makeUniqueConfigId(baseId: string, counts: Map<string, number>): string {
  const count = counts.get(baseId) ?? 0;
  counts.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}#${count + 1}`;
}

function normalizeServerUrls(server: ServerConfig): string[] {
  const candidates = server.urls && server.urls.length > 0 ? server.urls : [server.url];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeBaseURL(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function normalizeBaseURL(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '') || null;
  }
}

function mapAttachmentPrefetch(value: AppSettings['attachmentAutoDownload']): {
  attachments: boolean;
  cellular: boolean;
} {
  switch (value) {
    case 'always':
      return { attachments: true, cellular: true };
    case 'wifi':
      return { attachments: true, cellular: false };
    case 'off':
      return { attachments: false, cellular: false };
  }
}

function shouldSkipEmptyDefaultServerOverwrite(
  settings: AppSettings,
  servers: AppGroupServerConfigListDTO
): Promise<boolean> {
  if (
    !(
      servers.configs.length === 0 &&
      servers.activeConfigId === null &&
      settings.servers.length === 0 &&
      settings.activeServerIndex === -1 &&
      isFreshDefaultConfig(settings)
    )
  ) {
    return Promise.resolve(false);
  }

  return AsyncStorage.getItem(CONFIG_USER_STATE_KEY).then((state) => state !== '1');
}

function isFreshDefaultConfig(settings: AppSettings): boolean {
  return JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS);
}
