import { describe, expect, it, jest } from '@jest/globals';
import type { SendReport } from 'uc-engine';
import type { OutboundDeliveryOutcome } from '../services/OutboundDeliveryCoordinator';
import {
  UnifiedContentError,
  UnifiedContentService,
  type UnifiedContentApi,
  type UnifiedContentDependencies,
} from '../services/UnifiedContentService';

const report: SendReport = {
  entryId: 'entry-1',
  atMs: 1_700_000_000_000,
  totalAccepted: 1,
  totalDuplicate: 0,
  totalOffline: 0,
  totalErrored: 0,
  totalPending: 0,
};

function api(): jest.Mocked<UnifiedContentApi> {
  return {
    sendText: jest.fn(async () => report),
    sendImage: jest.fn(async () => report),
    registerInputFile: jest.fn(() => 'opaque-file-1'),
    sendFiles: jest.fn(async () => report),
    releaseFileHandle: jest.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dependencies(
  channel: 'p2p' | 'lan',
  overrides: Partial<UnifiedContentDependencies> = {}
): UnifiedContentDependencies {
  return {
    getChannel: () => channel,
    readClipboard: jest.fn(async () => null),
    readFileBytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    p2p: api(),
    uploadLanClipboard: jest.fn(async () => ({ success: true })),
    enqueueLanUpload: jest.fn(),
    pushLanUpload: jest.fn(async () => {}),
    pushLanFile: jest.fn(async () => {}),
    completeOutboundDelivery: jest.fn(async (send: () => Promise<SendReport>) => {
      const sent = await send();
      return {
        report: sent,
        completed: sent.totalAccepted,
        failed: 0,
        cancelled: 0,
        pending: 0,
        reasons: [],
      } satisfies OutboundDeliveryOutcome;
    }),
    ...overrides,
  };
}

describe('UnifiedContentService', () => {
  it('sends current text through P2P without touching LAN', async () => {
    const deps = dependencies('p2p', {
      readClipboard: jest.fn(async () => ({
        type: 'Text',
        text: 'private text',
        profileHash: 'LOCAL_TEXT_HASH',
      })),
    });
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).resolves.toEqual({
      channel: 'p2p',
      success: true,
      entryId: 'entry-1',
      profileHash: 'LOCAL_TEXT_HASH',
      deliveryState: 'delivered',
      report,
    });

    expect(deps.p2p.sendText).toHaveBeenCalledWith('private text', []);
    expect(deps.uploadLanClipboard).not.toHaveBeenCalled();
  });

  it('preserves every P2P delivery count for honest feedback', async () => {
    const detailedReport: SendReport = {
      ...report,
      totalAccepted: 1,
      totalDuplicate: 2,
      totalOffline: 3,
      totalErrored: 4,
      totalPending: 5,
    };
    const native = api();
    native.sendText.mockResolvedValueOnce(detailedReport);
    const deps = dependencies('p2p', {
      p2p: native,
      readClipboard: jest.fn(async () => ({ type: 'Text', text: 'delivery details' })),
    });

    await expect(new UnifiedContentService(deps).sendCurrentClipboard()).resolves.toEqual({
      channel: 'p2p',
      success: true,
      entryId: 'entry-1',
      profileHash: undefined,
      deliveryState: 'partial',
      report: detailedReport,
    });
  });

  it('reports an offline P2P send as offline instead of success', async () => {
    const offlineReport: SendReport = {
      ...report,
      totalAccepted: 0,
      totalOffline: 1,
    };
    const native = api();
    native.sendFiles.mockResolvedValueOnce(offlineReport);
    const deps = dependencies('p2p', { p2p: native });

    await expect(
      new UnifiedContentService(deps).sendImportedAsset(
        { kind: 'file', uri: 'file:///private/offline.txt' },
        'OFFLINE_FILE_HASH'
      )
    ).resolves.toEqual({
      channel: 'p2p',
      success: false,
      entryId: 'entry-1',
      profileHash: 'OFFLINE_FILE_HASH',
      deliveryState: 'offline',
      report: offlineReport,
    });
  });

  it('reads current image bytes and preserves its media type for P2P', async () => {
    const deps = dependencies('p2p', {
      readClipboard: jest.fn(async () => ({
        type: 'Image',
        fileUri: 'file:///private/photo.jpg',
        fileName: 'photo.jpg',
      })),
    });
    const service = new UnifiedContentService(deps);

    await service.sendCurrentClipboard();

    expect(deps.readFileBytes).toHaveBeenCalledWith('file:///private/photo.jpg');
    expect(deps.p2p.sendImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'image/jpeg', []);
  });

  it('registers and always releases a current file handle', async () => {
    const native = api();
    native.sendFiles.mockRejectedValueOnce(new Error('offline'));
    const deps = dependencies('p2p', {
      p2p: native,
      readClipboard: jest.fn(async () => ({
        type: 'File',
        fileUri: 'content://documents/private-file',
        fileName: 'original-current-file.txt',
      })),
    });
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).rejects.toThrow('offline');

    expect(native.registerInputFile).toHaveBeenCalledWith(
      'content://documents/private-file',
      'original-current-file.txt'
    );
    expect(native.sendFiles).toHaveBeenCalledWith(['opaque-file-1'], []);
    expect(native.releaseFileHandle).toHaveBeenCalledWith('opaque-file-1');
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
  });

  it('uses the existing LAN clipboard upload without reading through P2P', async () => {
    const deps = dependencies('lan', {
      uploadLanClipboard: jest.fn(async () => ({ success: false, error: 'server offline' })),
    });
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).resolves.toEqual({
      channel: 'lan',
      success: false,
      error: 'server offline',
    });

    expect(deps.readClipboard).not.toHaveBeenCalled();
    expect(deps.p2p.sendText).not.toHaveBeenCalled();
  });

  it('sends an imported image through P2P without entering the LAN queue', async () => {
    const deps = dependencies('p2p');
    const service = new UnifiedContentService(deps);

    await service.sendImportedAsset(
      {
        kind: 'image',
        uri: 'file:///private/picked.webp',
        mimeType: 'image/webp',
      },
      'local-profile-1'
    );

    expect(deps.p2p.sendImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'image/webp', []);
    expect(deps.completeOutboundDelivery).not.toHaveBeenCalled();
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
  });

  it('waits for remote download completion for a pull-based imported image', async () => {
    const deps = dependencies('p2p', {
      readFileBytes: jest.fn(async () => new Uint8Array(64 * 1024 + 1)),
    });
    const service = new UnifiedContentService(deps);

    await service.sendImportedAsset(
      {
        kind: 'image',
        uri: 'file:///private/picked.webp',
        mimeType: 'image/webp',
      },
      'local-profile-1'
    );

    expect(deps.completeOutboundDelivery).toHaveBeenCalledTimes(1);
    expect(deps.p2p.sendImage).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: 64 * 1024 + 1 }),
      'image/webp',
      []
    );
  });

  it('sends an imported file through an opaque P2P handle and releases it', async () => {
    const deps = dependencies('p2p');
    const service = new UnifiedContentService(deps);

    await service.sendImportedAsset(
      {
        kind: 'file',
        uri: 'file:///private/history/CONTENT_HASH',
        fileName: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
      },
      'local-profile-2'
    );

    expect(deps.p2p.registerInputFile).toHaveBeenCalledWith(
      'file:///private/history/CONTENT_HASH',
      'quarterly-report.pdf'
    );
    expect(deps.p2p.sendFiles).toHaveBeenCalledWith(['opaque-file-1'], []);
    expect(deps.p2p.releaseFileHandle).toHaveBeenCalledWith('opaque-file-1');
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
  });

  it('keeps an imported file handle until remote download completion', async () => {
    const completion = deferred<OutboundDeliveryOutcome>();
    const native = api();
    const completeOutboundDelivery = jest.fn(
      async (send: () => Promise<SendReport>): Promise<OutboundDeliveryOutcome> => {
        await send();
        expect(native.releaseFileHandle).not.toHaveBeenCalled();
        return completion.promise;
      }
    );
    const deps = dependencies('p2p', {
      p2p: native,
      completeOutboundDelivery,
    });
    const service = new UnifiedContentService(deps);

    const resultPromise = service.sendImportedAsset(
      {
        kind: 'file',
        uri: 'file:///private/history/CONTENT_HASH',
        fileName: 'quarterly-report.pdf',
      },
      'local-profile-2'
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(completeOutboundDelivery).toHaveBeenCalledTimes(1);
    expect(native.releaseFileHandle).not.toHaveBeenCalled();

    completion.resolve({
      report,
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
      reasons: [],
    });

    await expect(resultPromise).resolves.toMatchObject({
      deliveryState: 'delivered',
    });
    expect(native.releaseFileHandle).toHaveBeenCalledWith('opaque-file-1');
  });

  it.each([
    {
      name: 'partial when one of two peers fails',
      outcome: { completed: 1, failed: 1, cancelled: 0, pending: 0 },
      expectedState: 'partial',
      expectedCounts: { accepted: 1, errored: 1, pending: 0 },
    },
    {
      name: 'failed when no peer completes and one fails',
      outcome: { completed: 0, failed: 1, cancelled: 0, pending: 1 },
      expectedState: 'failed',
      expectedCounts: { accepted: 0, errored: 1, pending: 1 },
    },
    {
      name: 'pending when every accepted peer times out',
      outcome: { completed: 0, failed: 0, cancelled: 0, pending: 2 },
      expectedState: 'pending',
      expectedCounts: { accepted: 0, errored: 0, pending: 2 },
    },
  ])('reports remote pull as $name', async ({ outcome, expectedState, expectedCounts }) => {
    const initialReport = { ...report, totalAccepted: 2 };
    const deps = dependencies('p2p', {
      completeOutboundDelivery: jest.fn(async (send: () => Promise<SendReport>) => {
        await send();
        return {
          report: initialReport,
          ...outcome,
          reasons: [],
        };
      }),
    });

    const result = await new UnifiedContentService(deps).sendImportedAsset(
      { kind: 'file', uri: 'file:///private/history/CONTENT_HASH' },
      'local-profile-2'
    );

    expect(result).toMatchObject({
      channel: 'p2p',
      deliveryState: expectedState,
      report: {
        totalAccepted: expectedCounts.accepted,
        totalErrored: expectedCounts.errored,
        totalPending: expectedCounts.pending,
      },
    });
  });

  it('moves a pending dispatch into completed after that peer finishes pulling', async () => {
    const pendingReport = {
      ...report,
      totalAccepted: 0,
      totalPending: 1,
    };
    const deps = dependencies('p2p', {
      completeOutboundDelivery: jest.fn(async (send: () => Promise<SendReport>) => {
        await send();
        return {
          report: pendingReport,
          completed: 1,
          failed: 0,
          cancelled: 0,
          pending: 0,
          reasons: [],
        };
      }),
    });

    await expect(
      new UnifiedContentService(deps).sendImportedAsset(
        { kind: 'file', uri: 'file:///private/history/CONTENT_HASH' },
        'local-profile-2'
      )
    ).resolves.toMatchObject({
      deliveryState: 'delivered',
      report: {
        totalAccepted: 1,
        totalPending: 0,
      },
    });
  });

  it('keeps imported assets on the existing LAN queue when LAN is selected', async () => {
    const deps = dependencies('lan');
    const service = new UnifiedContentService(deps);

    await expect(
      service.sendImportedAsset(
        { kind: 'file', uri: 'file:///private/report.pdf' },
        'local-profile-3'
      )
    ).resolves.toEqual({ channel: 'lan', success: true });

    expect(deps.enqueueLanUpload).toHaveBeenCalledWith('local-profile-3');
    expect(deps.p2p.registerInputFile).not.toHaveBeenCalled();
  });

  it('uses the handoff channel even when the current setting changed', async () => {
    const deps = dependencies('p2p');
    const service = new UnifiedContentService(deps);

    await expect(
      service.sendImportedAsset(
        { kind: 'file', uri: 'file:///group/outbound-handoff/archive.zip' },
        'HANDOFF_HASH',
        { channel: 'lan', awaitLanDelivery: true, serverId: 'server-a', byteCount: 104857601 }
      )
    ).resolves.toEqual({ channel: 'lan', success: true });

    expect(deps.pushLanFile).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///group/outbound-handoff/archive.zip' }),
      'HANDOFF_HASH',
      'server-a',
      104857601
    );
    expect(deps.pushLanUpload).not.toHaveBeenCalled();
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
    expect(deps.p2p.registerInputFile).not.toHaveBeenCalled();
  });

  it('can resume a P2P handoff while LAN is currently selected', async () => {
    const deps = dependencies('lan');
    const service = new UnifiedContentService(deps);

    await service.sendImportedAsset(
      { kind: 'file', uri: 'file:///group/outbound-handoff/archive.zip' },
      'HANDOFF_HASH',
      { channel: 'p2p', awaitLanDelivery: true }
    );

    expect(deps.p2p.registerInputFile).toHaveBeenCalled();
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
    expect(deps.pushLanUpload).not.toHaveBeenCalled();
  });

  it('rejects an empty P2P clipboard without falling back to LAN', async () => {
    const deps = dependencies('p2p');
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).rejects.toMatchObject<UnifiedContentError>({
      code: 'clipboardEmpty',
    });

    expect(deps.uploadLanClipboard).not.toHaveBeenCalled();
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
  });
});
