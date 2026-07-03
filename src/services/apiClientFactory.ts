import { AuthService } from './AuthService';
import { RoutedSyncClipboardClient } from './RoutedSyncClipboardClient';
import { WebDAVClient } from './WebDAVClient';
import { S3Client } from './S3Client';
import { ConfigurationError } from './errors';
import type { ServerConfig } from '@/types/api';
import type { ISyncClipboardAPI } from './APIClient';
import type { IHistoryAPI } from './HistoryAPI';

export function createAPIClient(config: ServerConfig): ISyncClipboardAPI {
  const { type, url, username, password } = config;

  if (type === 'syncclipboard') {
    if (!url) {
      throw new ConfigurationError('Server URL is required');
    }
    const authService = username && password ? new AuthService(username, password) : undefined;
    return new RoutedSyncClipboardClient(config, { authService });
  }

  if (type === 's3') {
    if (!config.bucketName) {
      throw new ConfigurationError('Bucket name is required for S3');
    }
    if (!username || !password) {
      throw new ConfigurationError('Access Key ID and Secret Access Key are required for S3');
    }
    return new S3Client({
      serviceURL: url || undefined,
      region: config.region,
      bucketName: config.bucketName,
      objectPrefix: config.objectPrefix,
      forcePathStyle: config.forcePathStyle,
      accessKeyId: username,
      secretAccessKey: password,
    });
  }

  if (!url) {
    throw new ConfigurationError('Server URL is required');
  }
  if (!username || !password) {
    throw new ConfigurationError('Username and password are required for WebDAV');
  }
  return new WebDAVClient({ baseURL: url, username, password });
}

export function createHistoryAPIClient(config: ServerConfig): IHistoryAPI {
  if (config.type !== 'syncclipboard') {
    throw new ConfigurationError('History sync requires a SyncClipboard server');
  }
  if (!config.url) {
    throw new ConfigurationError('Server URL is required');
  }
  const authService =
    config.username && config.password
      ? new AuthService(config.username, config.password)
      : undefined;
  return new RoutedSyncClipboardClient(config, { authService });
}
