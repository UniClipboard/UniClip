/// <reference types="jest" />

const mockLogContents = new Map<string, string>();
const mockWrittenFiles = new Map<string, string>();
const mockDeletedFiles: string[] = [];
const mockGetLogFileUris = jest.fn<string[], []>();
const mockGetShareDiagnostics = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '26.0' },
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.3.0',
  nativeBuildVersion: '162',
}));

jest.mock('../support/observability', () => ({
  getLogFileUris: () => mockGetLogFileUris(),
}));

jest.mock('app-group-store', () => ({
  getShareDiagnostics: () => mockGetShareDiagnostics(),
}));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: unknown[]) {
      this.name = String(parts[parts.length - 1] ?? '');
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
      const content = mockLogContents.get(this.uri);
      if (content === undefined) throw new Error('unreadable');
      return content;
    }

    slice(start = 0, end?: number) {
      const content = mockLogContents.get(this.uri);
      if (content === undefined) throw new Error('unreadable');
      return { text: async () => content.slice(start, end) };
    }

    write(content: string | Uint8Array) {
      mockWrittenFiles.set(this.uri, String(content));
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
  createDiagnosticPackage,
  deleteDiagnosticPackage,
  summarizeDiagnosticLogs,
  type DiagnosticPackageInput,
} from '../support/diagnostics';

