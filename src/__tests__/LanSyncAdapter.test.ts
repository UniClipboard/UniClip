import { afterEach, describe, expect, it, jest } from '@jest/globals';

function loadAdapter():
  | (new (dependencies: unknown) => {
      start(context: unknown): Promise<void>;
      stop(): Promise<void>;
      refresh(policy: unknown): Promise<void>;
      handleAppStateChange(policy: unknown): void;
      synchronize(): Promise<void>;
      sendImportedText(text: string, profileHash: string, options?: unknown): Promise<unknown>;
      sendImportedAsset(asset: unknown, profileHash: string, options?: unknown): Promise<unknown>;
      observeClipboardChange(content: unknown, dispatch: boolean): Promise<unknown>;
      subscribe(listener: (event: unknown) => void): () => void;
    })
  | undefined {
  try {
    return require('../features/lan-sync/internal/lanSyncAdapter').LanSyncAdapter;
  } catch {
    return undefined;
  }
}

const profile = {
  name: 'Desk',
  urls: ['http://desk.local:42720'],
  username: 'mobile',
  password: 'secret',
  allowInsecureTls: false,
};

afterEach(() => {
  jest.useRealTimers();
});

describe('LanSyncAdapter', () => {
  it('starts idle without a server and activates when one is configured', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    let activeServer: typeof profile | null = null;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => activeServer,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await expect(
      adapter.start({
        appVersion: '2.0.0',
        profileId: 'default',
        policy: { appState: 'active', backgroundSyncEnabled: false },
      })
    ).resolves.toBeUndefined();
    expect(client.getClipboard).not.toHaveBeenCalled();

    activeServer = profile;
    await adapter.refresh({ appState: 'active', backgroundSyncEnabled: false });
    expect(client.getClipboard).toHaveBeenCalledWith(profile);
    await adapter.stop();
  });

  it('pulls and applies a new remote text during startup', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const applyRemoteContent = jest.fn(async () => undefined);
    const client = {
      getClipboard: jest.fn(async () => ({
        url: profile.urls[0],
        document: {
          type: 'Text',
          hash: 'REMOTE_HASH',
          contentId: 'blake3v1:remote',
          text: 'from desktop',
          hasData: false,
          size: 12,
        },
      })),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    expect(applyRemoteContent).toHaveBeenCalledWith({
      type: 'Text',
      text: 'from desktop',
      profileHash: 'REMOTE_HASH',
      contentId: 'blake3v1:remote',
      hasData: false,
      size: 12,
    });
    await adapter.stop();
  });

  it('uploads short imported and observed text without dispatching disabled observations', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await expect(adapter.sendImportedText('from phone', 'LOCAL_HASH')).resolves.toEqual({
      success: true,
      state: 'delivered',
      counts: { accepted: 1, duplicate: 0, offline: 0, errored: 0, pending: 0 },
    });
    await expect(
      adapter.observeClipboardChange(
        { type: 'Text', text: 'observed', profileHash: 'OBSERVED_HASH' },
        false
      )
    ).resolves.toBeNull();
    await adapter.observeClipboardChange(
      { type: 'Text', text: 'observed', profileHash: 'OBSERVED_HASH' },
      true
    );

    expect(client.putClipboard).toHaveBeenNthCalledWith(1, profile, {
      type: 'Text',
      hash: 'LOCAL_HASH',
      text: 'from phone',
      hasData: false,
      size: 10,
    });
    expect(client.putClipboard).toHaveBeenNthCalledWith(2, profile, {
      type: 'Text',
      hash: 'OBSERVED_HASH',
      text: 'observed',
      hasData: false,
      size: 8,
    });
    await adapter.stop();
  });

  it('sends imported text to every selected LAN server', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const getServer = jest.fn(async (serverId?: string) =>
      serverId === 'office' ? office : profile
    );
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    client.putClipboard.mockClear();

    await expect(
      adapter.sendImportedText('shared text', 'SHARED_HASH', {
        targetIds: ['home', 'office'],
      })
    ).resolves.toEqual({
      success: true,
      state: 'delivered',
      counts: { accepted: 2, duplicate: 0, offline: 0, errored: 0, pending: 0 },
    });
    expect(getServer).toHaveBeenCalledWith('home');
    expect(getServer).toHaveBeenCalledWith('office');
    expect(client.putClipboard).toHaveBeenCalledTimes(2);
    expect(client.putClipboard).toHaveBeenNthCalledWith(1, profile, expect.any(Object));
    expect(client.putClipboard).toHaveBeenNthCalledWith(2, office, expect.any(Object));
    await adapter.stop();
  });

  it('automatically sends imported text to every configured LAN server', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async (server: typeof profile) => ({ url: server.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      getServers: async () => [profile, office],
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    client.putClipboard.mockClear();

    await expect(adapter.sendImportedText('automatic', 'AUTO_HASH')).resolves.toEqual({
      success: true,
      state: 'delivered',
      counts: { accepted: 2, duplicate: 0, offline: 0, errored: 0, pending: 0 },
    });
    expect(client.putClipboard).toHaveBeenCalledTimes(2);
    expect(client.putClipboard).toHaveBeenCalledWith(profile, expect.any(Object));
    expect(client.putClipboard).toHaveBeenCalledWith(office, expect.any(Object));
    await adapter.stop();
  });

  it('automatically sends captured clipboard content to every configured LAN server', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async (server: typeof profile) => ({ url: server.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      getServers: async () => [profile, office],
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    client.putClipboard.mockClear();

    await expect(
      adapter.observeClipboardChange(
        { type: 'Text', text: 'captured', profileHash: 'CAPTURED_HASH' },
        true
      )
    ).resolves.toEqual({
      success: true,
      state: 'delivered',
      counts: { accepted: 2, duplicate: 0, offline: 0, errored: 0, pending: 0 },
    });
    expect(client.putClipboard).toHaveBeenCalledTimes(2);
    await adapter.stop();
  });

  it('keeps sending automatic content when one configured LAN server is unavailable', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async (server: typeof profile) => {
        if (server.name === 'Office') throw new Error('office unavailable');
        return { url: server.urls[0] };
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      getServers: async () => [profile, office],
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    client.putClipboard.mockClear();

    await expect(adapter.sendImportedText('automatic', 'AUTO_HASH')).resolves.toEqual({
      success: true,
      state: 'partial',
      counts: { accepted: 1, duplicate: 0, offline: 0, errored: 1, pending: 0 },
    });
    expect(client.putClipboard).toHaveBeenCalledTimes(2);
    await adapter.stop();
  });

  it('does not expand explicit LAN targets to other configured servers', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const getServers = jest.fn(async () => [profile, office]);
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async (server: typeof profile) => ({ url: server.urls[0] })),
    };
    const adapter = new LanSyncAdapter({
      getServer: async (serverId?: string) => (serverId === 'office' ? office : profile),
      getServers,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    client.putClipboard.mockClear();
    getServers.mockClear();

    await adapter.sendImportedText('shared', 'SHARE_HASH', { targetIds: ['office'] });

    expect(getServers).not.toHaveBeenCalled();
    expect(client.putClipboard).toHaveBeenCalledTimes(1);
    expect(client.putClipboard).toHaveBeenCalledWith(office, expect.any(Object));
    await adapter.stop();
  });

  it('reports partial delivery when one selected LAN server fails', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const office = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async (server: typeof profile) => {
        if (server.name === 'Office') throw new Error('offline');
        return { url: server.urls[0] };
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async (serverId?: string) => (serverId === 'office' ? office : profile),
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await expect(
      adapter.sendImportedText('shared text', 'SHARED_HASH', {
        targetIds: ['home', 'office'],
      })
    ).resolves.toEqual({
      success: true,
      state: 'partial',
      counts: { accepted: 1, duplicate: 0, offline: 0, errored: 1, pending: 0 },
    });
    await adapter.stop();
  });

  it('reports failed delivery when every selected LAN server fails', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => {
        throw new Error('failed');
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await expect(
      adapter.sendImportedText('shared text', 'SHARED_HASH', {
        targetIds: ['home', 'office'],
      })
    ).resolves.toEqual({
      success: false,
      state: 'failed',
      counts: { accepted: 0, duplicate: 0, offline: 0, errored: 2, pending: 0 },
    });
    await adapter.stop();
  });

  it('uploads long text as UTF-8 payload and counts grapheme clusters', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    const grapheme = '👨‍👩‍👧‍👦';
    const text = grapheme.repeat(10241);

    await adapter.sendImportedText(text, 'LONG_HASH');

    expect(client.putClipboard).toHaveBeenLastCalledWith(
      profile,
      {
        type: 'Text',
        hash: 'LONG_HASH',
        text: grapheme.repeat(10240),
        hasData: true,
        dataName: 'text_LONG_HASH.txt',
        size: 10241,
      },
      {
        uri: expect.stringContaining('text_LONG_HASH.txt'),
        name: 'text_LONG_HASH.txt',
        mimeType: 'text/plain; charset=utf-8',
      }
    );
    await adapter.stop();
  });

  it('reads the full observed long text from its local payload file', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const { File } = require('expo-file-system') as {
      File: { textMock: jest.Mock };
    };
    const fullText = 'x'.repeat(10241);
    File.textMock.mockResolvedValueOnce(fullText);
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await adapter.observeClipboardChange(
      {
        type: 'Text',
        text: 'preview only',
        profileHash: 'LONG_OBSERVED_HASH',
        hasData: true,
        fileUri: 'file:///cache/LONG_OBSERVED_HASH.txt',
      },
      true
    );

    expect(File.textMock).toHaveBeenCalledWith();
    expect(client.putClipboard).toHaveBeenLastCalledWith(
      profile,
      expect.objectContaining({
        hash: 'LONG_OBSERVED_HASH',
        text: 'x'.repeat(10240),
        hasData: true,
        size: 10241,
      }),
      expect.objectContaining({ name: 'text_LONG_OBSERVED_HASH.txt' })
    );
    await adapter.stop();
  });

  it('uploads images and sanitized file names as payload documents', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await adapter.sendImportedAsset(
      { kind: 'image', uri: 'file:///cache/photo.png', mimeType: 'image/png' },
      'IMAGE_HASH'
    );
    await adapter.sendImportedAsset(
      { kind: 'file', uri: 'file:///cache/report.pdf', fileName: '../../report?.pdf' },
      'FILE_HASH'
    );

    expect(client.putClipboard).toHaveBeenNthCalledWith(
      1,
      profile,
      {
        type: 'Image',
        hash: 'IMAGE_HASH',
        text: 'image.png',
        hasData: true,
        dataName: 'image.png',
        size: 1000,
      },
      { uri: 'file:///cache/photo.png', name: 'image.png', mimeType: 'image/png' }
    );
    expect(client.putClipboard).toHaveBeenNthCalledWith(
      2,
      profile,
      {
        type: 'File',
        hash: 'FILE_HASH',
        text: 'report_.pdf',
        hasData: true,
        dataName: 'report_.pdf',
        size: 1000,
      },
      { uri: 'file:///cache/report.pdf', name: 'report_.pdf', mimeType: undefined }
    );
    await adapter.stop();
  });

  it('downloads and applies a remote image from the selected candidate', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const applyRemoteContent = jest.fn(async () => undefined);
    const preparePayloadTempUri = jest.fn(() => 'file:///cache/REMOTE_IMAGE-image.jpg');
    const client = {
      getClipboard: jest.fn(async () => ({
        url: profile.urls[0],
        document: {
          type: 'Image',
          hash: 'REMOTE_IMAGE',
          contentId: 'blake3v1:remote-image',
          text: 'image.jpg',
          hasData: true,
          dataName: 'image.jpg',
          size: 321,
        },
      })),
      putClipboard: jest.fn(),
      downloadPayload: jest.fn(async () => 'file:///cache/REMOTE_IMAGE-image.jpg'),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent,
      preparePayloadTempUri,
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    expect(preparePayloadTempUri).toHaveBeenCalledWith('REMOTE_IMAGE', 'image.jpg');
    expect(client.downloadPayload).toHaveBeenCalledWith(
      profile,
      profile.urls[0],
      'image.jpg',
      'file:///cache/REMOTE_IMAGE-image.jpg'
    );
    expect(applyRemoteContent).toHaveBeenCalledWith({
      type: 'Image',
      text: 'image.jpg',
      profileHash: 'REMOTE_IMAGE',
      contentId: 'blake3v1:remote-image',
      hasData: true,
      dataName: 'image.jpg',
      fileUri: 'file:///cache/REMOTE_IMAGE-image.jpg',
      size: 321,
    });
    await adapter.stop();
  });

  it('keeps running after a transient polling failure and reports recovery', async () => {
    jest.useFakeTimers();
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest
        .fn<() => Promise<null>>()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('network lost'))
        .mockResolvedValue(null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    const events: unknown[] = [];
    adapter.subscribe((event: unknown) => events.push(event));
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    await jest.advanceTimersByTimeAsync(2000);
    expect(events).toEqual([
      { type: 'connectionChanged', connected: false, message: 'network lost' },
    ]);
    await expect(adapter.sendImportedText('still works', 'LOCAL_HASH')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );

    await jest.advanceTimersByTimeAsync(2000);
    expect(events).toEqual([
      { type: 'connectionChanged', connected: false, message: 'network lost' },
      { type: 'connectionChanged', connected: true },
    ]);
    await adapter.stop();
  });

  it('starts the selected LAN transport while offline and recovers on polling', async () => {
    jest.useFakeTimers();
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    const client = {
      getClipboard: jest
        .fn<() => Promise<null>>()
        .mockRejectedValueOnce(new Error('desktop offline'))
        .mockResolvedValue(null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });
    const events: unknown[] = [];
    adapter.subscribe((event: unknown) => events.push(event));

    await expect(
      adapter.start({
        appVersion: '2.0.0',
        profileId: 'default',
        policy: { appState: 'active', backgroundSyncEnabled: false },
      })
    ).resolves.toBeUndefined();
    expect(events).toEqual([
      { type: 'connectionChanged', connected: false, message: 'desktop offline' },
    ]);

    await jest.advanceTimersByTimeAsync(2000);
    expect(client.getClipboard).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: 'connectionChanged', connected: false, message: 'desktop offline' },
      { type: 'connectionChanged', connected: true },
    ]);
    await adapter.stop();
  });

  it('pulls immediately for SSE hello, update, and resync notifications', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    jest.useFakeTimers();
    let listener:
      | {
          onEvent(event: unknown): void;
          onDisconnected(error: Error): void;
        }
      | undefined;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn((_server: unknown, nextListener: typeof listener) => {
        listener = nextListener;
        return jest.fn();
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    expect(client.subscribeClipboardEvents).toHaveBeenCalledWith(profile, expect.any(Object));
    expect(client.getClipboard).toHaveBeenCalledTimes(1);

    listener?.onEvent({ type: 'hello', serverTimeMs: 1 });
    await jest.advanceTimersByTimeAsync(0);
    listener?.onEvent({ type: 'update', contentId: 'blake3v1:new', serverTimeMs: 2 });
    await jest.advanceTimersByTimeAsync(0);
    listener?.onEvent({ type: 'resync', serverTimeMs: 3 });
    await jest.advanceTimersByTimeAsync(0);

    expect(client.getClipboard).toHaveBeenCalledTimes(4);
    await adapter.stop();
  });

  it('reconnects a failed SSE subscription and ignores callbacks after stop', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    jest.useFakeTimers();
    const listeners: Array<{
      onEvent(event: unknown): void;
      onDisconnected(error: Error): void;
    }> = [];
    const cancellations: jest.Mock[] = [];
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn(
        (_server: unknown, listener: (typeof listeners)[number]) => {
          listeners.push(listener);
          const cancel = jest.fn();
          cancellations.push(cancel);
          return cancel;
        }
      ),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    listeners[0].onDisconnected(new Error('stream ended'));
    await jest.advanceTimersByTimeAsync(999);
    expect(client.subscribeClipboardEvents).toHaveBeenCalledTimes(1);
    // The first retry waits 1 s plus up to 300 ms of jitter.
    await jest.advanceTimersByTimeAsync(301);
    expect(client.subscribeClipboardEvents).toHaveBeenCalledTimes(2);

    await adapter.stop();
    expect(cancellations[1]).toHaveBeenCalledTimes(1);
    listeners[1].onEvent({ type: 'update', contentId: 'stale', serverTimeMs: 3 });
    listeners[1].onDisconnected(new Error('stale disconnect'));
    await jest.advanceTimersByTimeAsync(30_000);

    expect(client.getClipboard).toHaveBeenCalledTimes(1);
    expect(client.subscribeClipboardEvents).toHaveBeenCalledTimes(2);
  });

  it('uses low-frequency polling while SSE is connected', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    jest.useFakeTimers();
    let listener: { onEvent(event: unknown): void; onDisconnected(error: Error): void } | undefined;
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn((_server: unknown, nextListener: typeof listener) => {
        listener = nextListener;
        return jest.fn();
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    listener?.onEvent({ type: 'hello', serverTimeMs: 1 });
    await jest.advanceTimersByTimeAsync(0);
    expect(client.getClipboard).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(29_999);
    expect(client.getClipboard).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(client.getClipboard).toHaveBeenCalledTimes(3);
    await adapter.stop();
  });

  it('coalesces an SSE burst into one active pull and one pending pull', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    jest.useFakeTimers();
    let listener: { onEvent(event: unknown): void; onDisconnected(error: Error): void } | undefined;
    let finishActivePull: ((value: null) => void) | undefined;
    const activePull = new Promise<null>((resolve) => {
      finishActivePull = resolve;
    });
    const client = {
      getClipboard: jest
        .fn<() => Promise<null>>()
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(activePull)
        .mockResolvedValue(null),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn((_server: unknown, nextListener: typeof listener) => {
        listener = nextListener;
        return jest.fn();
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    listener?.onEvent({ type: 'update', contentId: 'one', serverTimeMs: 1 });
    listener?.onEvent({ type: 'update', contentId: 'two', serverTimeMs: 2 });
    listener?.onEvent({ type: 'resync', serverTimeMs: 3 });
    await Promise.resolve();

    expect(client.getClipboard).toHaveBeenCalledTimes(2);
    finishActivePull?.(null);
    await jest.advanceTimersByTimeAsync(0);
    expect(client.getClipboard).toHaveBeenCalledTimes(3);
    await adapter.stop();
  });

  it('cancels the old SSE subscription when the active server changes', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    let activeServer = profile;
    const nextProfile = {
      ...profile,
      name: 'Office',
      urls: ['http://office.local:42720'],
    };
    const listeners: Array<{
      onEvent(event: unknown): void;
      onDisconnected(error: Error): void;
    }> = [];
    const cancellations: jest.Mock[] = [];
    const client = {
      getClipboard: jest.fn(async () => null),
      putClipboard: jest.fn(async () => ({ url: activeServer.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn(
        (_server: unknown, listener: (typeof listeners)[number]) => {
          listeners.push(listener);
          const cancel = jest.fn();
          cancellations.push(cancel);
          return cancel;
        }
      ),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => activeServer,
      readClipboard: async () => null,
      applyRemoteContent: async () => undefined,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    activeServer = nextProfile;
    await adapter.refresh({ appState: 'active', backgroundSyncEnabled: false });

    expect(cancellations[0]).toHaveBeenCalledTimes(1);
    expect(client.subscribeClipboardEvents).toHaveBeenLastCalledWith(
      nextProfile,
      expect.any(Object)
    );
    listeners[0].onEvent({ type: 'update', contentId: 'stale', serverTimeMs: 3 });
    await Promise.resolve();
    expect(client.getClipboard).toHaveBeenCalledTimes(2);
    await adapter.stop();
  });

  it('discards an in-flight LAN pull after the adapter stops', async () => {
    const LanSyncAdapter = loadAdapter();
    expect(LanSyncAdapter).toBeDefined();
    if (!LanSyncAdapter) return;
    let finishPull:
      | ((value: {
          url: string;
          document: {
            type: 'Text';
            hash: string;
            text: string;
            hasData: false;
          };
        }) => void)
      | undefined;
    const inFlightPull = new Promise<{
      url: string;
      document: { type: 'Text'; hash: string; text: string; hasData: false };
    }>((resolve) => {
      finishPull = resolve;
    });
    let listener: { onEvent(event: unknown): void; onDisconnected(error: Error): void } | undefined;
    const applyRemoteContent = jest.fn(async () => undefined);
    const client = {
      getClipboard: jest.fn().mockResolvedValueOnce(null).mockReturnValueOnce(inFlightPull),
      putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
      downloadPayload: jest.fn(),
      subscribeClipboardEvents: jest.fn((_server: unknown, nextListener: typeof listener) => {
        listener = nextListener;
        return jest.fn();
      }),
    };
    const adapter = new LanSyncAdapter({
      getServer: async () => profile,
      readClipboard: async () => null,
      applyRemoteContent,
      preparePayloadTempUri: jest.fn(),
      client,
    });

    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });
    listener?.onEvent({ type: 'update', contentId: 'late', serverTimeMs: 1 });
    await Promise.resolve();
    await adapter.stop();
    finishPull?.({
      url: profile.urls[0],
      document: {
        type: 'Text',
        hash: 'LATE_HASH',
        text: 'too late',
        hasData: false,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(applyRemoteContent).not.toHaveBeenCalled();
  });
});
