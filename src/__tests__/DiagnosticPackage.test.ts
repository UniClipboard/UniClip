/// <reference types="jest" />

import { strFromU8, unzipSync } from 'fflate';

const mockLogContents = new Map<string, string>();
const mockWrittenFiles = new Map<string, string | Uint8Array>();
const mockDeletedFiles: string[] = [];
const mockGetAppLogFileUris = jest.fn<string[], []>();
const mockGetEngineLogFileUris = jest.fn<string[], []>();
const mockGetShareDiagnostics = jest.fn();
const mockFlushAppLogs = jest.fn();
const mockFlushEngineLogs = jest.fn();
const mockGetEngineLogStatus = jest.fn();
const mockGetNativeDiagnostics = jest.fn();
const mockPrepareEngineDiagnosticExport = jest.fn();
jest.mock('uc-engine', () => ({
  prepareEngineDiagnosticExport: () => mockPrepareEngineDiagnosticExport(),
  flushEngineLogs: () => mockFlushEngineLogs(),
  getEngineLogStatus: () => mockGetEngineLogStatus(),
  getNativeDiagnostics: () => mockGetNativeDiagnostics(),
  coreVersion: () => "v1.1.0-test",
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '26.0' },
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '2.0.0',
  nativeBuildVersion: '177',
}));

