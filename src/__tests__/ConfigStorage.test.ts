import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettings } from 'app-group-store';
import { CONFIG_USER_STATE_KEY, ConfigStorage } from '../features/settings';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings } from '../types/settings';
import { STORAGE_KEYS } from '../types/storage';

const SETTINGS_SCHEMA_VERSION_KEY = '@syncclipboard:schema_version';

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

  it('marks a configured v1 LAN install for the one-time re-pairing guide', async () => {
    const legacyConfig = {
      servers: [{ name: 'Home', url: 'http://192.168.1.8:5033' }],
      activeServerIndex: 0,
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

    await expect(storage.getConfig()).resolves.toEqual(
      expect.objectContaining({
        autoApplyRemote: false,
        language: 'zh-CN',
        legacyPairingGuide: 'pending',
      })
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

    await expect(storage.getConfig()).resolves.toEqual(
      expect.objectContaining({ legacyPairingGuide: 'none' })
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
      Promise.resolve(key === STORAGE_KEYS.CONFIG ? JSON.stringify(DEFAULT_SETTINGS) : null)
    );

    await storage.updateConfig({ autoApplyRemote: false });
    const first = await storage.getConfig();
    first.autoApplyRemote = true;

    await expect(storage.getConfig()).resolves.toMatchObject({ autoApplyRemote: false });
    expect(mockSetItem).toHaveBeenCalledWith(CONFIG_USER_STATE_KEY, '1');
  });
});
