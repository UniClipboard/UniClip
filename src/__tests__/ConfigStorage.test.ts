import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearLegacyLanConfiguration,
  getLanServerPassword,
  getLegacyLanConfiguration,
  getSettings,
  setLanServerPassword,
} from 'app-group-store';
import { CONFIG_USER_STATE_KEY, ConfigStorage } from '../features/settings';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings } from '../types/settings';
import { STORAGE_KEYS } from '../types/storage';

const SETTINGS_SCHEMA_VERSION_KEY = '@syncclipboard:schema_version';
const secureValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const next = Object.create(actual);
  Object.defineProperty(next, 'Platform', { value: { ...actual.Platform, OS: 'ios' } });
  return next;
});

interface ConfigStoragePrivate {
  initialized: boolean;
  config: AppSettings | null;
}

describe('ConfigStorage', () => {
  const storage = ConfigStorage.getInstance();
  const mockGetItem = jest.mocked(AsyncStorage.getItem);
  const mockSetItem = jest.mocked(AsyncStorage.setItem);
  const mockRemoveItem = jest.mocked(AsyncStorage.removeItem);
  const mockGetSettings = jest.mocked(getSettings);
  const mockGetLegacyLanConfiguration = jest.mocked(getLegacyLanConfiguration);
  const mockClearLegacyLanConfiguration = jest.mocked(clearLegacyLanConfiguration);
  const mockSetSecret = jest.mocked(setLanServerPassword);
  const mockGetSecret = jest.mocked(getLanServerPassword);

  beforeEach(() => {
    jest.clearAllMocks();
    (storage as unknown as ConfigStoragePrivate).initialized = false;
    (storage as unknown as ConfigStoragePrivate).config = null;
    mockSetItem.mockResolvedValue(undefined);
    mockRemoveItem.mockResolvedValue(undefined);
    mockGetSettings.mockResolvedValue({});
    mockGetLegacyLanConfiguration.mockResolvedValue(null);
    mockClearLegacyLanConfiguration.mockResolvedValue(undefined);
    secureValues.clear();
    mockGetSecret.mockImplementation(async (serverId) => secureValues.get(serverId) ?? null);
    mockSetSecret.mockImplementation(async (serverId, value) => {
      secureValues.set(serverId, value);
    });
  });

  it('loads the current settings format without a schema migration', async () => {
    const current = {
      ...DEFAULT_SETTINGS,
      language: 'ru',
    };
    mockGetItem.mockImplementation((key) =>
      Promise.resolve(
        key === SETTINGS_SCHEMA_VERSION_KEY
          ? String(SETTINGS_SCHEMA_VERSION)
          : JSON.stringify(current)
      )
    );

    await storage.initialize();

    const config = await storage.getConfig();
    expect(config.language).toBe('ru');
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('migrates a configured v5 LAN install without requiring re-pairing', async () => {
    const legacyConfig = {
      servers: [
        {
          type: 'syncclipboard',
          name: 'Home',
          url: 'http://192.168.1.8:5033',
          urls: ['http://192.168.1.8:5033', 'https://home.example.test'],
          username: 'mobile',
          password: 'old-password',
        },
      ],
      activeServerIndex: 0,
      trustInsecureCert: true,
      autoApplyRemote: false,
      onboardingCompleted: true,
      language: 'zh-CN',
    };
    mockGetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG) return Promise.resolve(JSON.stringify(legacyConfig));
      if (key === SETTINGS_SCHEMA_VERSION_KEY) return Promise.resolve('5');
      return Promise.resolve(null);
    });

    await storage.initialize();

    const config = await storage.getConfig();
    expect(config).toEqual(
      expect.objectContaining({
        syncChannel: 'lan',
        autoApplyRemote: false,
        language: 'zh-CN',
      })
    );
    expect(config.lanServers).toEqual([
      {
        id: expect.any(String),
        name: 'Home',
        urls: ['http://192.168.1.8:5033', 'https://home.example.test'],
        username: 'mobile',
        allowInsecureTls: true,
      },
    ]);
    expect(config).not.toHaveProperty('legacyPairingGuide');
    expect(mockSetSecret).toHaveBeenCalledWith(config.lanServers[0].id, 'old-password');
    expect(mockClearLegacyLanConfiguration).toHaveBeenCalledTimes(1);
    expect(mockSetItem.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearLegacyLanConfiguration.mock.invocationCallOrder[0]
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      SETTINGS_SCHEMA_VERSION_KEY,
      String(SETTINGS_SCHEMA_VERSION)
    );
  });

  it('does not mark an unused v1 install as needing re-pairing', async () => {
    mockGetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG) {
        return Promise.resolve(JSON.stringify({ servers: [], activeServerIndex: -1 }));
      }
      if (key === SETTINGS_SCHEMA_VERSION_KEY) return Promise.resolve('5');
      return Promise.resolve(null);
    });

    await storage.initialize();

    await expect(storage.getConfig()).resolves.not.toHaveProperty('legacyPairingGuide');
  });

  it('recovers a legacy password from the old credential entry', async () => {
    const credentialKey = '@syncclipboard:secure:credentials:http://192.168.1.9:5033:legacy-user';
    mockGetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG) {
        return Promise.resolve(
          JSON.stringify({
            servers: [
              {
                type: 'syncclipboard',
                url: 'http://192.168.1.9:5033',
                username: 'legacy-user',
              },
            ],
            activeServerIndex: 0,
          })
        );
      }
      if (key === SETTINGS_SCHEMA_VERSION_KEY) return Promise.resolve('5');
      if (key === credentialKey) return Promise.resolve('b2xkLXNlY3JldA==');
      return Promise.resolve(null);
    });

    await storage.initialize();

    const config = await storage.getConfig();
    expect(mockSetSecret).toHaveBeenCalledWith(config.lanServers[0].id, 'old-secret');
    expect(mockRemoveItem).toHaveBeenCalledWith(credentialKey);
  });

  it('reads the old credential key using the exact legacy URL spelling', async () => {
    const credentialKey = '@syncclipboard:secure:credentials:http://192.168.1.9:5033/:legacy-user';
    mockGetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG) {
        return Promise.resolve(
          JSON.stringify({
            servers: [
              {
                type: 'syncclipboard',
                url: 'http://192.168.1.9:5033/',
                username: 'legacy-user',
              },
            ],
            activeServerIndex: 0,
          })
        );
      }
      if (key === SETTINGS_SCHEMA_VERSION_KEY) return Promise.resolve('5');
      if (key === credentialKey) return Promise.resolve('dHJhaWxpbmctc2xhc2gtc2VjcmV0');
      return Promise.resolve(null);
    });

    await storage.initialize();

    const config = await storage.getConfig();
    expect(mockSetSecret).toHaveBeenCalledWith(config.lanServers[0].id, 'trailing-slash-secret');
    expect(mockRemoveItem).toHaveBeenCalledWith(credentialKey);
  });

  it('retries native legacy cleanup after the new configuration was committed', async () => {
    const migrationJournalKey = '@syncclipboard:migration:legacy-lan:v1';
    const values = new Map<string, string>([
      [
        STORAGE_KEYS.CONFIG,
        JSON.stringify({
          servers: [
            {
              type: 'syncclipboard',
              name: 'Home',
              url: 'http://192.168.1.10:5033',
              username: 'mobile',
              password: 'password',
            },
          ],
          activeServerIndex: 0,
        }),
      ],
      [SETTINGS_SCHEMA_VERSION_KEY, '5'],
    ]);
    const secrets = new Map<string, string>();
    mockGetItem.mockImplementation((key) => Promise.resolve(values.get(key) ?? null));
    mockSetItem.mockImplementation(async (key, value) => {
      values.set(key, value);
    });
    mockRemoveItem.mockImplementation(async (key) => {
      values.delete(key);
    });
    mockSetSecret.mockImplementation(async (key, value) => {
      secrets.set(key, value);
    });
    mockGetSecret.mockImplementation(async (key) => secrets.get(key) ?? null);
    mockClearLegacyLanConfiguration
      .mockRejectedValueOnce(new Error('container temporarily unavailable'))
      .mockResolvedValueOnce(undefined);

    await storage.initialize();
    await expect(storage.getConfig()).resolves.toEqual(
      expect.objectContaining({ lanServers: [expect.objectContaining({ id: expect.any(String) })] })
    );
    expect(values.has(migrationJournalKey)).toBe(true);

    (storage as unknown as ConfigStoragePrivate).initialized = false;
    (storage as unknown as ConfigStoragePrivate).config = null;
    await storage.initialize();

    expect(mockClearLegacyLanConfiguration).toHaveBeenCalledTimes(2);
    expect(values.has(migrationJournalKey)).toBe(false);
  });

  it('keeps the legacy source and retries after a destination write fails', async () => {
    const migrationJournalKey = '@syncclipboard:migration:legacy-lan:v1';
    const legacyConfig = JSON.stringify({
      servers: [
        {
          type: 'syncclipboard',
          name: 'Home',
          url: 'http://192.168.1.13:5033',
          username: 'mobile',
          password: 'password',
        },
      ],
      activeServerIndex: 0,
    });
    const values = new Map<string, string>([
      [STORAGE_KEYS.CONFIG, legacyConfig],
      [SETTINGS_SCHEMA_VERSION_KEY, '5'],
    ]);
    mockGetItem.mockImplementation((key) => Promise.resolve(values.get(key) ?? null));
    let rejectConfigWrite = true;
    mockSetItem.mockImplementation(async (key, value) => {
      if (key === STORAGE_KEYS.CONFIG && rejectConfigWrite) {
        rejectConfigWrite = false;
        throw new Error('simulated disk failure');
      }
      values.set(key, value);
    });
    mockRemoveItem.mockImplementation(async (key) => {
      values.delete(key);
    });

    await storage.initialize();

    expect(values.get(STORAGE_KEYS.CONFIG)).toBe(legacyConfig);
    expect(values.has(migrationJournalKey)).toBe(true);
    expect(mockClearLegacyLanConfiguration).not.toHaveBeenCalled();

    (storage as unknown as ConfigStoragePrivate).initialized = false;
    (storage as unknown as ConfigStoragePrivate).config = null;
    await storage.initialize();

    expect(JSON.parse(values.get(STORAGE_KEYS.CONFIG)!)).toEqual(
      expect.objectContaining({
        lanServers: [expect.objectContaining({ name: 'Home' })],
      })
    );
    expect(mockClearLegacyLanConfiguration).toHaveBeenCalledTimes(1);
    expect(values.has(migrationJournalKey)).toBe(false);
  });

  it('seeds only current shared preferences on first launch', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetSettings.mockResolvedValue({
      autoApplyRemoteChanges: false,
      autoPushDeviceChanges: true,
      payloadCacheMaxBytes: 12345,
      appearance: 'dark',
      language: 'pt-BR',
    });

    await storage.initialize();

    await expect(storage.getConfig()).resolves.toEqual(
      expect.objectContaining({
        autoApplyRemote: false,
        autoPushLocal: true,
        payloadCacheMaxBytes: 12345,
        appearance: 'dark',
        language: 'pt-BR',
      })
    );
    expect(mockSetItem).not.toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
  });

  it('recovers an iOS LAN server when only the legacy shared container has it', async () => {
    mockGetItem.mockResolvedValue(null);
    mockGetLegacyLanConfiguration.mockResolvedValue({
      servers: [
        {
          id: 'old-home',
          name: 'Home',
          urls: ['http://192.168.1.11:5033'],
          username: 'mobile',
          password: 'shared-password',
        },
      ],
      activeServerIndex: 0,
      trustInsecureCert: true,
    });

    await storage.initialize();

    const config = await storage.getConfig();
    expect(config.syncChannel).toBe('lan');
    expect(config.lanServers).toEqual([
      expect.objectContaining({
        name: 'Home',
        urls: ['http://192.168.1.11:5033'],
        username: 'mobile',
        allowInsecureTls: true,
      }),
    ]);
    expect(config).not.toHaveProperty('activeLanServerId');
    expect(mockSetSecret).toHaveBeenCalledWith(config.lanServers[0].id, 'shared-password');
    expect(mockClearLegacyLanConfiguration).toHaveBeenCalledTimes(1);
  });

  it('keeps a P2P-era user on P2P while recovering a leftover iOS LAN profile', async () => {
    mockGetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG) {
        return Promise.resolve(JSON.stringify({ ...DEFAULT_SETTINGS, syncChannel: 'p2p' }));
      }
      if (key === SETTINGS_SCHEMA_VERSION_KEY) {
        return Promise.resolve(String(SETTINGS_SCHEMA_VERSION));
      }
      return Promise.resolve(null);
    });
    mockGetLegacyLanConfiguration.mockResolvedValue({
      servers: [
        {
          id: 'old-home',
          name: 'Old Home',
          urls: ['http://192.168.1.12:5033'],
          username: 'mobile',
          password: 'shared-password',
        },
      ],
      activeServerIndex: 0,
      trustInsecureCert: false,
    });

    await storage.initialize();

    const config = await storage.getConfig();
    expect(config.syncChannel).toBe('p2p');
    expect(config.lanServers).toHaveLength(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      STORAGE_KEYS.CONFIG,
      expect.stringContaining('Old Home')
    );
  });

  it('persists welcome completion across launches without changing synchronization', async () => {
    const values = new Map<string, string>();
    mockGetItem.mockImplementation(async (key) => values.get(key) ?? null);
    mockSetItem.mockImplementation(async (key, value) => {
      values.set(key, value);
    });
    await storage.initialize();
    await expect(storage.getConfig()).resolves.toMatchObject({ welcomeCompleted: false });
    await storage.updateConfig({ welcomeCompleted: true });
    (storage as unknown as ConfigStoragePrivate).initialized = false;
    (storage as unknown as ConfigStoragePrivate).config = null;
    await expect(storage.getConfig()).resolves.toMatchObject({
      welcomeCompleted: true,
      syncChannel: 'lan',
      lanServers: [],
    });
  });

  it('marks explicit updates and returns defensive copies', async () => {
    mockGetItem.mockImplementation((key) =>
      Promise.resolve(key === STORAGE_KEYS.CONFIG ? JSON.stringify(DEFAULT_SETTINGS) : null)
    );

    await storage.updateConfig({ autoApplyRemote: false });
    const first = await storage.getConfig();
    first.autoApplyRemote = true;

    await expect(storage.getConfig()).resolves.toMatchObject({ autoApplyRemote: false });
    expect(mockSetItem).toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
  });
});