jest.mock('../support/observability', () => ({
  getAppLogFileUris: () => mockGetAppLogFileUris(),
  flushAppLogs: () => mockFlushAppLogs(),
  getAppLogCaptureStatus: () => ({enabled: true, effectiveLevel: "info", filteredRecordCount: null}),
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
    mockPrepareEngineDiagnosticExport.mockReset().mockRejectedValue(new Error('old native module'));
    mockFlushEngineLogs.mockReset().mockResolvedValue(true);
    mockFlushAppLogs.mockReset().mockResolvedValue(true);
    mockGetNativeDiagnostics.mockReset().mockRejectedValue(new Error("native diagnostics unavailable"));
    mockGetEngineLogStatus.mockReset().mockResolvedValue({
      localFile: 'ready', droppedLocalRecords: 3,
      installation: { localFile: 'ready', droppedLocalRecords: 0 },
    });
    mockLogContents.clear();
    mockWrittenFiles.clear();
    mockDeletedFiles.length = 0;
    mockGetAppLogFileUris.mockReturnValue([]);
    mockGetEngineLogFileUris.mockReturnValue([]);
    mockGetShareDiagnostics.mockResolvedValue({ schemaVersion: 1, attempts: [] });
  });

  it.each(['completed', 'timedOut'])('exports the Engine report and existing files when flush is %s', async (flush) => {
    const report = { flush, requestedAtUtc: '2026-09-11T01:00:00Z', completedAtUtc: '2026-09-11T01:00:01Z', otherProcessesFlushed: false,
      status: { runId: 'run-one', capture: { mode: 'detailed', captureId: 'capture-one', remainingMs: 1000 }, engineVersion: 'new-engine', sourceCommit: 'a'.repeat(40), counterScope: 'typed_events_only', policyFilteredRecords: 7, observedRecords: 12, schemaRejectedRecords: 1, correlationLimitedRecords: 2, sources: [{source: 'connections', capability: 'supported', collection: 'enabled', observedCount: 12, policyFilteredCount: 7}], localFile: 'ready', closed: false },
      files: [{source: 'connections', acceptedCount: 5, writtenCount: 4, queueDroppedCount: 1, quotaDroppedCount: 0, writeFailedCount: 0, lastWrittenAtMs: 1000}] };
    mockPrepareEngineDiagnosticExport.mockImplementation(async () => {
      mockGetEngineLogFileUris.mockReturnValue(['/logs/new.jsonl']);
      mockLogContents.set('/logs/new.jsonl', '{"event":"new"}');
      return report;
    });
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    const manifest = JSON.parse(archive['manifest.json']);
    expect(manifest.collection.engineLogs.flushStatus).toBe(flush === 'completed' ? 'completed' : 'incomplete');
    expect(manifest.engineBuild.sourceRevision).toBe('a'.repeat(40));
    expect(manifest.collection.engineLogs.exportReport).toEqual(report);
    expect(manifest.collection.engineLogs.capturePolicy.filteredRecordCount).toBe(7);
    expect(manifest.coverage.complete).toBe(false);
    expect(mockFlushEngineLogs).not.toHaveBeenCalled();
    expect(archive['logs/engine/new.jsonl']).toContain('new');
  });

  it('waits for buffered records before discovering and reading Engine files', async () => {
    mockGetEngineLogFileUris.mockReturnValue(['/logs/old.jsonl']);
    mockLogContents.set('/logs/old.jsonl', 'old');
    let finishFlush!: () => void;
    mockFlushEngineLogs.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishFlush = () => {
        mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
        mockLogContents.set('/logs/engine.jsonl', '{"event":"authentication_failed"}');
        resolve(true);
      };
    }));
    const pending = createDiagnosticArchive(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFlushEngineLogs).toHaveBeenCalledTimes(1);
    expect(mockGetEngineLogFileUris).not.toHaveBeenCalled();
    finishFlush();
    const archive = readArchive((await pending).uri);
    expect(archive['logs/engine/engine.jsonl']).toContain('authentication_failed');
    expect(JSON.parse(archive['manifest.json']).collection.engineLogs).toMatchObject({
      flushStatus: 'completed', localFile: 'ready', droppedLocalRecords: 3,
      installation: { localFile: 'ready', droppedLocalRecords: 0 },
    });
  });

  it.each(['incomplete', 'unavailable'])('keeps existing evidence when flush is %s', async (status) => {
    if (status === 'incomplete') mockFlushEngineLogs.mockResolvedValue(false);
    else mockFlushEngineLogs.mockRejectedValue(new Error('private native error'));
    mockGetEngineLogStatus.mockRejectedValue(new Error('private status error'));
    mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
    mockLogContents.set('/logs/engine.jsonl', 'connection_timeout');
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(archive['logs/engine/engine.jsonl']).toContain('connection_timeout');
    expect(JSON.parse(archive['manifest.json']).collection.engineLogs).toMatchObject({
      flushStatus: status, localFile: 'unavailable', droppedLocalRecords: null,
    });
    expect(archive['manifest.json']).not.toContain('private');
  });

  it('exports app evidence even if Engine flush fails before any Engine file exists', async () => {
    mockFlushEngineLogs.mockRejectedValue(new Error('not installed'));
    mockGetAppLogFileUris.mockReturnValue(['/logs/app.txt']);
    mockLogContents.set('/logs/app.txt', 'startup failed');
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(archive['logs/app/app.txt']).toContain('startup failed');
    expect(JSON.parse(archive['manifest.json']).collection.engineLogs).toMatchObject({
      flushStatus: 'unavailable', status: 'missing',
    });
  });

  it('exports installation failure even when an empty writer reports a completed flush', async () => {
    mockGetEngineLogStatus.mockResolvedValue({
      localFile: 'unavailable', droppedLocalRecords: 0,
      installation: { localFile: 'unavailable', droppedLocalRecords: 0 },
    });
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(JSON.parse(archive['manifest.json']).collection.engineLogs).toMatchObject({
      flushStatus: 'completed', status: 'missing', localFile: 'unavailable',
      installation: { localFile: 'unavailable', droppedLocalRecords: 0 },
    });
  });

  it('does not collect or publish after cancellation during flush', async () => {
    const controller = new AbortController();
    mockFlushEngineLogs.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    await expect(createDiagnosticArchive(input, new Date(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockGetEngineLogFileUris).not.toHaveBeenCalled();
    expect(mockWrittenFiles.size).toBe(0);
  });

  it('exports native runtime records and distinguishes coverage from file inclusion', async () => {
    mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
    mockLogContents.set('/logs/engine.jsonl', '{"timestamp":"2026-09-10T11:00:00.000Z","target":"uc.telemetry"}');
    const nativeUri = '/private/shared/native-runtime.main.00000000-0000-0000-0000-000000000001.0.jsonl';
    mockLogContents.set(nativeUri, JSON.stringify({
      schemaVersion: 1, role: 'main', sessionId: '00000000-0000-0000-0000-000000000001',
      timestamp: '2026-09-10T11:00:00.000Z', event: 'engine.start', outcome: 'failed',
      failure: {reason: 'engineFailure', code: 1214},
    }) + '\n');
    mockGetNativeDiagnostics.mockResolvedValue({
      flushStatus: 'completed', discoveryStatus: 'completed', skippedFileCount: 0, fileUris: [nativeUri], writer: {
        writerStatus: 'ready', policy: 'native-runtime-boundaries-v1', effectiveLevel: 'info',
        droppedRecords: 0, writeFailures: 0, prunedFiles: 0, role: 'main',
        sessionId: '00000000-0000-0000-0000-000000000001',
        startedAt: '2026-09-10T11:00:00.000Z', capturedAt: '2026-09-10T11:00:01.000Z',
        retentionDays: 3, maxFileBytes: 262144, maxFiles: 24,
      },
    });
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(archive['logs/native/' + nativeUri.split('/').at(-1)]).toContain('engineFailure');
    const manifest = JSON.parse(archive['manifest.json']);
    expect(manifest.collection.nativeLogs).toMatchObject({
      status: 'included', flushStatus: 'completed', includedFileCount: 1,
      sources: {main: {status: 'included', recordCount: 1}, keyboard: {status: 'noRetainedEvents'}},
    });
    expect(manifest.collection.engineLogs.capturePolicy).toMatchObject({
      status: 'notReportedByEngine', filteredRecordCount: null,
    });
    expect(manifest.coverage).toMatchObject({complete: false, systemLogs: 'notCollected'});
    expect(archive['manifest.json']).not.toContain('/private/shared');
  });

  it('keeps other evidence when native collection is unavailable', async () => {
    mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
    mockLogContents.set('/logs/engine.jsonl', 'engine evidence');
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(JSON.parse(archive['manifest.json']).collection.nativeLogs).toMatchObject({
      metadataStatus: 'unavailable', flushStatus: 'unavailable', status: 'missing',
    });
    expect(archive['logs/engine/engine.jsonl']).toBe('engine evidence');
  });

  it('flushes app files before discovery and excludes unreviewed legacy native text', async () => {
    mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
    mockLogContents.set('/logs/engine.jsonl', 'engine evidence');
    mockFlushAppLogs.mockImplementation(async () => {
      mockGetAppLogFileUris.mockReturnValue(['/logs/app_2026-09-10.txt', '/logs/kotlin_2026-09-10.txt']);
      mockLogContents.set('/logs/app_2026-09-10.txt', 'fresh app failure');
      mockLogContents.set('/logs/kotlin_2026-09-10.txt', 'unreviewed private error payload');
      return true;
    });
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(archive['logs/app/app_2026-09-10.txt']).toContain('fresh app failure');
    expect(archive['logs/app/kotlin_2026-09-10.txt']).toBeUndefined();
    expect(JSON.parse(archive['manifest.json']).collection.appLogs).toMatchObject({
      flushStatus: 'completed', excludedLegacyNativeFileCount: 1,
    });
  });

  it('exports other sources when share attempt collection fails', async () => {
    mockGetShareDiagnostics.mockRejectedValue(new Error('private native error'));
    mockGetEngineLogFileUris.mockReturnValue(['/logs/engine.jsonl']);
    mockLogContents.set('/logs/engine.jsonl', 'retained evidence');
    const archive = readArchive((await createDiagnosticArchive(input)).uri);
    expect(archive['logs/engine/engine.jsonl']).toBe('retained evidence');
    expect(JSON.parse(archive['manifest.json']).collection.shareAttempts.sourceState).toBe('unavailable');
    expect(archive['manifest.json']).not.toContain('private native error');
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

  it('keeps available evidence and flags missing Engine files', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');

    const manifest = JSON.parse(readArchive((await createDiagnosticArchive(input)).uri)['manifest.json']);
    expect(manifest.collection.engineLogs.issues).toContain('engine_logs_missing');
    expect(manifest.coverage.complete).toBe(false);
  });

  it('keeps available evidence and flags unreadable Engine files', async () => {
    mockGetAppLogFileUris.mockReturnValue(['file://documents/logs/app_2026-08-16.txt']);
    mockGetEngineLogFileUris.mockReturnValue(['/shared/p2p/cache/logs/engine.2026-08-16.txt']);
    mockLogContents.set('file://documents/logs/app_2026-08-16.txt', 'app log');

    const manifest = JSON.parse(readArchive((await createDiagnosticArchive(input)).uri)['manifest.json']);
    expect(manifest.collection.engineLogs.issues).toContain('engine_logs_unreadable');
    expect(manifest.collection.engineLogs.unreadableFileCount).toBe(1);
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
