/// <reference types="jest" />

import { strFromU8, unzipSync } from 'fflate';

const mockLogContents = new Map<string, string>();
const mockWrittenFiles = new Map<string, string | Uint8Array>();
const mockDeletedFiles: string[] = [];
const mockGetAppLogFileUris = jest.fn<string[], []>();
const mockGetEngineLogFileUris = jest.fn<string[], []>();
const mockGetShareDiagnostics = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '26.0' },
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '2.0.0',
  nativeBuildVersion: '177',
}));

jest.mock('../support/observability', () => ({
  getAppLogFileUris: () => mockGetAppLogFileUris(),
  getEngineLogFileUris: () => mockGetEngineLogFileUris(),
  redactLogText: jest.requireActual('../support/observability/internal/logRedaction').redactLogText,
}));

jest.mock('app-group-store', () => ({
  getShareDiagnostics: () => mockGetShareDiagnostics(),
}));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '')
        .split('/')
        .at(-1)!;
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : (part as { uri?: string })?.uri ?? ''))
        .join('/');
    }

    get exists() {
      return mockLogContents.has(this.uri) || mockWrittenFiles.has(this.uri);
    }

    get size() {
      const content = mockLogContents.get(this.uri) ?? mockWrittenFiles.get(this.uri) ?? '';
      return new TextEncoder().encode(content).byteLength;
    }

    async text() {
      const content = mockLogContents.get(this.uri) ?? mockWrittenFiles.get(this.uri);
      if (typeof content !== 'string') throw new Error('unreadable');
      return content;
    }

    slice(start = 0, end?: number) {
      const content = mockLogContents.get(this.uri);
      if (content === undefined) throw new Error('unreadable');
      return { text: async () => content.slice(start, end) };
    }

    write(content: string | Uint8Array) {
      mockWrittenFiles.set(this.uri, content);
    }

    delete() {
      mockWrittenFiles.delete(this.uri);
      mockDeletedFiles.push(this.uri);
    }
  }

  return {
    File: MockFile,
    Paths: { cache: 'file://cache' },
  };
});

import {
  createDiagnosticArchive,
  deleteDiagnosticArchive,
  DiagnosticArchiveError,
  type DiagnosticArchiveInput,
} from '../support/diagnostics';

const input: DiagnosticArchiveInput = {
  settings: {
    autoApplyRemote: true,
    autoPushLocal: false,
    attachmentAutoDownload: 'wifi',
    logLevel: 'info',
  },
  sync: {
    status: 'running',
    peerConnectionStatus: 'online',
    hasSpace: true,
    deviceCount: 4,
    lastErrorReason: null,
  },
};

function readArchive(uri: string): Record<string, string> {
  const bytes = mockWrittenFiles.get(uri);
  if (!(bytes instanceof Uint8Array)) throw new Error(`No ZIP archive was written at ${uri}`);
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, content]) => [name, strFromU8(content)])
  );
}

