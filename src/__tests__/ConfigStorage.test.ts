import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettings } from 'app-group-store';
import { CONFIG_USER_STATE_KEY, ConfigStorage } from '../services/ConfigStorage';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings } from '../types/settings';
import { STORAGE_KEYS } from '../types/storage';

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
  const mockGetSettings = jest.mocked(getSettings);

  beforeEach(() => {
    jest.clearAllMocks();
    (storage as unknown as ConfigStoragePrivate).initialized = false;
    (storage as unknown as ConfigStoragePrivate).config = null;
    mockSetItem.mockResolvedValue(undefined);
    mockGetSettings.mockResolvedValue({});
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([]);
    (AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined);
  });

  it('drops legacy connection credentials while preserving user preferences', async () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      language: 'ru',
      syncChannel: 'lan',
      servers: [
        {
          type: 'syncclipboard',
          url: 'http://home.test',
          username: 'alice',
          password: 'secret',
        },
      ],
    };
    mockGetItem.mockImplementation((key) =>
      Promise.resolve(key === STORAGE_KEYS.CONFIG ? JSON.stringify(legacy) : '7')
    );

    await storage.initialize();

    const config = await storage.getConfig();
    expect(config.language).toBe('ru');
    expect(config.legacyPairingGuide).toBe('pending');
    expect(config).not.toHaveProperty('syncChannel');
    expect(config).not.toHaveProperty('servers');
    expect(mockSetItem).toHaveBeenCalledWith(
      '@syncclipboard:schema_version',
      String(SETTINGS_SCHEMA_VERSION)
    );
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

  it('marks explicit updates and returns defensive copies', async () => {
    mockGetItem.mockImplementation((key) =>
      Promise.resolve(
        key === STORAGE_KEYS.CONFIG
          ? JSON.stringify(DEFAULT_SETTINGS)
          : String(SETTINGS_SCHEMA_VERSION)
      )
    );

    await storage.updateConfig({ autoApplyRemote: false });
    const first = await storage.getConfig();
    first.autoApplyRemote = true;

    await expect(storage.getConfig()).resolves.toMatchObject({ autoApplyRemote: false });
    expect(mockSetItem).toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
  });
});
