import { clearLegacyLanConfiguration, saveSettings } from 'app-group-store';
import { DEFAULT_SETTINGS } from '../types/settings';
import { mapSettingsToAppGroupDTO, syncConfigToAppGroup } from '../services/appGroupSyncCore';
import { seedConfigFromAppGroup } from '../services/appGroupSeed';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const next = Object.create(actual);
  Object.defineProperty(next, 'Platform', { value: { ...actual.Platform, OS: 'ios' } });
  return next;
});

describe('App Group settings sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes only current extension preferences', () => {
    expect(
      mapSettingsToAppGroupDTO({
        ...DEFAULT_SETTINGS,
        autoApplyRemote: false,
        autoPushLocal: true,
        attachmentAutoDownload: 'off',
        language: 'pt-BR',
      })
    ).toEqual(
      expect.objectContaining({
        autoApplyRemoteChanges: false,
        autoPushDeviceChanges: true,
        prefetchAttachments: false,
        prefetchOnCellular: false,
        language: 'pt-BR',
      })
    );
  });

  it('clears old connection data before publishing settings', async () => {
    await syncConfigToAppGroup({ ...DEFAULT_SETTINGS });

    expect(clearLegacyLanConfiguration).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect((clearLegacyLanConfiguration as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (saveSettings as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it('reads the new remote-content key and tolerates the old key during upgrade', async () => {
    const store = require('app-group-store');
    (store.getSettings as jest.Mock).mockResolvedValueOnce({ autoApplyRemoteChanges: false });
    await expect(seedConfigFromAppGroup()).resolves.toMatchObject({ autoApplyRemote: false });

    (store.getSettings as jest.Mock).mockResolvedValueOnce({ autoApplyServerChanges: false });
    await expect(seedConfigFromAppGroup()).resolves.toMatchObject({ autoApplyRemote: false });
  });
});
