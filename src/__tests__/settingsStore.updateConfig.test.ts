import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configStorage, ConfigStorage } from '../services/ConfigStorage';
import { syncConfigToAppGroup } from '../services/appGroupSyncCore';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../types/settings';
import { STORAGE_KEYS } from '../types/storage';

jest.mock('../services/appGroupSyncCore', () => ({
  syncConfigToAppGroup: jest.fn(async () => undefined),
}));

const mockGetItem = jest.mocked(AsyncStorage.getItem);
const mockSetItem = jest.mocked(AsyncStorage.setItem);
const mockSyncConfigToAppGroup = jest.mocked(syncConfigToAppGroup);

describe('settingsStore.updateConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify(DEFAULT_SETTINGS));
    mockSetItem.mockResolvedValue(undefined);
    mockSyncConfigToAppGroup.mockResolvedValue(undefined);

    const storage = ConfigStorage.getInstance() as unknown as {
      initialized: boolean;
      config: unknown;
    };
    storage.initialized = false;
    storage.config = null;

    useSettingsStore.setState({
      config: { ...DEFAULT_SETTINGS },
      isLoaded: true,
      isSaving: false,
      error: null,
    });
  });

  it('serializes concurrent updates without dropping either field', async () => {
    await configStorage.getConfig();
    let finishFirstConfigWrite: (() => void) | undefined;
    let markFirstConfigWriteStarted: (() => void) | undefined;
    const firstConfigWriteStarted = new Promise<void>((resolve) => {
      markFirstConfigWriteStarted = resolve;
    });
    let configWriteCount = 0;
    mockSetItem.mockImplementation((key) => {
      if (key === STORAGE_KEYS.CONFIG && configWriteCount++ === 0) {
        return new Promise<void>((resolve) => {
          finishFirstConfigWrite = resolve;
          markFirstConfigWriteStarted?.();
        });
      }
      return Promise.resolve();
    });

    const firstUpdate = useSettingsStore.getState().updateConfig({ autoApplyRemote: false });
    await firstConfigWriteStarted;
    const secondUpdate = useSettingsStore.getState().updateConfig({ autoPushLocal: false });

    finishFirstConfigWrite?.();
    await Promise.all([firstUpdate, secondUpdate]);

    await expect(configStorage.getConfig()).resolves.toEqual(
      expect.objectContaining({ autoApplyRemote: false, autoPushLocal: false })
    );
    expect(useSettingsStore.getState().config).toEqual(
      expect.objectContaining({ autoApplyRemote: false, autoPushLocal: false })
    );
  });

  it('serializes publishing and final store commits', async () => {
    await configStorage.getConfig();
    let finishFirstPublish: (() => void) | undefined;
    let markFirstPublishStarted: (() => void) | undefined;
    const firstPublishStarted = new Promise<void>((resolve) => {
      markFirstPublishStarted = resolve;
    });
    mockSyncConfigToAppGroup.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirstPublish = resolve;
          markFirstPublishStarted?.();
        })
    );

    const firstUpdate = useSettingsStore.getState().updateConfig({ autoApplyRemote: false });
    await firstPublishStarted;
    const secondUpdate = useSettingsStore.getState().updateConfig({ autoPushLocal: false });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockSyncConfigToAppGroup).toHaveBeenCalledTimes(1);
    finishFirstPublish?.();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(mockSyncConfigToAppGroup).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().config).toEqual(
      expect.objectContaining({ autoApplyRemote: false, autoPushLocal: false })
    );
  });

  it('returns a failure result and rolls back both store and storage state', async () => {
    await configStorage.getConfig();
    mockSetItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));

    const result = await useSettingsStore.getState().updateConfig({ autoApplyRemote: false });

    expect(result).toEqual({ ok: false, error: 'disk full' });
    expect(useSettingsStore.getState()).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ autoApplyRemote: true }),
        error: 'disk full',
        isSaving: false,
      })
    );
    await expect(configStorage.getConfig()).resolves.toEqual(
      expect.objectContaining({ autoApplyRemote: true })
    );
  });

  it('persists the explicitly selected sync channel', async () => {
    const eligibleConfig = {
      ...DEFAULT_SETTINGS,
      legacyLanEligible: true,
      servers: [{ type: 'syncclipboard' as const, name: 'Home', url: 'http://home.test' }],
      activeServerIndex: 0,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(eligibleConfig));
    useSettingsStore.setState({ config: eligibleConfig });
    await configStorage.getConfig();

    const result = await useSettingsStore.getState().setSyncChannel('lan');

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().config?.syncChannel).toBe('lan');
    await expect(configStorage.getConfig()).resolves.toEqual(
      expect.objectContaining({ syncChannel: 'lan', activeServerIndex: 0 })
    );
  });

  it('atomically selects an eligible LAN connection', async () => {
    const servers = [
      { type: 'syncclipboard' as const, name: 'Home', url: 'http://home.test' },
      { type: 'syncclipboard' as const, name: 'Office', url: 'http://office.test' },
    ];
    const eligibleConfig = {
      ...DEFAULT_SETTINGS,
      legacyLanEligible: true,
      servers,
      activeServerIndex: 0,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(eligibleConfig));
    useSettingsStore.setState({ config: eligibleConfig });
    await configStorage.getConfig();
    mockSetItem.mockClear();

    const result = await useSettingsStore
      .getState()
      .selectSyncConnection({ kind: 'lan', serverIndex: 1 });

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().config).toEqual(
      expect.objectContaining({ syncChannel: 'lan', activeServerIndex: 1 })
    );
    const configWrites = mockSetItem.mock.calls.filter(([key]) => key === STORAGE_KEYS.CONFIG);
    expect(configWrites).toHaveLength(1);
    expect(JSON.parse(configWrites[0][1] as string)).toEqual(
      expect.objectContaining({ syncChannel: 'lan', activeServerIndex: 1 })
    );
  });

  it('selects P2P without deleting the remembered LAN connection', async () => {
    const eligibleConfig = {
      ...DEFAULT_SETTINGS,
      legacyLanEligible: true,
      servers: [{ type: 'syncclipboard' as const, name: 'Home', url: 'http://home.test' }],
      activeServerIndex: 0,
      syncChannel: 'lan' as const,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(eligibleConfig));
    useSettingsStore.setState({ config: eligibleConfig });
    await configStorage.getConfig();

    const result = await useSettingsStore.getState().selectSyncConnection({ kind: 'p2p' });

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().config).toEqual(
      expect.objectContaining({
        syncChannel: 'p2p',
        activeServerIndex: 0,
        servers: eligibleConfig.servers,
      })
    );
  });

  it('rejects LAN selection for an ineligible install', async () => {
    const newInstallConfig = {
      ...DEFAULT_SETTINGS,
      servers: [{ type: 'syncclipboard' as const, name: 'Imported', url: 'http://imported.test' }],
      activeServerIndex: 0,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(newInstallConfig));
    useSettingsStore.setState({ config: newInstallConfig });
    await configStorage.getConfig();
    mockSetItem.mockClear();

    const result = await useSettingsStore
      .getState()
      .selectSyncConnection({ kind: 'lan', serverIndex: 0 });

    expect(result).toEqual({ ok: false, error: 'Legacy LAN connections are unavailable' });
    expect(useSettingsStore.getState().config?.syncChannel).toBe('p2p');
    expect(mockSetItem.mock.calls.some(([key]) => key === STORAGE_KEYS.CONFIG)).toBe(false);
  });

  it('rejects a LAN selection with an unknown server index', async () => {
    const eligibleConfig = {
      ...DEFAULT_SETTINGS,
      legacyLanEligible: true,
      servers: [{ type: 'syncclipboard' as const, name: 'Home', url: 'http://home.test' }],
    };
    mockGetItem.mockResolvedValue(JSON.stringify(eligibleConfig));
    useSettingsStore.setState({ config: eligibleConfig });
    await configStorage.getConfig();

    const result = await useSettingsStore
      .getState()
      .selectSyncConnection({ kind: 'lan', serverIndex: 2 });

    expect(result).toEqual({ ok: false, error: 'Invalid LAN connection' });
  });

  it('rejects adding a LAN connection for an ineligible install', async () => {
    await configStorage.getConfig();
    mockSetItem.mockClear();

    const result = await useSettingsStore.getState().addServer({
      type: 'syncclipboard',
      name: 'Blocked',
      url: 'http://blocked.test',
    });

    expect(result).toEqual({ ok: false, error: 'Legacy LAN connections are unavailable' });
    expect(useSettingsStore.getState().config?.servers).toEqual([]);
    expect(mockSetItem.mock.calls.some(([key]) => key === STORAGE_KEYS.CONFIG)).toBe(false);
  });
});
