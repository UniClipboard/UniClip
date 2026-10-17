/// <reference types="jest" />

const mockRequestDirectoryPermissions = jest.fn();
const mockCreateFile = jest.fn();
const mockDelete = jest.fn();
const mockReadAsString = jest.fn();
const mockWriteAsString = jest.fn();
const mockNativeCopyFile = jest.fn();
const mockLogWarn = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android' },
}));

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: (...args: unknown[]) =>
      mockRequestDirectoryPermissions(...args),
    createFileAsync: (...args: unknown[]) => mockCreateFile(...args),
  },
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsString(...args),
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsString(...args),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('android-util', () => ({
  nativeCopyFile: (...args: unknown[]) => mockNativeCopyFile(...args),
}));

jest.mock('@/support/observability', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: jest.fn(),
  }),
}));

jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

import { saveFile } from '../utils/fileActions.android';

describe('Android saveFile', () => {
  const sourceUri = 'file:///data/user/0/app/cache/1832cb19-3434-4d61-abdf-2497dd23e9b2.apk';
  const destinationUri =
    'content://com.android.externalstorage.documents/tree/primary%3ADownload/document/UniClip.apk';

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestDirectoryPermissions.mockResolvedValue({
      granted: true,
      directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload',
    });
    mockCreateFile.mockResolvedValue(destinationUri);
    mockNativeCopyFile.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  it('streams an APK through the Expo native module even when React Native NativeModules is empty', async () => {
    await expect(saveFile(sourceUri, 'UniClip.apk')).resolves.toBe(true);

    expect(mockCreateFile).toHaveBeenCalledWith(
      'content://com.android.externalstorage.documents/tree/primary%3ADownload',
      'UniClip.apk',
      'application/vnd.android.package-archive'
    );
    expect(mockNativeCopyFile).toHaveBeenCalledWith(sourceUri, destinationUri);
    expect(mockReadAsString).not.toHaveBeenCalled();
    expect(mockWriteAsString).not.toHaveBeenCalled();
  });

  it('returns false without creating a document when the directory chooser is cancelled', async () => {
    mockRequestDirectoryPermissions.mockResolvedValueOnce({ granted: false });

    await expect(saveFile(sourceUri, 'UniClip.apk')).resolves.toBe(false);

    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(mockNativeCopyFile).not.toHaveBeenCalled();
  });

  it('removes the partial SAF document and rethrows the original copy error', async () => {
    const copyError = new Error('native copy failed');
    mockNativeCopyFile.mockRejectedValueOnce(copyError);

    await expect(saveFile(sourceUri, 'UniClip.apk')).rejects.toBe(copyError);

    expect(mockDelete).toHaveBeenCalledWith(destinationUri, { idempotent: true });
  });

  it('keeps the original copy error when partial-document cleanup also fails', async () => {
    const copyError = new Error('native copy failed');
    const cleanupError = new Error('provider refused delete');
    mockNativeCopyFile.mockRejectedValueOnce(copyError);
    mockDelete.mockRejectedValueOnce(cleanupError);

    await expect(saveFile(sourceUri, 'UniClip.apk')).rejects.toBe(copyError);

    expect(mockLogWarn).toHaveBeenCalledWith(
      'Failed to remove partial saved file:',
      cleanupError
    );
  });

  it('uses the source name and generic binary MIME type when no file name is supplied', async () => {
    const unknownSource = 'file:///data/user/0/app/cache/archive.unknown';

    await expect(saveFile(unknownSource)).resolves.toBe(true);

    expect(mockCreateFile).toHaveBeenCalledWith(
      'content://com.android.externalstorage.documents/tree/primary%3ADownload',
      'archive.unknown',
      'application/octet-stream'
    );
    expect(mockNativeCopyFile).toHaveBeenCalledWith(unknownSource, destinationUri);
  });
});
