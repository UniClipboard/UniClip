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
});
