import type { SendReport } from 'uc-engine';
import {
  UnifiedContentError,
  UnifiedContentService,
  type UnifiedContentApi,
  type UnifiedContentDependencies,
} from '../features/transfer';

const report: SendReport = {
  entryId: 'entry-1',
  atMs: 1,
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
    registerInputFile: jest.fn(() => 'file-handle-1'),
    sendFiles: jest.fn(async () => report),
    releaseFileHandle: jest.fn(),
  };
}

function dependencies(
  overrides: Partial<UnifiedContentDependencies> = {}
): UnifiedContentDependencies {
  const p2p = api();
  return {
    readClipboard: jest.fn(async () => null),
    readFileBytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    p2p,
    completeOutboundDelivery: jest.fn(async (send) => ({
      report: await send(),
      completed: 1,
      failed: 0,
      cancelled: 0,
      pending: 0,
      reasons: [],
    })),
    persistDelivery: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('UnifiedContentService', () => {
  it('sends imported text through P2P', async () => {
    const deps = dependencies();

    await expect(
      new UnifiedContentService(deps).sendImportedText('shared text', 'TEXT_HASH')
    ).resolves.toMatchObject({ channel: 'p2p', deliveryState: 'delivered' });
    expect(deps.p2p.sendText).toHaveBeenCalledWith('shared text', []);
  });

  it('rejects an empty clipboard', async () => {
    const service = new UnifiedContentService(dependencies());

    await expect(service.sendCurrentClipboard()).rejects.toEqual(
      expect.objectContaining<Partial<UnifiedContentError>>({ code: 'clipboardEmpty' })
    );
  });

  it('reads long clipboard text from its local payload file', async () => {
    const deps = dependencies({
      readClipboard: jest.fn(async () => ({
        type: 'Text',
        text: 'placeholder',
        hasData: true,
        fileUri: 'file:///payload.txt',
        profileHash: 'TEXT_HASH',
      })),
      readFileBytes: jest.fn(async () => new TextEncoder().encode('full text')),
    });

    await new UnifiedContentService(deps).sendCurrentClipboard();

    expect(deps.p2p.sendText).toHaveBeenCalledWith('full text', []);
  });

  it('sends a small image directly with its inferred media type', async () => {
    const deps = dependencies();

    await new UnifiedContentService(deps).sendImportedAsset(
      { kind: 'image', uri: 'file:///photo.png' },
      'IMAGE_HASH'
    );

    expect(deps.p2p.sendImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'image/png', []);
    expect(deps.completeOutboundDelivery).not.toHaveBeenCalled();
  });

  it('waits for terminal delivery for large images', async () => {
    const bytes = new Uint8Array(64 * 1024 + 1);
    const deps = dependencies({ readFileBytes: jest.fn(async () => bytes) });

    await new UnifiedContentService(deps).sendImportedAsset(
      { kind: 'image', uri: 'file:///photo.webp' },
      'IMAGE_HASH',
      { targetDeviceIds: ['desktop-1'] }
    );

    expect(deps.completeOutboundDelivery).toHaveBeenCalledTimes(1);
    expect(deps.p2p.sendImage).toHaveBeenCalledWith(bytes, 'image/webp', ['desktop-1']);
  });

  it('registers files for selected devices and always releases the handle', async () => {
    const p2p = api();
    const deps = dependencies({ p2p });

    await new UnifiedContentService(deps).sendImportedAsset(
      { kind: 'file', uri: 'file:///archive.zip', fileName: 'archive.zip' },
      'FILE_HASH',
      { targetDeviceIds: ['desktop-1'] }
    );

    expect(p2p.registerInputFile).toHaveBeenCalledWith('file:///archive.zip', 'archive.zip');
    expect(p2p.sendFiles).toHaveBeenCalledWith(['file-handle-1'], ['desktop-1']);
    expect(p2p.releaseFileHandle).toHaveBeenCalledWith('file-handle-1');
  });

  it('releases a file handle when delivery fails', async () => {
    const p2p = api();
    const deps = dependencies({
      p2p,
      completeOutboundDelivery: jest.fn(async () => {
        throw new Error('delivery failed');
      }),
    });

    await expect(
      new UnifiedContentService(deps).sendImportedAsset(
        { kind: 'file', uri: 'file:///archive.zip' },
        'FILE_HASH'
      )
    ).rejects.toThrow('delivery failed');
    expect(p2p.releaseFileHandle).toHaveBeenCalledWith('file-handle-1');
  });
});
