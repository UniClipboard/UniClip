import { describe, expect, it, jest } from '@jest/globals';
import type { SendReport } from 'uc-engine';
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
    ...overrides,
  };
}

describe('UnifiedContentService', () => {
  it('sends current text through P2P without touching LAN', async () => {
    const deps = dependencies('p2p', {
      readClipboard: jest.fn(async () => ({ type: 'Text', text: 'private text' })),
    });
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).resolves.toEqual({
      channel: 'p2p',
      success: true,
      entryId: 'entry-1',
    });

    expect(deps.p2p.sendText).toHaveBeenCalledWith('private text', []);
    expect(deps.uploadLanClipboard).not.toHaveBeenCalled();
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
      })),
    });
    const service = new UnifiedContentService(deps);

    await expect(service.sendCurrentClipboard()).rejects.toThrow('offline');

    expect(native.registerInputFile).toHaveBeenCalledWith('content://documents/private-file');
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
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
  });

  it('sends an imported file through an opaque P2P handle and releases it', async () => {
    const deps = dependencies('p2p');
    const service = new UnifiedContentService(deps);

    await service.sendImportedAsset(
      { kind: 'file', uri: 'content://documents/report.pdf', mimeType: 'application/pdf' },
      'local-profile-2'
    );

    expect(deps.p2p.registerInputFile).toHaveBeenCalledWith('content://documents/report.pdf');
    expect(deps.p2p.sendFiles).toHaveBeenCalledWith(['opaque-file-1'], []);
    expect(deps.p2p.releaseFileHandle).toHaveBeenCalledWith('opaque-file-1');
    expect(deps.enqueueLanUpload).not.toHaveBeenCalled();
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
