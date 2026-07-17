/// <reference types="jest" />
/// <reference types="node" />

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
      getContainerUrl: jest.fn(),
      getLegacyHistory: jest.fn(),
      getPayloadFileUri: jest.fn(),
      writePayload: jest.fn(),
      deletePayload: jest.fn(),
      clearPayloads: jest.fn(),
      getPayloadStats: jest.fn(),
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
      getContainerUrl,
      getLegacyHistory,
      getPayloadFileUri,
      getPayloadStats,
      migrateLegacyContainer,
      getLiveUrl,
      getLastSyncedContentId,
      clearPayloads,
      deletePayload,
      saveServers,
      saveSettings,
      saveLiveUrl,
      writePayload,
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
      language: 'ru',
    };

    mockNativeModule.getServers.mockResolvedValue(JSON.stringify(servers));
    mockNativeModule.getSettings.mockResolvedValue(JSON.stringify(settings));
    mockNativeModule.getContainerUrl.mockResolvedValue('file:///group');
    mockNativeModule.getLegacyHistory.mockResolvedValue('[{"entry":{"type":"Text"}}]');
    mockNativeModule.getPayloadFileUri.mockResolvedValue('file:///group/payloads/Image-ABC');
    mockNativeModule.writePayload.mockResolvedValue('file:///group/payloads/Image-ABC');
    mockNativeModule.getPayloadStats.mockResolvedValue({ count: 1, totalSize: 42 });
    mockNativeModule.getLiveUrl.mockResolvedValue('https://example.com');
    mockNativeModule.getLastSyncedContentId.mockResolvedValue('blake3v1:abc');
    mockNativeModule.migrateLegacyContainer.mockResolvedValue({ migrated: true, keys: 2 });

    await saveServers(servers);
    await saveSettings(settings);
    await saveLiveUrl('https://example.com', 'https://lan.example.com');
    const bytes = new Uint8Array([1, 2, 3]);
    await writePayload('Image-ABC', bytes);
    await deletePayload('Image-ABC');
    await clearPayloads();

    expect(mockNativeModule.saveServers).toHaveBeenCalledWith(JSON.stringify(servers));
    expect(mockNativeModule.saveSettings).toHaveBeenCalledWith(JSON.stringify(settings));
    expect(mockNativeModule.saveLiveUrl).toHaveBeenCalledWith(
      'https://example.com',
      'https://lan.example.com'
    );
    expect(mockNativeModule.writePayload).toHaveBeenCalledWith('Image-ABC', bytes);
    expect(mockNativeModule.deletePayload).toHaveBeenCalledWith('Image-ABC');
    expect(mockNativeModule.clearPayloads).toHaveBeenCalled();
    await expect(getServers()).resolves.toEqual(servers);
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(getContainerUrl()).resolves.toBe('file:///group');
    await expect(getLegacyHistory()).resolves.toBe('[{"entry":{"type":"Text"}}]');
    await expect(getPayloadFileUri('Image-ABC')).resolves.toBe('file:///group/payloads/Image-ABC');
    await expect(getPayloadStats()).resolves.toEqual({ count: 1, totalSize: 42 });
    await expect(getLiveUrl('https://example.com')).resolves.toBe('https://example.com');
    await expect(getLastSyncedContentId()).resolves.toBe('blake3v1:abc');
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: true, keys: 2 });

    mockNativeModule.getServers.mockResolvedValue('{broken');
    mockNativeModule.getSettings.mockResolvedValue('{broken');
    await expect(getServers()).resolves.toEqual({ configs: [], activeConfigId: null });
    await expect(getSettings()).resolves.toEqual({});
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
      getContainerUrl,
      getLegacyHistory,
      getPayloadFileUri,
      getPayloadStats,
      migrateLegacyContainer,
      clearPayloads,
      deletePayload,
      saveLiveUrl,
      saveServers,
      saveSettings,
      writePayload,
    } = require('./index');

    await expect(saveServers({ configs: [], activeConfigId: null })).resolves.toBeUndefined();
    await expect(saveSettings({})).resolves.toBeUndefined();
    await expect(writePayload('Image-ABC', new Uint8Array([1]))).resolves.toBeNull();
    await expect(deletePayload('Image-ABC')).resolves.toBeUndefined();
    await expect(clearPayloads()).resolves.toBeUndefined();
    await expect(saveLiveUrl('server', 'https://example.com')).resolves.toBeUndefined();
    await expect(getServers()).resolves.toEqual({ configs: [], activeConfigId: null });
    await expect(getSettings()).resolves.toEqual({});
    await expect(getContainerUrl()).resolves.toBeNull();
    await expect(getLegacyHistory()).resolves.toBeNull();
    await expect(getPayloadFileUri('Image-ABC')).resolves.toBeNull();
    await expect(getPayloadStats()).resolves.toEqual({ count: 0, totalSize: 0 });
    await expect(getLastSyncedHash()).resolves.toBeNull();
    await expect(getLastSyncedContentId()).resolves.toBeNull();
    await expect(getLiveUrl('server')).resolves.toBeNull();
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: false, keys: 0 });
  });
});