function readWrittenPayload(uri: string): Record<string, unknown> {
  const content = mockWrittenFiles.get(uri);
  if (!content) throw new Error(`No diagnostic package was written at ${uri}`);
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Diagnostic package is not valid JSON: ${String(error)}`);
  }
}

const input: DiagnosticPackageInput = {
  settings: {
    autoApplyRemote: true,
    autoPushLocal: false,
    attachmentAutoDownload: 'wifi',
    logLevel: 'info',
  },
  sync: {
    status: 'running',
    peerConnectionStatus: 'offline',
    hasSpace: true,
    deviceCount: 2,
    lastErrorReason: 'network_unreachable',
  },
};

describe('DiagnosticPackage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogContents.clear();
    mockWrittenFiles.clear();
    mockDeletedFiles.length = 0;
    mockGetShareDiagnostics.mockResolvedValue({ schemaVersion: 1, attempts: [] });
  });

  it('derives useful log telemetry without retaining raw messages', () => {
    const rawLogs = [
      '2026-07-17 10:00:00 INFO: [P2pClipboardObserver] Clipboard observation failed; kept local: https://user:secret@example.test/private',
      '2026-07-17 10:00:01 INFO: [P2pClipboardObserver] Clipboard observation failed; kept local: https://example.test/retry',
      '2026-07-17 10:00:02 ERROR: [UnifiedEngineService] Failed to start the P2P engine: NetworkUnreachable hunter2',
      '2026-07-17 10:00:03 WARN: [HistoryStorage] Failed to move file to history directory: permission denied for /private/user/document.txt',
      '2026-07-17 10:00:04 DEBUG: unscoped plaintext should not survive',
      'not a log line containing another-secret',
    ].join('\n');

    const summary = summarizeDiagnosticLogs([rawLogs]);
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      fileCount: 1,
      unreadableFileCount: 0,
      parsedEntryCount: 5,
      unparsedLineCount: 1,
      byLevel: { debug: 1, info: 2, warn: 1, error: 1 },
      byComponent: {
        general: 1,
        HistoryStorage: 1,
        P2pClipboardObserver: 2,
        UnifiedEngineService: 1,
      },
    });
    expect(summary).toMatchObject({
      eventSummary: {
        classifiedEventCount: 4,
        unclassifiedIssueCount: 0,
        byEventCode: {
          'history.file_move_failed': 1,
          'p2p.clipboard_observation_failed': 2,
          'p2p.engine_start_failed': 1,
        },
        byReason: {
          network_unreachable: 1,
          permission_denied: 1,
        },
        recentEvents: [
          {
            firstAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
            lastAt: new Date(2026, 6, 17, 10, 0, 1).toISOString(),
            occurrences: 2,
            level: 'info',
            component: 'P2pClipboardObserver',
            eventCode: 'p2p.clipboard_observation_failed',
            reason: null,
          },
          {
            firstAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
            lastAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
            occurrences: 1,
            level: 'error',
            component: 'UnifiedEngineService',
            eventCode: 'p2p.engine_start_failed',
            reason: 'network_unreachable',
          },
          {
            firstAt: new Date(2026, 6, 17, 10, 0, 3).toISOString(),
            lastAt: new Date(2026, 6, 17, 10, 0, 3).toISOString(),
            occurrences: 1,
            level: 'warn',
            component: 'HistoryStorage',
            eventCode: 'history.file_move_failed',
            reason: 'permission_denied',
          },
        ],
      },
    });
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain('document.txt');
    expect(serialized).not.toContain('plaintext');
  });

  it('keeps unclassified issues as boundaries between repeated events', () => {
    const summary = summarizeDiagnosticLogs([
      [
        '2026-07-17 10:00:00 INFO: [P2pClipboardObserver] Clipboard observation failed; kept local: one',
        '2026-07-17 10:00:01 ERROR: arbitrary private issue with no safe category',
        '2026-07-17 10:00:02 INFO: [P2pClipboardObserver] Clipboard observation failed; kept local: two',
      ].join('\n'),
    ]);

    expect(summary.eventSummary.unclassifiedIssueCount).toBe(1);
    expect(summary.eventSummary.recentEvents).toEqual([
      expect.objectContaining({
        firstAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
        lastAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
        occurrences: 1,
        eventCode: 'p2p.clipboard_observation_failed',
      }),
      expect.objectContaining({
        firstAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
        lastAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
        occurrences: 1,
        eventCode: 'p2p.clipboard_observation_failed',
      }),
    ]);
  });

  it('writes an allowlisted JSON package to cache', async () => {
    const logUri = 'file://documents/logs/app_2026-07-17.txt';
    mockGetLogFileUris.mockReturnValue([logUri]);
    mockLogContents.set(
      logUri,
      '2026-07-17 10:00:01 ERROR: [UnifiedEngineService] Failed to start the P2P engine: unauthorized https://alice:password@example.test'
    );

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);
    const serialized = JSON.stringify(payload);

    expect(artifact).toEqual({
      uri: 'file://cache/uniclip_diagnostics_2026-07-17_10-30-00.json',
      fileName: 'uniclip_diagnostics_2026-07-17_10-30-00.json',
    });
    expect(payload).toEqual({
      schemaVersion: 3,
      generatedAt: '2026-07-17T10:30:00.000Z',
      app: { version: '1.3.0', build: '162' },
      system: { platform: 'ios', osVersion: '26.0' },
      settings: input.settings,
      sync: input.sync,
      logs: expect.objectContaining({
        fileCount: 1,
        parsedEntryCount: 1,
        byLevel: { debug: 0, info: 0, warn: 0, error: 1 },
        byComponent: { UnifiedEngineService: 1 },
        eventSummary: expect.objectContaining({
          byEventCode: { 'p2p.engine_start_failed': 1 },
          byReason: { authentication: 1 },
        }),
      }),
      extensions: {
        share: { schemaVersion: 1, attempts: [] },
      },
      coverage: {
        rawMessagesIncluded: false,
        nativeExtensionLogsIncluded: true,
        eventClassification: 'fixed_events_and_categorized_reasons_v1',
      },
    });
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain(logUri);
  });

  it('exports correlated Share attempts without raw extension messages', async () => {
    mockGetLogFileUris.mockReturnValue([]);
    mockGetShareDiagnostics.mockResolvedValue({
      schemaVersion: 1,
      attempts: [
        {
          id: 'attempt-a',
          startedAtMs: 1_000,
          channel: 'p2p',
          itemKind: 'file',
          byteCount: 20 * 1024 * 1024,
          events: [
            {
              timestampMs: 1_100,
              elapsedMs: 100,
              stage: 'peer_refresh',
              peerRefresh: { total: 1, online: 0, offline: 1, errors: 0 },
            },
            {
              timestampMs: 1_120,
              elapsedMs: 120,
              stage: 'failed',
              error: { code: 'receiver_offline' },
            },
          ],
        },
      ],
    });

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);

    expect(payload.extensions).toEqual({
      share: expect.objectContaining({
        schemaVersion: 1,
        attempts: [expect.objectContaining({ id: 'attempt-a', channel: 'p2p' })],
      }),
    });
    expect(payload.coverage).toMatchObject({ nativeExtensionLogsIncluded: true });
  });

  it('counts unreadable log files without exposing their paths', async () => {
    mockGetLogFileUris.mockReturnValue(['file://documents/logs/unreadable.txt']);

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);

    expect(payload.logs).toMatchObject({ fileCount: 1, unreadableFileCount: 1 });
    expect(JSON.stringify(payload)).not.toContain('unreadable.txt');
  });

  it('samples only the tail of oversized logs', async () => {
    const logUri = 'file://documents/logs/oversized.txt';
    const discardedPrefix = `discarded-sensitive-value\n${'x'.repeat(512 * 1024)}`;
    const retainedIssue =
      '2026-07-17 10:00:01 ERROR: [UnifiedEngineService] Failed to start the P2P engine: timeout without exported details';
    mockGetLogFileUris.mockReturnValue([logUri]);
    mockLogContents.set(logUri, `${discardedPrefix}\n${retainedIssue}`);

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);
    const serialized = JSON.stringify(payload);

    expect(payload.logs).toMatchObject({
      fileCount: 1,
      truncatedFileCount: 1,
      byteCount: 512 * 1024,
      byComponent: { UnifiedEngineService: 1 },
    });
    expect(serialized).not.toContain('discarded-sensitive-value');
    expect(serialized).not.toContain('without exported details');
  });

  it('deletes a generated package explicitly', async () => {
    mockGetLogFileUris.mockReturnValue([]);
    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));

    deleteDiagnosticPackage(artifact.uri);

    expect(mockDeletedFiles).toContain(artifact.uri);
    expect(mockWrittenFiles.has(artifact.uri)).toBe(false);
  });
});
