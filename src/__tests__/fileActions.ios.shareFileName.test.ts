/// <reference types="jest" />

/**
 * Regression test for the iOS "分享到其他应用" bug: App Group payloads are stored
 * under a content-hash name with no extension (see fileStorage.ios.ts), so sharing
 * that raw URI directly loses the file name and extension for both plain files and
 * images. `shareFile` on iOS must copy the payload to a temp file named after the
 * original `fileName` before handing it to the system share sheet.
 */

const mockShareAsync = jest.fn<Promise<void>, [string, unknown]>(async () => undefined);
const mockCopy = jest.fn<Promise<void>, [unknown, unknown]>(async () => undefined);
const mockDirCreate = jest.fn();

jest.mock('expo-sharing', () => ({
  shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options),
}));

jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

jest.mock('document-exporter', () => ({
  exportFile: jest.fn(),
  saveImageToPhotoLibrary: jest.fn(),
}));

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidCounter}`),
}));

jest.mock('expo-file-system', () => {
  const mockUriOf = (value: unknown): string =>
    typeof value === 'string' ? value : ((value as { uri?: string })?.uri ?? '');
  return {
    Directory: jest.fn().mockImplementation((parent: unknown, name?: string) => ({
      uri: name ? `${mockUriOf(parent)}/${name}` : mockUriOf(parent),
      exists: true,
      create: mockDirCreate,
    })),
    File: jest.fn().mockImplementation((pathOrDir: unknown, name?: string) => ({
      uri: name ? `${mockUriOf(pathOrDir)}/${name}` : mockUriOf(pathOrDir),
      copy: (dest: { uri: string }, options: unknown) => mockCopy(dest, options).then(() => dest),
    })),
  };
});

jest.mock('../platform/files', () => ({
  CLIPBOARD_TEMP_DIR: { uri: 'file:///cache/temp_files', exists: true, create: jest.fn() },
}));

import { shareFile } from '../utils/fileActions.ios';

function tempFileUriFor(name: string): RegExp {
  return new RegExp(`^file:///cache/temp_files/[^/]+/${name}$`);
}

describe('shareFile on iOS', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies an extensionless App Group file payload to a named temp file before sharing', async () => {
    await shareFile('file:///group/payloads/File-ABCDEF', 'report.pdf');

    expect(mockCopy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.stringMatching(tempFileUriFor('report\\.pdf')) }),
      { overwrite: true }
    );
    expect(mockShareAsync).toHaveBeenCalledWith(expect.stringMatching(tempFileUriFor('report\\.pdf')), {
      mimeType: 'application/pdf',
      dialogTitle: 'report.pdf',
      UTI: 'com.adobe.pdf',
    });
  });

  it('copies an extensionless App Group image payload so the receiver can detect its format', async () => {
    await shareFile('file:///group/payloads/Image-ABCDEF', 'photo.jpg');

    expect(mockCopy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.stringMatching(tempFileUriFor('photo\\.jpg')) }),
      { overwrite: true }
    );
    expect(mockShareAsync).toHaveBeenCalledWith(expect.stringMatching(tempFileUriFor('photo\\.jpg')), {
      mimeType: 'image/*',
      dialogTitle: 'photo.jpg',
      UTI: 'public.image',
    });
  });

  it('sanitizes an unsafe file name before using it as the temp file name', async () => {
    await shareFile('file:///group/payloads/File-ABCDEF', 'weird?name*.txt');

    expect(mockCopy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: expect.stringMatching(tempFileUriFor('weird_name_\\.txt')) }),
      { overwrite: true }
    );
    expect(mockShareAsync).toHaveBeenCalledWith(
      expect.stringMatching(tempFileUriFor('weird_name_\\.txt')),
      expect.objectContaining({ mimeType: 'text/plain' })
    );
  });

  it('puts each share in its own temp subfolder so same-named shares cannot collide', async () => {
    await shareFile('file:///group/payloads/File-AAAA', 'image.jpg');
    await shareFile('file:///group/payloads/File-BBBB', 'image.jpg');

    expect(mockDirCreate).toHaveBeenCalledTimes(2);
    const destinations = mockCopy.mock.calls.map(([dest]) => (dest as { uri: string }).uri);
    expect(new Set(destinations).size).toBe(2);
  });

  it('skips the copy when the source file already has the right name', async () => {
    await shareFile('file:///cache/uniclip_diagnostics.json', 'uniclip_diagnostics.json');

    expect(mockCopy).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/uniclip_diagnostics.json', {
      mimeType: 'application/json',
      dialogTitle: 'uniclip_diagnostics.json',
      UTI: 'public.json',
    });
  });

  it('shares the raw URI directly when no file name is known', async () => {
    await shareFile('file:///group/payloads/File-ABCDEF');

    expect(mockCopy).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///group/payloads/File-ABCDEF',
      expect.objectContaining({ UTI: 'public.data' })
    );
  });
});
