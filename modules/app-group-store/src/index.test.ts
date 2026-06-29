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
      migrateLegacyContainer: jest.fn(),
    };
    jest.doMock('expo-modules-core', () => ({
      requireNativeModule: jest.fn(() => mockNativeModule),
    }));

    const {
      getServers,
      getSettings,
      migrateLegacyContainer,
      saveServers,
      saveSettings,
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
    mockNativeModule.migrateLegacyContainer.mockResolvedValue({ migrated: true, keys: 2 });

    await saveServers(servers);
    await saveSettings(settings);

    expect(mockNativeModule.saveServers).toHaveBeenCalledWith(JSON.stringify(servers));
    expect(mockNativeModule.saveSettings).toHaveBeenCalledWith(JSON.stringify(settings));
    await expect(getServers()).resolves.toEqual(servers);
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: true, keys: 2 });
  });
});
