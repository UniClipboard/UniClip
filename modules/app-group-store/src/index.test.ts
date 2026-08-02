/// <reference types="jest" />

beforeEach(() => {
  jest.resetModules();
  jest.unmock('app-group-store');
  jest.unmock('./index');
  jest.clearAllMocks();
});

describe('app-group-store JS wrapper', () => {
  it('serializes current settings and exposes P2P handoff data', async () => {
    const settings = {
      autoApplyRemoteChanges: false,
      autoPushDeviceChanges: true,
      language: 'ru',
    };
    const mockNativeModule = {
      saveSettings: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockResolvedValue(JSON.stringify(settings)),
      clearLegacyLanConfiguration: jest.fn().mockResolvedValue(undefined),
      getShareDiagnostics: jest.fn().mockResolvedValue(
        JSON.stringify({
          schemaVersion: 1,
          attempts: [{ id: 'attempt-a', itemKind: 'file', byteCount: 42, events: [] }],
        })
      ),
      claimOutboundShareJobs: jest.fn().mockResolvedValue([
        {
          id: 'job-1',
          fileUri: 'file:///group/outbound-handoff/files/job-1.payload',
          displayName: 'archive.zip',
          byteCount: 42,
          mimeType: 'application/zip',
          targetDeviceIds: ['desktop-1'],
          createdAtMs: 1,
        },
      ]),
      completeOutboundShareJob: jest.fn().mockResolvedValue(undefined),
      releaseOutboundShareJob: jest.fn().mockResolvedValue(undefined),
    };
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => mockNativeModule),
    }));

    const store = require('./index');

    await store.saveSettings(settings);
    await store.clearLegacyLanConfiguration();
    await store.completeOutboundShareJob('job-1');
    await store.releaseOutboundShareJob('job-2');

    expect(mockNativeModule.saveSettings).toHaveBeenCalledWith(JSON.stringify(settings));
    await expect(store.getSettings()).resolves.toEqual(settings);
    await expect(store.getShareDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      attempts: [{ id: 'attempt-a', itemKind: 'file', byteCount: 42, events: [] }],
    });
    await expect(store.claimOutboundShareJobs()).resolves.toEqual([
      expect.objectContaining({ id: 'job-1', targetDeviceIds: ['desktop-1'] }),
    ]);
    expect(mockNativeModule.clearLegacyLanConfiguration).toHaveBeenCalledTimes(1);
  });

  it('passes payload operations through to the native module', async () => {
    const mockNativeModule = {
      getContainerUrl: jest.fn().mockResolvedValue('file:///group'),
      getLegacyHistory: jest.fn().mockResolvedValue('[{"entry":{"type":"Text"}}]'),
      getPayloadFileUri: jest.fn().mockResolvedValue('file:///group/payloads/Image-ABC'),
      writePayload: jest.fn().mockResolvedValue('file:///group/payloads/Image-ABC'),
      deletePayload: jest.fn().mockResolvedValue(undefined),
      clearPayloads: jest.fn().mockResolvedValue(undefined),
      getPayloadStats: jest.fn().mockResolvedValue({ count: 1, totalSize: 42 }),
      importPayloadFile: jest.fn().mockResolvedValue('file:///group/payloads/File-HASH'),
      migrateLegacyContainer: jest.fn().mockResolvedValue({ migrated: true, keys: 2 }),
    };
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => mockNativeModule),
    }));

    const store = require('./index');
    const bytes = new Uint8Array([1, 2, 3]);

    await store.writePayload('Image-ABC', bytes);
    await store.deletePayload('Image-ABC');
    await store.clearPayloads();

    expect(mockNativeModule.writePayload).toHaveBeenCalledWith('Image-ABC', bytes);
    await expect(store.getContainerUrl()).resolves.toBe('file:///group');
    await expect(store.getLegacyHistory()).resolves.toContain('Text');
    await expect(store.getPayloadFileUri('Image-ABC')).resolves.toContain('Image-ABC');
    await expect(store.getPayloadStats()).resolves.toEqual({ count: 1, totalSize: 42 });
    await expect(store.importPayloadFile('File-HASH', 'file:///source')).resolves.toContain(
      'File-HASH'
    );
    await expect(store.migrateLegacyContainer()).resolves.toEqual({ migrated: true, keys: 2 });
  });

  it('falls back safely when the native module is unavailable', async () => {
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => null),
    }));

    const store = require('./index');

    await expect(store.saveSettings({})).resolves.toBeUndefined();
    await expect(store.clearLegacyLanConfiguration()).resolves.toBeUndefined();
    await expect(store.getSettings()).resolves.toEqual({});
    await expect(store.getContainerUrl()).resolves.toBeNull();
    await expect(store.getLegacyHistory()).resolves.toBeNull();
    await expect(store.getShareDiagnostics()).resolves.toBeNull();
    await expect(store.getPayloadStats()).resolves.toEqual({ count: 0, totalSize: 0 });
    await expect(store.claimOutboundShareJobs()).resolves.toEqual([]);
    await expect(store.migrateLegacyContainer()).resolves.toEqual({ migrated: false, keys: 0 });
  });

  it('tolerates an older native module without LAN cleanup support', async () => {
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => ({})),
    }));

    const store = require('./index');

    await expect(store.clearLegacyLanConfiguration()).resolves.toBeUndefined();
  });
});
