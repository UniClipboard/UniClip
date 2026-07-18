/// <reference types="jest" />

const mockLogContents = new Map<string, string>();
const mockWrittenFiles = new Map<string, string>();
const mockDeletedFiles: string[] = [];
const mockGetLogFileUris = jest.fn<string[], []>();

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '26.0' },
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.3.0',
  nativeBuildVersion: '162',
}));

jest.mock('../services/Logger', () => ({
  getLogFileUris: () => mockGetLogFileUris(),
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
} from '../services/DiagnosticPackage';

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
    configuredServerCount: 2,
    activeServerConfigured: true,
    activeServerType: 'syncclipboard',
    activeServerAddressCount: 2,
    trustInsecureCert: false,
    autoApplyRemote: true,
    autoPushLocal: false,
    enableSse: true,
    attachmentAutoDownload: 'wifi',
    logLevel: 'info',
  },
  sync: {
    isRunning: true,
    state: 'OfflineRetrying',
    isExplicitlyRefreshing: false,
    hasStagedEntry: false,
    lastSyncedAt: 1_784_240_000_000,
    lastErrorReason: 'network_unreachable',
  },
};

describe('DiagnosticPackage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogContents.clear();
    mockWrittenFiles.clear();
    mockDeletedFiles.length = 0;
  });

  it('derives useful log telemetry without retaining raw messages', () => {
    const rawLogs = [
      '2026-07-17 10:00:00 INFO: 2026-07-17T02:00:00.000Z | INFO : [SyncEngine] SSE subscribing to https://user:secret@example.test/private',
      '2026-07-17 10:00:01 INFO: [SyncEngine] SSE subscribing to https://example.test/retry',
      '2026-07-17 10:00:02 ERROR: [SyncEngine] op error: NetworkUnreachable while sending clipboard payload hunter2',
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
      byComponent: { general: 1, HistoryStorage: 1, SyncEngine: 3 },
    });
    expect(summary).toMatchObject({
      eventSummary: {
        classifiedEventCount: 4,
        unclassifiedIssueCount: 0,
        byEventCode: {
          'history.file_move_failed': 1,
          'sync.operation_failed': 1,
          'sync.sse_subscribing': 2,
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
            component: 'SyncEngine',
            eventCode: 'sync.sse_subscribing',
            reason: null,
          },
          {
            firstAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
            lastAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
            occurrences: 1,
            level: 'error',
            component: 'SyncEngine',
            eventCode: 'sync.operation_failed',
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
        '2026-07-17 10:00:00 INFO: [SyncEngine] SSE subscribing to https://example.test/one',
        '2026-07-17 10:00:01 ERROR: arbitrary private issue with no safe category',
        '2026-07-17 10:00:02 INFO: [SyncEngine] SSE subscribing to https://example.test/two',
      ].join('\n'),
    ]);

    expect(summary.eventSummary.unclassifiedIssueCount).toBe(1);
    expect(summary.eventSummary.recentEvents).toEqual([
      expect.objectContaining({
        firstAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
        lastAt: new Date(2026, 6, 17, 10, 0, 0).toISOString(),
        occurrences: 1,
        eventCode: 'sync.sse_subscribing',
      }),
      expect.objectContaining({
        firstAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
        lastAt: new Date(2026, 6, 17, 10, 0, 2).toISOString(),
        occurrences: 1,
        eventCode: 'sync.sse_subscribing',
      }),
    ]);
  });

  it('writes an allowlisted JSON package to cache', async () => {
    const logUri = 'file://documents/logs/app_2026-07-17.txt';
    mockGetLogFileUris.mockReturnValue([logUri]);
    mockLogContents.set(
      logUri,
      '2026-07-17 10:00:01 ERROR: [SyncEngine] op error (auth): unauthorized https://alice:password@example.test'
    );

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);
    const serialized = JSON.stringify(payload);

    expect(artifact).toEqual({
      uri: 'file://cache/uniclip_diagnostics_2026-07-17_10-30-00.json',
      fileName: 'uniclip_diagnostics_2026-07-17_10-30-00.json',
    });
    expect(payload).toEqual({
      schemaVersion: 2,
      generatedAt: '2026-07-17T10:30:00.000Z',
      app: { version: '1.3.0', build: '162' },
      system: { platform: 'ios', osVersion: '26.0' },
      settings: input.settings,
      sync: input.sync,
      logs: expect.objectContaining({
        fileCount: 1,
        parsedEntryCount: 1,
        byLevel: { debug: 0, info: 0, warn: 0, error: 1 },
        byComponent: { SyncEngine: 1 },
        eventSummary: expect.objectContaining({
          byEventCode: { 'sync.authentication_failed': 1 },
          byReason: { authentication: 1 },
        }),
      }),
      coverage: {
        rawMessagesIncluded: false,
        nativeExtensionLogsIncluded: false,
        eventClassification: 'fixed_events_and_categorized_reasons_v1',
      },
    });
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain(logUri);
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
      '2026-07-17 10:00:01 ERROR: [SyncEngine] op error: timeout without exported details';
    mockGetLogFileUris.mockReturnValue([logUri]);
    mockLogContents.set(logUri, `${discardedPrefix}\n${retainedIssue}`);

    const artifact = await createDiagnosticPackage(input, new Date('2026-07-17T10:30:00.000Z'));
    const payload = readWrittenPayload(artifact.uri);
    const serialized = JSON.stringify(payload);

    expect(payload.logs).toMatchObject({
      fileCount: 1,
      truncatedFileCount: 1,
      byteCount: 512 * 1024,
      byComponent: { SyncEngine: 1 },
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
