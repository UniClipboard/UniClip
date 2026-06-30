beforeEach(() => {
  jest.resetModules();
  jest.unmock('app-group-store');
  jest.unmock('./index');
  jest.clearAllMocks();
});

describe('app-group-store JS wrapper', () => {
  it('stringifies write payloads and parses read payloads', async () => {
    const mockNativeModule = {
      saveServers: jest.fn(),
      getServers: jest.fn(),
      saveSettings: jest.fn(),
      getSettings: jest.fn(),
      getLastSyncedHash: jest.fn(),
      getLastSyncedContentId: jest.fn(),
      getLiveUrl: jest.fn(),
      saveLiveUrl: jest.fn(),
      migrateLegacyContainer: jest.fn(),
    };
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => mockNativeModule),
    }));

    const {
      getServers,
      getSettings,
      migrateLegacyContainer,
      getLiveUrl,
      getLastSyncedContentId,
      saveServers,
      saveSettings,
      saveLiveUrl,
    } = require('./index');

    const servers = {
      configs: [
        {
          id: 'https://example.com',
          urls: ['https://example.com'],
          username: 'alice',
          password: 'secret',
        },
      ],
      activeConfigId: 'https://example.com',
    };
    const settings = {
      trustInsecureCert: true,
      autoApplyServerChanges: false,
      autoPushDeviceChanges: true,
    };

    mockNativeModule.getServers.mockResolvedValue(JSON.stringify(servers));
    mockNativeModule.getSettings.mockResolvedValue(JSON.stringify(settings));
    mockNativeModule.getLiveUrl.mockResolvedValue('https://example.com');
    mockNativeModule.getLastSyncedContentId.mockResolvedValue('blake3v1:abc');
    mockNativeModule.migrateLegacyContainer.mockResolvedValue({ migrated: true, keys: 2 });

    await saveServers(servers);
    await saveSettings(settings);
    await saveLiveUrl('https://example.com', 'https://lan.example.com');

    expect(mockNativeModule.saveServers).toHaveBeenCalledWith(JSON.stringify(servers));
    expect(mockNativeModule.saveSettings).toHaveBeenCalledWith(JSON.stringify(settings));
    expect(mockNativeModule.saveLiveUrl).toHaveBeenCalledWith(
      'https://example.com',
      'https://lan.example.com'
    );
    await expect(getServers()).resolves.toEqual(servers);
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(getLiveUrl('https://example.com')).resolves.toBe('https://example.com');
    await expect(getLastSyncedContentId()).resolves.toBe('blake3v1:abc');
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: true, keys: 2 });
  });

  it('falls back safely when the native module is not linked', async () => {
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => null),
    }));

    const {
      getLastSyncedHash,
      getLastSyncedContentId,
      getLiveUrl,
      getServers,
      getSettings,
      migrateLegacyContainer,
      saveLiveUrl,
      saveServers,
      saveSettings,
    } = require('./index');

    await expect(saveServers({ configs: [], activeConfigId: null })).resolves.toBeUndefined();
    await expect(saveSettings({})).resolves.toBeUndefined();
    await expect(saveLiveUrl('server', 'https://example.com')).resolves.toBeUndefined();
    await expect(getServers()).resolves.toEqual({ configs: [], activeConfigId: null });
    await expect(getSettings()).resolves.toEqual({});
    await expect(getLastSyncedHash()).resolves.toBeNull();
    await expect(getLastSyncedContentId()).resolves.toBeNull();
    await expect(getLiveUrl('server')).resolves.toBeNull();
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: false, keys: 0 });
  });
});
