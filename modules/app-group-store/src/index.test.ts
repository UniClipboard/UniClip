/// <reference types="jest" />
/// <reference types="node" />

beforeEach(() => {
  jest.resetModules();
  jest.unmock('app-group-store');
  jest.unmock('./index');
  jest.clearAllMocks();
});

describe('app-group-store JS wrapper', () => {
  it('parses the native Share diagnostics archive', async () => {
    const mockNativeModule = {
      getShareDiagnostics: jest.fn().mockResolvedValue(
        JSON.stringify({
          schemaVersion: 1,
          attempts: [{ id: 'attempt-a', channel: 'p2p', events: [] }],
        })
      ),
    };
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => mockNativeModule),
    }));

    const { getShareDiagnostics } = require('./index');

    await expect(getShareDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      attempts: [{ id: 'attempt-a', channel: 'p2p', events: [] }],
    });
  });

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
      claimOutboundShareJobs: jest.fn(),
      completeOutboundShareJob: jest.fn(),
      releaseOutboundShareJob: jest.fn(),
      importPayloadFile: jest.fn(),
      sendOutboundLanFile: jest.fn(),
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
      claimOutboundShareJobs,
      completeOutboundShareJob,
      releaseOutboundShareJob,
      importPayloadFile,
      sendOutboundLanFile,
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
    mockNativeModule.claimOutboundShareJobs.mockResolvedValue([
      {
        id: 'job-1',
        fileUri: 'file:///group/outbound-handoff/files/job-1.payload',
        displayName: 'archive.zip',
        byteCount: 104857601,
        mimeType: 'application/zip',
        channel: 'p2p',
        serverId: null,
      },
    ]);
    mockNativeModule.importPayloadFile.mockResolvedValue('file:///group/payloads/File-HASH');
    mockNativeModule.sendOutboundLanFile.mockResolvedValue(undefined);

    await saveServers(servers);
    await saveSettings(settings);
    await saveLiveUrl('https://example.com', 'https://lan.example.com');
    const bytes = new Uint8Array([1, 2, 3]);
    await writePayload('Image-ABC', bytes);
    await deletePayload('Image-ABC');
    await clearPayloads();
    await completeOutboundShareJob('job-1');
    await releaseOutboundShareJob('job-2');
    await sendOutboundLanFile(
      'file:///group/payloads/File-HASH',
      'archive.zip',
      'HASH',
      104857601,
      'server-a'
    );

    expect(mockNativeModule.saveServers).toHaveBeenCalledWith(JSON.stringify(servers));
    expect(mockNativeModule.saveSettings).toHaveBeenCalledWith(JSON.stringify(settings));
    expect(mockNativeModule.saveLiveUrl).toHaveBeenCalledWith(
      'https://example.com',
      'https://lan.example.com'
    );
    expect(mockNativeModule.writePayload).toHaveBeenCalledWith('Image-ABC', bytes);
    expect(mockNativeModule.deletePayload).toHaveBeenCalledWith('Image-ABC');
    expect(mockNativeModule.clearPayloads).toHaveBeenCalled();
    expect(mockNativeModule.completeOutboundShareJob).toHaveBeenCalledWith('job-1');
    expect(mockNativeModule.releaseOutboundShareJob).toHaveBeenCalledWith('job-2');
    expect(mockNativeModule.sendOutboundLanFile).toHaveBeenCalledWith(
      'file:///group/payloads/File-HASH',
      'archive.zip',
      'HASH',
      104857601,
      'server-a'
    );
    await expect(getServers()).resolves.toEqual(servers);
    await expect(getSettings()).resolves.toEqual(settings);
    await expect(getContainerUrl()).resolves.toBe('file:///group');
    await expect(getLegacyHistory()).resolves.toBe('[{"entry":{"type":"Text"}}]');
    await expect(getPayloadFileUri('Image-ABC')).resolves.toBe('file:///group/payloads/Image-ABC');
    await expect(getPayloadStats()).resolves.toEqual({ count: 1, totalSize: 42 });
    await expect(getLiveUrl('https://example.com')).resolves.toBe('https://example.com');
    await expect(getLastSyncedContentId()).resolves.toBe('blake3v1:abc');
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: true, keys: 2 });
    await expect(claimOutboundShareJobs()).resolves.toEqual([
      expect.objectContaining({ id: 'job-1', channel: 'p2p', byteCount: 104857601 }),
    ]);
    await expect(importPayloadFile('File-HASH', 'file:///group/source')).resolves.toBe(
      'file:///group/payloads/File-HASH'
    );

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
      getShareDiagnostics,
      getPayloadFileUri,
      getPayloadStats,
      migrateLegacyContainer,
      claimOutboundShareJobs,
      completeOutboundShareJob,
      releaseOutboundShareJob,
      importPayloadFile,
      sendOutboundLanFile,
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
    await expect(getShareDiagnostics()).resolves.toBeNull();
    await expect(getPayloadFileUri('Image-ABC')).resolves.toBeNull();
    await expect(getPayloadStats()).resolves.toEqual({ count: 0, totalSize: 0 });
    await expect(getLastSyncedHash()).resolves.toBeNull();
    await expect(getLastSyncedContentId()).resolves.toBeNull();
    await expect(getLiveUrl('server')).resolves.toBeNull();
    await expect(migrateLegacyContainer()).resolves.toEqual({ migrated: false, keys: 0 });
    await expect(claimOutboundShareJobs()).resolves.toEqual([]);
    await expect(completeOutboundShareJob('job-1')).resolves.toBeUndefined();
    await expect(releaseOutboundShareJob('job-1')).resolves.toBeUndefined();
    await expect(importPayloadFile('File-HASH', 'file:///source')).resolves.toBeNull();
    await expect(sendOutboundLanFile('file:///source', 'a.bin', 'HASH', 1, null)).rejects.toThrow(
      'App Group store is unavailable'
    );
  });
});
