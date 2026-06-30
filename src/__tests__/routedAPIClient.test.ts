import { RoutedSyncClipboardClient } from '@/services/RoutedSyncClipboardClient';
import type { ServerConfig } from '@/types/api';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

const mockGetLiveUrl = jest.fn();
const mockSaveLiveUrl = jest.fn();
const mockLoadServerRouteLiveUrl = jest.fn();
const mockSaveServerRouteLiveUrl = jest.fn();
let mockNetwork = { isWifi: true, isCellular: false, isTailscale: false };
const mockCalls: string[] = [];
const mockProbeCalls: string[] = [];

jest.mock('app-group-store', () => ({
  getLiveUrl: (...args: unknown[]) => mockGetLiveUrl(...args),
  saveLiveUrl: (...args: unknown[]) => mockSaveLiveUrl(...args),
}));

jest.mock('@/services/serverRouteRecordStore', () => ({
  loadServerRouteLiveUrl: (...args: unknown[]) => mockLoadServerRouteLiveUrl(...args),
  saveServerRouteLiveUrl: (...args: unknown[]) => mockSaveServerRouteLiveUrl(...args),
}));

jest.mock('@/services/networkContext', () => ({
  getCurrentNetworkContext: () => mockNetwork,
}));

jest.mock('@/services/SyncClipboardClient', () => ({
  SyncClipboardClient: class SyncClipboardClient {
    private readonly baseURL: string;
    constructor(config: { baseURL: string }) {
      this.baseURL = config.baseURL;
    }
    async getClipboard() {
      mockCalls.push(this.baseURL);
      if (this.baseURL === 'http://192.168.1.20:5033') {
        throw new Error('network offline');
      }
      return { type: 'Text', text: 'ok', hasData: false };
    }
    async getServerTime() {
      mockProbeCalls.push(this.baseURL);
      if (this.baseURL === 'http://192.168.1.20:5033') {
        throw new Error('network offline');
      }
      return new Date();
    }
  },
}));

function syncServer(): ServerConfig {
  return {
    type: 'syncclipboard',
    url: 'https://clip.example.com',
    urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
    username: 'alice',
    password: 'secret',
  };
}

describe('routed API client factory', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockProbeCalls.length = 0;
    mockGetLiveUrl.mockResolvedValue(null);
    mockSaveLiveUrl.mockResolvedValue(undefined);
    mockLoadServerRouteLiveUrl.mockResolvedValue(null);
    mockSaveServerRouteLiveUrl.mockResolvedValue(undefined);
    mockNetwork = { isWifi: true, isCellular: false, isTailscale: false };
  });

  it('retries the next server address when the preferred route is unreachable', async () => {
    const client = new RoutedSyncClipboardClient(syncServer(), {});

    await expect(client.getClipboard()).resolves.toMatchObject({ text: 'ok' });

    expect(mockProbeCalls).toEqual(
      expect.arrayContaining(['http://192.168.1.20:5033', 'https://clip.example.com'])
    );
    expect(mockCalls).toEqual(['https://clip.example.com']);
    expect(mockSaveServerRouteLiveUrl).toHaveBeenCalledWith(
      'https://clip.example.com',
      'https://clip.example.com'
    );
  });

  it('does not let a remembered lower-priority address block the current route', async () => {
    mockLoadServerRouteLiveUrl.mockResolvedValue('https://clip.example.com');

    const client = new RoutedSyncClipboardClient(syncServer(), {});
    await expect(client.getClipboard()).resolves.toMatchObject({ text: 'ok' });

    expect(mockProbeCalls).toEqual(
      expect.arrayContaining(['http://192.168.1.20:5033', 'https://clip.example.com'])
    );
    expect(mockCalls).toEqual(['https://clip.example.com']);
  });

  it('keeps a remembered address first when it still matches the current route class', async () => {
    mockNetwork = { isWifi: false, isCellular: true, isTailscale: false };
    mockLoadServerRouteLiveUrl.mockResolvedValue('https://clip.example.com');

    const client = new RoutedSyncClipboardClient(syncServer(), {});
    await expect(client.getClipboard()).resolves.toMatchObject({ text: 'ok' });

    expect(mockCalls).toEqual(['https://clip.example.com']);
  });

  it('reads the latest network context for each request', async () => {
    const client = new RoutedSyncClipboardClient(syncServer(), {});

    await expect(client.getClipboard()).resolves.toMatchObject({ text: 'ok' });
    mockCalls.length = 0;
    mockSaveServerRouteLiveUrl.mockClear();
    mockNetwork = { isWifi: false, isCellular: true, isTailscale: false };

    await expect(client.getClipboard()).resolves.toMatchObject({ text: 'ok' });

    expect(mockCalls).toEqual(['https://clip.example.com']);
  });
});
