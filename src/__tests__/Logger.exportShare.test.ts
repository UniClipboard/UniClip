/// <reference types="jest" />

const mockExistingLocalUris = new Set<string>();
const mockExistingDirectoryUris = new Set<string>([
  'file://documents/logs',
  'file://cache/log_exports',
]);
const mockFileContents = new Map<string, string>([
  [
    'file://documents/logs/app_2026-07-16.txt',
    '2026-07-16 12:00:00 ERROR: status=401 Authorization: Bearer historical-token password=historical-password',
  ],
]);
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
const mockDeletedDirectoryUris: string[] = [];

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
    uri: string;
    name: string;

    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '')
        .split('/')
        .at(-1)!;
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : ((part as { uri?: string })?.uri ?? '')))
        .join('/');
    }

    get exists() {
      return mockExistingDirectoryUris.has(this.uri);
    }

    create = jest.fn(() => {
      mockExistingDirectoryUris.add(this.uri);
    });
    delete = jest.fn(() => {
      mockExistingDirectoryUris.delete(this.uri);
      mockDeletedDirectoryUris.push(this.uri);
      for (const uri of [...mockExistingLocalUris]) {
        if (uri.startsWith(`${this.uri}/`)) mockExistingLocalUris.delete(uri);
      }
    });
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
      this.name = String(parts[parts.length - 1] ?? '')
        .split('/')
        .at(-1)!;
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : ((part as { uri?: string })?.uri ?? '')))
        .join('/');
      this.lastModified = this.name === 'logs_old.zip' ? mockExportLastModified : null;
    }

    get exists() {
      return mockExistingLocalUris.has(this.uri);
    }

    text = jest.fn(async () => mockFileContents.get(this.uri) ?? '');
    write = jest.fn((content: string) => {
      mockFileContents.set(this.uri, content);
      mockExistingLocalUris.add(this.uri);
    });

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
    mockExistingDirectoryUris.clear();
    mockExistingDirectoryUris.add('file://documents/logs');
    mockExistingDirectoryUris.add('file://cache/log_exports');
    mockFileContents.clear();
    mockFileContents.set(
      'file://documents/logs/app_2026-07-16.txt',
      '2026-07-16 12:00:00 ERROR: status=401 Authorization: Bearer historical-token password=historical-password'
    );
    mockDeletedLocalUris.length = 0;
    mockDeletedDirectoryUris.length = 0;
    mockExportLastModified = Date.now();
  });

  it('creates a shareable app-local ZIP without opening the SAF picker', async () => {
    const result = await LoggerService.createLogArchive();

    expect(mockRequestDirectoryPermissions).not.toHaveBeenCalled();
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(mockZipFiles).toHaveBeenCalledWith(
      [expect.stringMatching(/^file:\/\/cache\/log_exports\/sanitized_.+\/app_2026-07-16\.txt$/)],
      expect.stringMatching(/^file:\/\/cache\/log_exports\/logs_.+\.zip$/),
      undefined
    );
    const sanitizedUri = mockZipFiles.mock.calls[0][0][0];
    const sanitizedContent = mockFileContents.get(sanitizedUri);
    expect(sanitizedContent).toContain('status=401');
    expect(sanitizedContent).not.toContain('historical-token');
    expect(sanitizedContent).not.toContain('historical-password');
    expect(mockDeletedDirectoryUris).toContain(
      sanitizedUri.slice(0, sanitizedUri.lastIndexOf('/'))
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
