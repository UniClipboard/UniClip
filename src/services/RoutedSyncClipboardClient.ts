import { AuthService } from './AuthService';
import { SyncClipboardClient } from './SyncClipboardClient';
import type { APIClientConfig, ISyncClipboardAPI } from './APIClient';
import type { ProfileDto, ServerInfo } from '@/types/api';
import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from 'android-util';
import type { HistoryRecordDto, IHistoryAPI } from './HistoryAPI';
import type { ServerConfig } from '@/types/api';
import { getCurrentNetworkContext } from './networkContext';
import { loadServerRouteLiveUrl, saveServerRouteLiveUrl } from './serverRouteRecordStore';
import { selectServerUrl, type ServerRoute } from './serverRouteSelector';

type RoutedSyncClipboardSurface = ISyncClipboardAPI & IHistoryAPI;

export class RoutedSyncClipboardClient implements RoutedSyncClipboardSurface {
  constructor(
    private readonly server: ServerConfig,
    private readonly config: Omit<APIClientConfig, 'baseURL'>
  ) {}

  async getClipboard(signal?: AbortSignal): Promise<ProfileDto> {
    return this.call('getClipboard', signal);
  }

  async putClipboard(profile: ProfileDto, signal?: AbortSignal): Promise<void> {
    return this.call('putClipboard', profile, signal);
  }

  async downloadFile(
    fileName: string,
    destinationUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<string> {
    return this.call('downloadFile', fileName, destinationUri, signal, onProgress);
  }

  async putFile(
    fileName: string,
    fileUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<void> {
    return this.call('putFile', fileName, fileUri, signal, onProgress);
  }

  async putContent(
    content: ClipboardContent,
    options?: { signal?: AbortSignal; onProgress?: (info: ProgressInfo) => void }
  ): Promise<void> {
    return this.call('putContent', content, options);
  }

  async getServerTime(signal?: AbortSignal): Promise<Date> {
    return this.call('getServerTime', signal);
  }

  async getVersion(): Promise<string> {
    return this.call('getVersion');
  }

  async getServerInfo(): Promise<ServerInfo> {
    return this.call('getServerInfo');
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    return this.call('testConnection', signal);
  }

  async getRecord(profileId: string, signal?: AbortSignal): Promise<HistoryRecordDto> {
    return this.call('getRecord', profileId, signal);
  }

  async downloadData(
    profileId: string,
    destinationUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<string> {
    return this.call('downloadData', profileId, destinationUri, signal, onProgress);
  }

  async uploadRecord(
    record: HistoryRecordDto,
    fileUri?: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<HistoryRecordDto> {
    return this.call('uploadRecord', record, fileUri, signal, onProgress);
  }

  private routeOptions() {
    return {
      network: getCurrentNetworkContext(),
      loadLiveUrl: loadServerRouteLiveUrl,
      saveLiveUrl: saveServerRouteLiveUrl,
      probeRoute: async (route: ServerRoute, signal?: AbortSignal) => {
        await this.createClient(route).getServerTime(signal);
      },
    };
  }

  private createClient(route: ServerRoute): SyncClipboardClient {
    const authService =
      route.server.username && route.server.password
        ? new AuthService(route.server.username, route.server.password)
        : this.config.authService;
    return new SyncClipboardClient({
      ...this.config,
      baseURL: route.url,
      authService,
    });
  }

  private async call<K extends MethodKeys<SyncClipboardClient>>(
    method: K,
    ...args: MethodArgs<SyncClipboardClient[K]>
  ): Promise<Awaited<ReturnType<Extract<SyncClipboardClient[K], (...args: any[]) => any>>>> {
    const selected = await selectServerUrl(this.server, this.routeOptions(), async (route) => {
      const client = this.createClient(route);
      const fn = client[method] as unknown;
      if (typeof fn !== 'function') {
        throw new Error(`Route client method is not callable: ${String(method)}`);
      }
      return (fn as (...callArgs: unknown[]) => unknown).apply(client, args);
    });
    return selected.result as Awaited<
      ReturnType<Extract<SyncClipboardClient[K], (...args: any[]) => any>>
    >;
  }
}

type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

type MethodArgs<T> = T extends (...args: infer A) => any ? A : never;
