import { CONFIG_USER_STATE_KEY, ConfigStorage } from '../services/ConfigStorage';
import { STORAGE_KEYS } from '../types/storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { ServerConfig } from '../types/api';
import { SyncMode } from '../types/sync';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const next = Object.create(actual);
  Object.defineProperty(next, 'Platform', {
    value: {
      ...actual.Platform,
      OS: 'ios',
    },
  });
  return next;
});

jest.mock('app-group-store', () => ({
  getServers: jest.fn().mockResolvedValue({ configs: [], activeConfigId: null }),
  getSettings: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/Logger', () => ({
  log: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { getServers, getSettings } from 'app-group-store';

interface TestableConfigStorage extends ConfigStorage {
  initialize(): Promise<void>;
}

interface ConfigStoragePrivate {
  initialized: boolean;
  config: AppSettings | null;
}

describe('ConfigStorage', () => {
  let configStorage: TestableConfigStorage;
  const mockGetItem = AsyncStorage.getItem as jest.Mock;
  const mockSetItem = AsyncStorage.setItem as jest.Mock;
  const mockGetServers = getServers as jest.Mock;
  const mockGetSettings = getSettings as jest.Mock;

  const getPrivate = (storage: TestableConfigStorage): ConfigStoragePrivate => {
    return storage as unknown as ConfigStoragePrivate;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockGetServers.mockReset();
    mockGetSettings.mockReset();
    mockGetServers.mockResolvedValue({ configs: [], activeConfigId: null });
    mockGetSettings.mockResolvedValue({});
    configStorage = ConfigStorage.getInstance() as TestableConfigStorage;
    const privateProps = getPrivate(configStorage);
    privateProps.initialized = false;
    privateProps.config = null;
  });

  describe('initialize', () => {
    it('should load config from storage', async () => {
      const mockConfig: AppSettings = {
        ...DEFAULT_SETTINGS,
        servers: [{ type: 'syncclipboard', url: 'https://test.com' }],
        activeServerIndex: 0,
      };
      mockGetItem.mockResolvedValue(JSON.stringify(mockConfig));

      await configStorage.initialize();

      expect(mockGetItem).toHaveBeenCalledWith(STORAGE_KEYS.CONFIG);
    });

    it('should use default config if no config storage', async () => {
      mockGetItem.mockResolvedValue(null);
      mockSetItem.mockResolvedValue(undefined);

      await configStorage.initialize();

      expect(mockSetItem).toHaveBeenCalled();
    });

    it('seeds first-launch config from App Group servers before saving defaults', async () => {
      mockGetItem.mockResolvedValue(null);
      mockSetItem.mockResolvedValue(undefined);
      mockGetServers.mockResolvedValue({
        configs: [
          {
            id: 'primary',
            name: 'Primary',
            urls: ['https://server.example.com', 'http://lan.local'],
            username: 'alice',
            password: 'secret',
          },
          {
            id: 'secondary',
            urls: ['https://backup.example.com'],
            username: 'bob',
            password: 'backup',
          },
        ],
        activeConfigId: 'secondary',
      });
      mockGetSettings.mockResolvedValue({
        trustInsecureCert: true,
        autoApplyServerChanges: false,
        autoPushDeviceChanges: true,
        prefetchAttachments: true,
        prefetchOnCellular: true,
        payloadCacheMaxBytes: 12345,
        appearance: 'dark',
        autoCheckUpdate: false,
        ignoredVersion: '2.0.0',
        downloadRelativePath: 'Downloads',
        logViewLevelFilter: 'warn',
      });

      await configStorage.initialize();

      const savedConfig = JSON.parse(
        mockSetItem.mock.calls.find(([key]) => key === STORAGE_KEYS.CONFIG)?.[1]
      );
      expect(savedConfig.servers).toEqual([
        {
          type: 'syncclipboard',
          name: 'Primary',
          url: 'https://server.example.com',
          urls: ['https://server.example.com', 'http://lan.local'],
          username: 'alice',
          password: 'secret',
        },
        {
          type: 'syncclipboard',
          url: 'https://backup.example.com',
          urls: ['https://backup.example.com'],
          username: 'bob',
          password: 'backup',
        },
      ]);
      expect(savedConfig.activeServerIndex).toBe(1);
      expect(savedConfig.trustInsecureCert).toBe(true);
      expect(savedConfig.autoApplyRemote).toBe(false);
      expect(savedConfig.autoPushLocal).toBe(true);
      expect(savedConfig.attachmentAutoDownload).toBe('always');
      expect(savedConfig.payloadCacheMaxBytes).toBe(12345);
      expect(savedConfig.appearance).toBe('dark');
      expect(savedConfig.autoCheckUpdate).toBe(false);
      expect(savedConfig.ignoredVersion).toBe('2.0.0');
      expect(savedConfig.downloadRelativePath).toBe('Downloads');
      expect(savedConfig.logLevel).toBe('warn');
      expect(mockSetItem).not.toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
    });

    it('should not reload if already initialized', async () => {
      const privateProps = getPrivate(configStorage);
      privateProps.initialized = true;

      await configStorage.initialize();

      expect(mockGetItem).not.toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('should return config after initialization', async () => {
      const mockConfig: AppSettings = {
        ...DEFAULT_SETTINGS,
        syncMode: SyncMode.Manual,
      };
      mockGetItem.mockResolvedValue(JSON.stringify(mockConfig));

      const result = await configStorage.getConfig();

      expect(result.syncMode).toBe(SyncMode.Manual);
    });

    it('should return a copy of config', async () => {
      mockGetItem.mockResolvedValue(JSON.stringify(DEFAULT_SETTINGS));

      const result = await configStorage.getConfig();

      result.syncMode = SyncMode.Auto;
      const result2 = await configStorage.getConfig();

      expect(result2.syncMode).not.toBe(SyncMode.Auto);
    });
  });

  describe('updateConfig', () => {
    it('should update config and save', async () => {
      mockGetItem.mockResolvedValue(JSON.stringify(DEFAULT_SETTINGS));
      mockSetItem.mockResolvedValue(undefined);

      await configStorage.updateConfig({ syncMode: SyncMode.Auto });

      expect(mockSetItem).toHaveBeenCalled();
      expect(mockSetItem).toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
    });
  });

  describe('resetConfig', () => {
    it('should reset to default config', async () => {
      mockGetItem.mockResolvedValue(JSON.stringify(DEFAULT_SETTINGS));
      mockSetItem.mockResolvedValue(undefined);

      await configStorage.resetConfig();

      expect(mockSetItem).toHaveBeenCalledWith(
        STORAGE_KEYS.CONFIG,
        JSON.stringify(DEFAULT_SETTINGS)
      );
      expect(mockSetItem).toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
    });
  });

  describe('Server Management', () => {
    beforeEach(async () => {
      const mockConfig: AppSettings = {
        ...DEFAULT_SETTINGS,
        servers: [{ type: 'syncclipboard', url: 'https://server1.com' }],
        activeServerIndex: 0,
      };
      mockGetItem.mockResolvedValue(JSON.stringify(mockConfig));
      await configStorage.initialize();
    });

    describe('getServers', () => {
      it('should return all servers', async () => {
        const servers = await configStorage.getServers();

        expect(servers).toHaveLength(1);
        expect(servers[0].url).toBe('https://server1.com');
      });

      it('should return a copy of servers array', async () => {
        const servers = await configStorage.getServers();
        servers.push({ type: 'webdav', url: 'https://server2.com' });

        const servers2 = await configStorage.getServers();
        expect(servers2).toHaveLength(1);
      });
    });

    describe('getActiveServer', () => {
      it('should return active server', async () => {
        const server = await configStorage.getActiveServer();

        expect(server).not.toBeNull();
        expect(server?.url).toBe('https://server1.com');
      });

      it('should return null if no active server', async () => {
        mockGetItem.mockResolvedValue(
          JSON.stringify({ ...DEFAULT_SETTINGS, servers: [], activeServerIndex: -1 })
        );
        const privateProps = getPrivate(configStorage);
        privateProps.initialized = false;
        await configStorage.initialize();

        const server = await configStorage.getActiveServer();

        expect(server).toBeNull();
      });
    });

    describe('addServer', () => {
      it('should add server and return index', async () => {
        const newServer: ServerConfig = { type: 'syncclipboard', url: 'https://server2.com' };
        mockSetItem.mockResolvedValue(undefined);

        const index = await configStorage.addServer(newServer);

        expect(index).toBe(1);
      });

      it('should auto-activate first server', async () => {
        const newServer: ServerConfig = { type: 'syncclipboard', url: 'https://server2.com' };
        mockGetItem.mockResolvedValue(
          JSON.stringify({ ...DEFAULT_SETTINGS, servers: [], activeServerIndex: -1 })
        );
        const privateProps = getPrivate(configStorage);
        privateProps.initialized = false;
        await configStorage.initialize();
        mockSetItem.mockResolvedValue(undefined);

        await configStorage.addServer(newServer);

        const server = await configStorage.getActiveServer();
        expect(server).not.toBeNull();
      });
    });

    describe('updateServer', () => {
      it('should update server at index', async () => {
        mockSetItem.mockResolvedValue(undefined);

        await configStorage.updateServer(0, { url: 'https://updated.com' });

        const servers = await configStorage.getServers();
        expect(servers[0].url).toBe('https://updated.com');
      });

      it('should throw error for invalid index', async () => {
        await expect(configStorage.updateServer(99, { url: 'https://test.com' })).rejects.toThrow(
          'Invalid server index'
        );
      });
    });

    describe('deleteServer', () => {
      it('should delete server at index', async () => {
        mockSetItem.mockResolvedValue(undefined);

        await configStorage.deleteServer(0);

        const servers = await configStorage.getServers();
        expect(servers).toHaveLength(0);
      });

      it('should adjust active index when deleting active server', async () => {
        mockSetItem.mockResolvedValue(undefined);

        await configStorage.deleteServer(0);

        const config = await configStorage.getConfig();
        expect(config.activeServerIndex).toBe(-1);
      });

      it('should throw error for invalid index', async () => {
        await expect(configStorage.deleteServer(99)).rejects.toThrow('Invalid server index');
      });
    });

    describe('setActiveServer', () => {
      it('should set active server index', async () => {
        mockGetItem.mockResolvedValue(
          JSON.stringify({
            ...DEFAULT_SETTINGS,
            servers: [
              { type: 'syncclipboard', url: 'https://server1.com' },
              { type: 'webdav', url: 'https://server2.com' },
            ],
            activeServerIndex: 0,
          })
        );
        const privateProps = getPrivate(configStorage);
        privateProps.initialized = false;
        await configStorage.initialize();
        mockSetItem.mockResolvedValue(undefined);

        await configStorage.setActiveServer(1);

        const config = await configStorage.getConfig();
        expect(config.activeServerIndex).toBe(1);
      });
    });
  });
});
