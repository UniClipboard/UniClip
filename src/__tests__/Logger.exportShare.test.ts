/// <reference types="jest" />

const mockExistingLocalUris = new Set<string>();
const mockZipFiles = jest.fn(
  async (_fileUris: string[], destUri: string, _signal?: AbortSignal) => {
    mockExistingLocalUris.add(destUri);
  }
);
const mockCopyFile = jest.fn(async (_srcUri: string, _destUri: string) => undefined);
const mockRequestDirectoryPermissions = jest.fn(async () => ({
  granted: true,
  directoryUri: 'content://exports',
}));
const mockCreateFile = jest.fn(
  async (_directoryUri: string, _fileName: string, _mimeType: string) =>
    'content://exports/logs.zip'
);
const mockDeleteFile = jest.fn(async (_fileUri: string) => undefined);
let mockExportLastModified = Date.now();
const mockDeletedLocalUris: string[] = [];

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('android-util', () => ({
  nativeZipFiles: (fileUris: string[], destUri: string, signal?: AbortSignal) =>
    mockZipFiles(fileUris, destUri, signal),
  nativeCopyFile: (srcUri: string, destUri: string) => mockCopyFile(srcUri, destUri),
}));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    exists = true;
    uri: string;
    name: string;

    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : ((part as { uri?: string })?.uri ?? '')))
        .join('/');
    }

    create = jest.fn();
    list = jest.fn(() => {
      if (this.name === 'logs') {
        return [new MockFile(this, 'app_2026-07-16.txt')];
      }
      if (this.name === 'log_exports') {
        return [new MockFile(this, 'logs_old.zip')];
      }
      return [];
    });
  }

  class MockFile {
    lastModified: number | null;
    uri: string;
    name: string;

    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : ((part as { uri?: string })?.uri ?? '')))
        .join('/');
      this.lastModified = this.name === 'logs_old.zip' ? mockExportLastModified : null;
    }

    get exists() {
      return mockExistingLocalUris.has(this.uri);
    }

    delete = jest.fn(() => {
      mockExistingLocalUris.delete(this.uri);
      mockDeletedLocalUris.push(this.uri);
    });
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: {
      document: 'file://documents',
      cache: 'file://cache',
    },
  };
});

jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: (fileUri: string) => mockDeleteFile(fileUri),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: () => mockRequestDirectoryPermissions(),
    createFileAsync: (directoryUri: string, fileName: string, mimeType: string) =>
      mockCreateFile(directoryUri, fileName, mimeType),
  },
}));

import * as LoggerService from '../services/Logger';

describe('Logger shareable export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistingLocalUris.clear();
    mockDeletedLocalUris.length = 0;
    mockExportLastModified = Date.now();
  });

  it('creates a shareable app-local ZIP without opening the SAF picker', async () => {
    const result = await LoggerService.createLogArchive();

    expect(mockRequestDirectoryPermissions).not.toHaveBeenCalled();
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(mockZipFiles).toHaveBeenCalledWith(
      ['file://documents/logs/app_2026-07-16.txt'],
      expect.stringMatching(/^file:\/\/cache\/log_exports\/logs_.+\.zip$/),
      undefined
    );
    expect(result).toEqual({
      uri: mockZipFiles.mock.calls[0][1],
      fileName: expect.stringMatching(/^logs_.+\.zip$/),
    });
  });

  it('copies a temporary ZIP to the user-selected SAF folder', async () => {
    const result = await LoggerService.saveLogsToFile();

    expect(mockZipFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateFile.mock.invocationCallOrder[0]
    );
    const localUri = mockZipFiles.mock.calls[0][1];
    expect(mockCopyFile).toHaveBeenCalledWith(localUri, 'content://exports/logs.zip');
    expect(mockDeletedLocalUris).toContain(localUri);
    expect(result).toBeUndefined();
  });

  it('deletes expired share archives before creating another archive', async () => {
    mockExportLastModified = 1_000;

    await LoggerService.createLogArchive();

    expect(mockDeletedLocalUris).toContain('file://cache/log_exports/logs_old.zip');
  });

  it('treats dismissing the SAF picker as cancellation', async () => {
    mockRequestDirectoryPermissions.mockResolvedValueOnce({
      granted: false,
      directoryUri: '',
    });

    await expect(LoggerService.saveLogsToFile()).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockZipFiles).not.toHaveBeenCalled();
  });

  it('removes the SAF document when cancellation happens during copy', async () => {
    const abortController = new AbortController();
    mockCopyFile.mockImplementationOnce(async () => {
      abortController.abort();
    });

    await expect(LoggerService.saveLogsToFile(abortController.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockDeleteFile).toHaveBeenCalledWith('content://exports/logs.zip');
  });
});