describe('DiagnosticArchive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogContents.clear();
    mockWrittenFiles.clear();
    mockDeletedFiles.length = 0;
    mockGetAppLogFileUris.mockReturnValue([]);
    mockGetEngineLogFileUris.mockReturnValue([]);
    mockGetShareDiagnostics.mockResolvedValue({ schemaVersion: 1, attempts: [] });
  });

  it('creates a ZIP containing redacted app logs, Engine logs, manifest, and Share attempts', async () => {
    const appUri = 'file://documents/logs/app_2026-08-16.txt';
    const engineUri = '/shared/p2p/cache/logs/engine.2026-08-16.txt';
    mockGetAppLogFileUris.mockReturnValue([appUri]);
    mockGetEngineLogFileUris.mockReturnValue([engineUri]);
    mockLogContents.set(appUri, '2026-08-16 11:00:00 ERROR: request failed token=app-secret\n');
    mockLogContents.set(
      engineUri,
      '2026-08-16T11:00:01Z INFO relay connected relay_url="https://relay.example.test" token="engine-secret"\n'
    );
    mockGetShareDiagnostics.mockResolvedValue({
      schemaVersion: 1,
      attempts: [{ id: 'attempt-a', events: [{ stage: 'failed', error: { code: 'timeout' } }] }],
    });

    const artifact = await createDiagnosticArchive(input, new Date('2026-08-16T11:32:31.000Z'));
    const archive = readArchive(artifact.uri);

    expect(artifact).toEqual({
      uri: 'file://cache/uniclip_diagnostics_2026-08-16_11-32-31.zip',
      fileName: 'uniclip_diagnostics_2026-08-16_11-32-31.zip',
    });
    expect(Object.keys(archive).sort()).toEqual([
      'extensions/share_attempts.json',
      'logs/app/app_2026-08-16.txt',
      'logs/engine/engine.2026-08-16.txt',
      'manifest.json',
    ]);
    expect(archive['logs/app/app_2026-08-16.txt']).toContain('request failed');
    expect(archive['logs/app/app_2026-08-16.txt']).not.toContain('app-secret');
    expect(archive['logs/engine/engine.2026-08-16.txt']).toContain(
      'relay_url="https://relay.example.test"'
    );
    expect(archive['logs/engine/engine.2026-08-16.txt']).not.toContain('engine-secret');
    expect(JSON.parse(archive['extensions/share_attempts.json'])).toEqual(
      expect.objectContaining({ attempts: [expect.objectContaining({ id: 'attempt-a' })] })
    );
    expect(JSON.parse(archive['manifest.json'])).toMatchObject({
      schemaVersion: 1,
      app: { version: '2.0.0', build: '177' },
      collection: {
        appLogs: { status: 'included', discoveredFileCount: 1, includedFileCount: 1 },
        engineLogs: { status: 'included', discoveredFileCount: 1, includedFileCount: 1 },
        shareAttempts: { status: 'included', attemptCount: 1 },
      },
    });
  });

  it('removes local file locations from archived logs', async () => {
    const appUri = 'file://documents/logs/app_2026-08-16.txt';
    const engineUri = '/shared/p2p/cache/logs/engine.2026-08-16.txt';
    mockGetAppLogFileUris.mockReturnValue([appUri]);
    mockGetEngineLogFileUris.mockReturnValue([engineUri]);
    mockLogContents.set(
      appUri,
      'INFO File saved to history storage: file:///private/var/mobile/Documents/payroll.xlsx\n'
    );
    mockLogContents.set(engineUri, 'INFO engine started\n');

    const artifact = await createDiagnosticArchive(input);
    const archive = readArchive(artifact.uri);

    expect(archive['logs/app/app_2026-08-16.txt']).not.toContain(
      'file:///private/var/mobile/Documents/payroll.xlsx'
    );
    expect(archive['logs/app/app_2026-08-16.txt']).toContain('[REDACTED]');
  });

  it('keeps only the tail of an oversized log and records the truncation', async () => {
    const appUri = 'file://documents/logs/app_2026-08-16.txt';
    const engineUri = '/shared/p2p/cache/logs/engine.2026-08-16.txt';
    mockGetAppLogFileUris.mockReturnValue([appUri]);
    mockGetEngineLogFileUris.mockReturnValue([engineUri]);
    mockLogContents.set(appUri, `discarded-prefix\n${'x'.repeat(512 * 1024)}\nretained-tail`);
    mockLogContents.set(engineUri, 'INFO engine started\n');

    const artifact = await createDiagnosticArchive(input);
    const archive = readArchive(artifact.uri);
    const manifest = JSON.parse(archive['manifest.json']);

    expect(archive['logs/app/app_2026-08-16.txt']).not.toContain('discarded-prefix');
    expect(archive['logs/app/app_2026-08-16.txt']).toContain('retained-tail');
    expect(manifest.collection.appLogs).toMatchObject({ truncatedFileCount: 1 });
  });

  it('refuses to claim success when a running Engine has no log files', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');

    await expect(createDiagnosticArchive(input)).rejects.toMatchObject<DiagnosticArchiveError>({
      code: 'engine_logs_missing',
    });
    expect(mockWrittenFiles.size).toBe(0);
  });

  it('refuses to claim success when every discovered Engine log is unreadable', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockGetEngineLogFileUris.mockReturnValue(['/shared/p2p/cache/logs/engine.2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');

    await expect(createDiagnosticArchive(input)).rejects.toMatchObject<DiagnosticArchiveError>({
      code: 'engine_logs_unreadable',
    });
    expect(mockWrittenFiles.size).toBe(0);
  });

  it('allows a stopped Engine to be reported as unavailable', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');

    const artifact = await createDiagnosticArchive({
      ...input,
      sync: { ...input.sync, status: 'stopped' },
    });
    const manifest = JSON.parse(readArchive(artifact.uri)['manifest.json']);

    expect(manifest.collection.engineLogs).toMatchObject({
      status: 'missing',
      discoveredFileCount: 0,
      includedFileCount: 0,
    });
  });

  it('deletes a generated archive explicitly', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockGetEngineLogFileUris.mockReturnValue(['/shared/p2p/cache/logs/engine.2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');
    mockLogContents.set('/shared/p2p/cache/logs/engine.2026-08-16.txt', 'engine log');
    const artifact = await createDiagnosticArchive(input);

    deleteDiagnosticArchive(artifact.uri);

    expect(mockDeletedFiles).toContain(artifact.uri);
    expect(mockWrittenFiles.has(artifact.uri)).toBe(false);
  });
});
