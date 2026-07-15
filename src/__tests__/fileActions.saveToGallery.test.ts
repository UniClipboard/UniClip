jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

jest.mock('expo-media-library/legacy', () => ({
  saveToLibraryAsync: jest.fn(),
}));

jest.mock('document-exporter', () => ({
  exportFile: jest.fn(),
}));

jest.mock('expo-file-system', () => {
  const copy = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn();
  let directoryEntries: MockFile[] = [];
  const joinUri = (parts: Array<string | { uri: string }>) => {
    const [first, ...rest] = parts.map((part) => (typeof part === 'string' ? part : part.uri));
    return [first.replace(/\/+$/, ''), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ''))].join(
      '/'
    );
  };

  class MockDirectory {
    uri: string;
    exists = true;

    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = joinUri(parts);
    }

    create = jest.fn();
    list = jest.fn(() => directoryEntries);
  }

  class MockFile {
    uri: string;
    exists = true;

    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = joinUri(parts);
    }

    copy = jest.fn(async (destination: MockFile) => copy(this.uri, destination.uri));
    delete = jest.fn(() => remove(this.uri));
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: 'file:///cache', document: 'file:///documents' },
    __copy: copy,
    __remove: remove,
    __setDirectoryEntries: (uris: string[]) => {
      directoryEntries = uris.map((uri) => new MockFile(uri));
    },
  };
});

import * as MediaLibrary from 'expo-media-library';
import * as LegacyMediaLibrary from 'expo-media-library/legacy';
import { cleanupGalleryExports, saveToGallery } from '../utils/fileActions.shared';
import { saveToGallery as saveToGalleryIos } from '../utils/fileActions.ios';

const mockCreateAsset = jest.mocked(MediaLibrary.Asset.create);
const mockRequestPermissions = jest.mocked(MediaLibrary.requestPermissionsAsync);
const mockLegacySaveToLibrary = jest.mocked(LegacyMediaLibrary.saveToLibraryAsync);

describe('saveToGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestPermissions.mockResolvedValue({
      status: 'granted' as MediaLibrary.PermissionResponse['status'],
      granted: true,
      expires: 'never',
      canAskAgain: true,
      accessPrivileges: 'all',
    });
    mockCreateAsset.mockResolvedValue({
      id: 'asset-1',
    } as unknown as InstanceType<typeof MediaLibrary.Asset>);
    mockLegacySaveToLibrary.mockResolvedValue(undefined);
    const fileSystemMock = jest.requireMock('expo-file-system') as {
      __setDirectoryEntries: (uris: string[]) => void;
    };
    fileSystemMock.__setDirectoryEntries([]);
  });

  it('uses the Expo 56 Asset API with write-only photo permission', async () => {
    await saveToGallery('file:///cache/photo.png');

    expect(mockRequestPermissions).toHaveBeenCalledWith(true, ['photo']);
    expect(mockCreateAsset).toHaveBeenCalledWith('file:///cache/photo.png');
  });

  it('uses the add-only compatible legacy writer on iOS', async () => {
    await saveToGalleryIos('file:///cache/photo.png', 'photo.png');

    expect(mockRequestPermissions).toHaveBeenCalledWith(true, ['photo']);
    expect(mockLegacySaveToLibrary).toHaveBeenCalledWith('file:///cache/photo.png');
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it('stages an extensionless App Group image with its history filename extension', async () => {
    const fileSystemMock = jest.requireMock('expo-file-system') as {
      __copy: jest.Mock;
      __remove: jest.Mock;
    };

    await saveToGallery('file:///group/payloads/Image-ABCDEF', 'photo.jpg');

    const stagedUri = mockCreateAsset.mock.calls[0][0] as string;
    expect(stagedUri).toMatch(/^file:\/\/\/cache\/gallery-exports\/.+\.jpg$/);
    expect(fileSystemMock.__copy).toHaveBeenCalledWith(
      'file:///group/payloads/Image-ABCDEF',
      stagedUri
    );
    expect(fileSystemMock.__remove).toHaveBeenCalledWith(stagedUri);
  });

  it('removes the staged image when the media-library write fails', async () => {
    const fileSystemMock = jest.requireMock('expo-file-system') as {
      __remove: jest.Mock;
    };
    mockCreateAsset.mockRejectedValueOnce(new Error('Photo library write failed'));

    await expect(saveToGallery('file:///group/payloads/Image-ABCDEF', 'photo.png')).rejects.toThrow(
      'Photo library write failed'
    );

    const stagedUri = mockCreateAsset.mock.calls[0][0] as string;
    expect(fileSystemMock.__remove).toHaveBeenCalledWith(stagedUri);
  });

  it('removes gallery exports left behind by an interrupted previous run', async () => {
    const fileSystemMock = jest.requireMock('expo-file-system') as {
      __remove: jest.Mock;
      __setDirectoryEntries: (uris: string[]) => void;
    };
    const staleUri = 'file:///cache/gallery-exports/stale-photo.png';
    fileSystemMock.__setDirectoryEntries([staleUri]);

    await cleanupGalleryExports();

    expect(fileSystemMock.__remove).toHaveBeenCalledWith(staleUri);
  });
});
