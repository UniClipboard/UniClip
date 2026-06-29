import type { AddServerSaveData } from '@/components/AddServerSheet.types';
import type { ServerConfig } from '@/types/api';

export function getAddServerInitialData(config: ServerConfig): AddServerSaveData {
  return {
    name: config.name ?? '',
    urls: config.urls && config.urls.length > 0 ? config.urls : [config.url],
    username: config.username ?? '',
    password: config.password ?? '',
  };
}

export function buildServerConfigFromAddServerData(
  data: AddServerSaveData,
  existing?: ServerConfig
): ServerConfig {
  return {
    ...existing,
    type: existing?.type ?? 'syncclipboard',
    url: data.urls[0],
    urls: data.urls,
    name: data.name || undefined,
    username: data.username,
    password: data.password,
  };
}
