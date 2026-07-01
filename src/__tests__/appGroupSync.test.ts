import { DEFAULT_SETTINGS } from '../types/settings';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mapSettingsToAppGroupDTO,
  mapServersToAppGroupDTO,
  syncConfigToAppGroup,
} from '../services/appGroupSyncCore';

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
  saveServers: jest.fn().mockResolvedValue(undefined),
  getServers: jest.fn().mockResolvedValue({ configs: [], activeConfigId: null }),
  saveSettings: jest.fn().mockResolvedValue(undefined),
}));

import { getServers, saveServers, saveSettings } from 'app-group-store';

const CONFIG_USER_STATE_KEY = '@syncclipboard:config:user-state';

describe('App Group sync mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServers as jest.Mock).mockResolvedValue({ configs: [], activeConfigId: null });
    (saveServers as jest.Mock).mockResolvedValue(undefined);
    (saveSettings as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  describe('mapServersToAppGroupDTO', () => {
    it('keeps only SyncClipboard servers and derives ids from normalized canonical urls', () => {
      const result = mapServersToAppGroupDTO(
        [
          {
            type: 'syncclipboard',
            name: 'Primary',
            url: ' HTTPS://EXAMPLE.COM:8443/base/// ',
            urls: [' HTTPS://EXAMPLE.COM:8443/base/// ', '', 'http://lan.local/'],
            username: 'alice',
            password: 'secret',
          },
          {
            type: 'webdav',
            name: 'Documents',
            url: 'https://webdav.example.com',
          },
          {
            type: 's3',
            name: 'Bucket',
            url: 'https://s3.example.com',
          },
        ],
        0
      );

      expect(result).toEqual({
        configs: [
          {
            id: 'https://example.com:8443/base',
            name: 'Primary',
            urls: ['https://example.com:8443/base', 'http://lan.local'],
            username: 'alice',
            password: 'secret',
          },
        ],
        activeConfigId: 'https://example.com:8443/base',
      });
    });

    it('falls back from urls to url, drops empties, and coerces absent credentials to empty strings', () => {
      const result = mapServersToAppGroupDTO(
        [
          {
            type: 'syncclipboard',
            url: 'http://server.local///',
          },
        ],
        0
      );

      expect(result).toEqual({
        configs: [
          {
            id: 'http://server.local',
            urls: ['http://server.local'],
            username: '',
            password: '',
          },
        ],
        activeConfigId: 'http://server.local',
      });
    });

    it('maps the RN active server index to the filtered active config id', () => {
      const result = mapServersToAppGroupDTO(
        [
          { type: 'webdav', url: 'https://webdav.example.com' },
          { type: 'syncclipboard', url: 'https://one.example.com' },
          { type: 'syncclipboard', url: 'https://two.example.com/' },
        ],
        2
      );

      expect(result.activeConfigId).toBe('https://two.example.com');
    });

    it('keeps duplicate server URLs addressable with unique ids', () => {
      const result = mapServersToAppGroupDTO(
        [
          { type: 'syncclipboard', name: '000', url: 'http://same.example.com' },
          { type: 'syncclipboard', name: '999', url: 'http://same.example.com' },
        ],
        1
      );

      expect(result.configs).toEqual([
        expect.objectContaining({
          id: 'http://same.example.com',
          name: '000',
        }),
        expect.objectContaining({
          id: 'http://same.example.com#2',
          name: '999',
        }),
      ]);
      expect(result.activeConfigId).toBe('http://same.example.com#2');
    });

    it('uses null active config id when the active server is not exportable', () => {
      const result = mapServersToAppGroupDTO(
        [
          { type: 'webdav', url: 'https://webdav.example.com' },
          { type: 'syncclipboard', url: 'https://one.example.com' },
        ],
        0
      );

      expect(result.configs).toHaveLength(1);
      expect(result.activeConfigId).toBeNull();
    });
  });

  describe('mapSettingsToAppGroupDTO', () => {
    it('renames sync settings and maps attachment prefetch settings', () => {
      expect(
        mapSettingsToAppGroupDTO({
          ...DEFAULT_SETTINGS,
          autoApplyRemote: false,
          autoPushLocal: true,
          attachmentAutoDownload: 'off',
        })
      ).toEqual(
        expect.objectContaining({
          autoApplyServerChanges: false,
          autoPushDeviceChanges: true,
          prefetchAttachments: false,
          prefetchOnCellular: false,
        })
      );

      expect(
        mapSettingsToAppGroupDTO({
          ...DEFAULT_SETTINGS,
          attachmentAutoDownload: 'wifi',
        })
      ).toEqual(expect.objectContaining({ prefetchAttachments: true, prefetchOnCellular: false }));

      expect(
        mapSettingsToAppGroupDTO({
          ...DEFAULT_SETTINGS,
          attachmentAutoDownload: 'always',
        })
      ).toEqual(expect.objectContaining({ prefetchAttachments: true, prefetchOnCellular: true }));
    });

    it('passes through shared app settings used by the extensions', () => {
      const result = mapSettingsToAppGroupDTO({
        ...DEFAULT_SETTINGS,
        trustInsecureCert: true,
        payloadCacheMaxBytes: 12345,
        appearance: 'dark',
        autoCheckUpdate: false,
        ignoredVersion: '2.0.0',
        downloadRelativePath: 'UniClip',
        logLevel: 'debug',
      });

      expect(result).toEqual({
        trustInsecureCert: true,
        autoApplyServerChanges: DEFAULT_SETTINGS.autoApplyRemote,
        autoPushDeviceChanges: DEFAULT_SETTINGS.autoPushLocal,
        prefetchAttachments: true,
        prefetchOnCellular: false,
        payloadCacheMaxBytes: 12345,
        appearance: 'dark',
        autoCheckUpdate: false,
        ignoredVersion: '2.0.0',
        downloadRelativePath: 'UniClip',
        logViewLevelFilter: 'debug',
      });
      expect(result).not.toHaveProperty('logLevel');
    });
  });

  describe('syncConfigToAppGroup', () => {
    it('does not overwrite existing App Group servers with untouched first-launch defaults', async () => {
      (getServers as jest.Mock).mockResolvedValue({
        configs: [
          {
            id: 'primary',
            urls: ['https://server.example.com'],
            username: 'alice',
            password: 'secret',
          },
        ],
        activeConfigId: 'primary',
      });

      await syncConfigToAppGroup({ ...DEFAULT_SETTINGS });

      expect(saveServers).not.toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalled();
    });

    it('allows a real local config to delete the last App Group server', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
        Promise.resolve(key === CONFIG_USER_STATE_KEY ? '1' : null)
      );
      (getServers as jest.Mock).mockResolvedValue({
        configs: [
          {
            id: 'primary',
            urls: ['https://server.example.com'],
            username: 'alice',
            password: 'secret',
          },
        ],
        activeConfigId: 'primary',
      });

      await syncConfigToAppGroup({ ...DEFAULT_SETTINGS });

      expect(saveServers).toHaveBeenCalledWith({ configs: [], activeConfigId: null });
      expect(saveSettings).toHaveBeenCalled();
    });
  });
});
