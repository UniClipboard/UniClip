import { saveSettings } from 'app-group-store';
import { DEFAULT_SETTINGS } from '../types/settings';
import {
  mapSettingsToAppGroupDTO,
  seedConfigFromAppGroup,
  syncConfigToAppGroup,
} from '../platform/app-group';

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

  it('publishes settings without retaining old connection cleanup', async () => {
    await syncConfigToAppGroup({ ...DEFAULT_SETTINGS });

    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('reads only the current remote-content key', async () => {
    const store = require('app-group-store');
    (store.getSettings as jest.Mock).mockResolvedValueOnce({ autoApplyRemoteChanges: false });
    await expect(seedConfigFromAppGroup()).resolves.toMatchObject({ autoApplyRemote: false });
  });
});
