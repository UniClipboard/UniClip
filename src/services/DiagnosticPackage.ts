import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ServerConfig } from '@/types/api';
import type { SharedSettings } from '@/types/settings';
import type { SyncEngineState } from './SyncEngine';
import { classifyDiagnosticEvent, type DiagnosticReason } from './DiagnosticEventClassifier';
import { getLogFileUris } from './Logger';

const DIAGNOSTIC_SCHEMA_VERSION = 2;
const MAX_RECENT_EVENTS = 100;
const MAX_LOG_BYTES_PER_FILE = 512 * 1024;

const SAFE_COMPONENTS = new Set([
  'APIClient',
  'AppGroupHistoryImport',
  'AppGroupSync',
  'BackgroundServiceManager',
  'CacheManager',
  'ClipboardAccess',
  'ClipboardManager',
  'ClipboardMonitor',
  'ClipboardStore',
  'ClipboardSyncService',
  'ConfigStorage',
  'DB',
  'FileStorage',
  'HashUtils',
  'HistoryStorage',
  'HistoryTransferQueue',
  'HomeView',
  'NetworkContext',
  'S3Client',
  'SecureStorage',
  'SyncClipboardClient',
  'SyncEngine',
  'SyncEngineStore',
  'WebDAVClient',
]);

const LOG_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (DEBUG|INFO|WARN|ERROR)(?: \[[^\]]+\])?: (.*)$/;
const COMPONENT_PATTERN = /\[([A-Za-z][A-Za-z0-9]+)\]/;

type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';
type DiagnosticServerType = ServerConfig['type'];

export interface DiagnosticSettingsSnapshot {
  configuredServerCount: number;
  activeServerConfigured: boolean;
  activeServerType: DiagnosticServerType | null;
  activeServerAddressCount: number;
  trustInsecureCert: SharedSettings['trustInsecureCert'];
  autoApplyRemote: SharedSettings['autoApplyRemote'];
  autoPushLocal: SharedSettings['autoPushLocal'];
  enableSse: SharedSettings['enableSse'];
  attachmentAutoDownload: SharedSettings['attachmentAutoDownload'];
  logLevel: SharedSettings['logLevel'];
}

export interface DiagnosticSyncSnapshot {
  isRunning: boolean;
  state: SyncEngineState;
  isExplicitlyRefreshing: boolean;
  hasStagedEntry: boolean;
  lastSyncedAt: number | null;
  lastErrorReason: DiagnosticReason | null;
}

export interface DiagnosticPackageInput {
  settings: DiagnosticSettingsSnapshot;
  sync: DiagnosticSyncSnapshot;
}

export interface DiagnosticArtifact {
  uri: string;
  fileName: string;
}

export interface DiagnosticEvent {
  firstAt: string;
  lastAt: string;
  occurrences: number;
  level: DiagnosticLogLevel;
  component: string;
  eventCode: string;
  reason: DiagnosticReason | null;
}

interface ParsedDiagnosticEvent extends Omit<
  DiagnosticEvent,
  'firstAt' | 'lastAt' | 'occurrences'
> {
  kind: 'event';
  timestamp: string;
}

interface DiagnosticTimelineSeparator {
  kind: 'separator';
  timestamp: string;
}

type DiagnosticTimelineEntry = ParsedDiagnosticEvent | DiagnosticTimelineSeparator;

export interface DiagnosticEventSummary {
  classifiedEventCount: number;
  unclassifiedIssueCount: number;
  byEventCode: Record<string, number>;
  byReason: Partial<Record<DiagnosticReason, number>>;
  recentEvents: DiagnosticEvent[];
}

export interface DiagnosticLogSummary {
  fileCount: number;
  unreadableFileCount: number;
  truncatedFileCount: number;
  byteCount: number;
  parsedEntryCount: number;
  unparsedLineCount: number;
  firstEntryAt: string | null;
  lastEntryAt: string | null;
  byLevel: Record<DiagnosticLogLevel, number>;
  byComponent: Record<string, number>;
  eventSummary: DiagnosticEventSummary;
}

function formatFileTimestamp(date: Date): string {
  const [calendarDate, time] = date.toISOString().split('T');
  return `${calendarDate}_${time.replace(/:/g, '-').replace(/\.\d{3}Z$/, '')}`;
}

function parseLocalLogTimestamp(value: string): string | null {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeComponent(message: string): string {
  const component = message.match(COMPONENT_PATTERN)?.[1];
  if (!component) return 'general';
  return SAFE_COMPONENTS.has(component) ? component : 'other';
}

function incrementCounter(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function collapseConsecutiveEvents(entries: DiagnosticTimelineEntry[]): DiagnosticEvent[] {
  const collapsed: DiagnosticEvent[] = [];
  let canCollapseWithPrevious = false;
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      canCollapseWithPrevious = false;
      continue;
    }

    const previous = collapsed.at(-1);
    if (
      canCollapseWithPrevious &&
      previous &&
      previous.level === entry.level &&
      previous.component === entry.component &&
      previous.eventCode === entry.eventCode &&
      previous.reason === entry.reason
    ) {
      previous.lastAt = entry.timestamp;
      previous.occurrences += 1;
      continue;
    }
    collapsed.push({
      firstAt: entry.timestamp,
      lastAt: entry.timestamp,
      occurrences: 1,
      level: entry.level,
      component: entry.component,
      eventCode: entry.eventCode,
      reason: entry.reason,
    });
    canCollapseWithPrevious = true;
  }
  return collapsed;
}

export function summarizeDiagnosticLogs(
  contents: string[],
  fileCount = contents.length,
  unreadableFileCount = 0,
  truncatedFileCount = 0
): DiagnosticLogSummary {
  const byLevel: Record<DiagnosticLogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  const byComponent: Record<string, number> = {};
  const byEventCode: Record<string, number> = {};
  const byReason: Partial<Record<DiagnosticReason, number>> = {};
  const timelineEntries: DiagnosticTimelineEntry[] = [];
  let classifiedEventCount = 0;
  let unclassifiedIssueCount = 0;
  let byteCount = 0;
  let parsedEntryCount = 0;
  let unparsedLineCount = 0;
  let firstEntryAt: string | null = null;
  let lastEntryAt: string | null = null;

  for (const content of contents) {
    byteCount += new TextEncoder().encode(content).byteLength;
    for (const line of content.split('\n')) {
      if (line.length === 0) continue;
      const match = line.match(LOG_LINE_PATTERN);
      if (!match) {
        unparsedLineCount += 1;
        continue;
      }

      const level = match[2].toLowerCase() as DiagnosticLogLevel;
      const timestamp = parseLocalLogTimestamp(match[1]);
      const message = match[3];
      const component = safeComponent(message);
      const event = classifyDiagnosticEvent(message, level);

      parsedEntryCount += 1;
      byLevel[level] += 1;
      incrementCounter(byComponent, component);

      if (event) {
        classifiedEventCount += 1;
        incrementCounter(byEventCode, event.eventCode);
        if (event.reason) incrementCounter(byReason, event.reason);
        if (timestamp) {
          timelineEntries.push({ kind: 'event', timestamp, level, component, ...event });
        }
      } else if (level === 'warn' || level === 'error') {
        unclassifiedIssueCount += 1;
        if (timestamp) timelineEntries.push({ kind: 'separator', timestamp });
      }

      if (timestamp) {
        if (firstEntryAt === null || timestamp < firstEntryAt) firstEntryAt = timestamp;
        if (lastEntryAt === null || timestamp > lastEntryAt) lastEntryAt = timestamp;
      }
    }
  }

  timelineEntries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const recentEvents = collapseConsecutiveEvents(timelineEntries).slice(-MAX_RECENT_EVENTS);

  return {
    fileCount,
    unreadableFileCount,
    truncatedFileCount,
    byteCount,
    parsedEntryCount,
    unparsedLineCount,
    firstEntryAt,
    lastEntryAt,
    byLevel,
    byComponent: Object.fromEntries(
      Object.entries(byComponent).sort(([left], [right]) => left.localeCompare(right))
    ),
    eventSummary: {
      classifiedEventCount,
      unclassifiedIssueCount,
      byEventCode: Object.fromEntries(
        Object.entries(byEventCode).sort(([left], [right]) => left.localeCompare(right))
      ),
      byReason: Object.fromEntries(
        Object.entries(byReason).sort(([left], [right]) => left.localeCompare(right))
      ),
      recentEvents,
    },
  };
}

async function readDiagnosticLogs(): Promise<DiagnosticLogSummary> {
  const fileUris = getLogFileUris();
  const contents: string[] = [];
  let unreadableFileCount = 0;
  let truncatedFileCount = 0;

  for (const uri of fileUris) {
    try {
      const file = new File(uri);
      if (file.size > MAX_LOG_BYTES_PER_FILE) {
        contents.push(await file.slice(file.size - MAX_LOG_BYTES_PER_FILE).text());
        truncatedFileCount += 1;
      } else {
        contents.push(await file.text());
      }
    } catch {
      unreadableFileCount += 1;
    }
  }

  return summarizeDiagnosticLogs(
    contents,
    fileUris.length,
    unreadableFileCount,
    truncatedFileCount
  );
}

export async function createDiagnosticPackage(
  input: DiagnosticPackageInput,
  now = new Date()
): Promise<DiagnosticArtifact> {
  const fileName = `uniclip_diagnostics_${formatFileTimestamp(now)}.json`;
  const artifact = new File(Paths.cache, fileName);
  const payload = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    app: {
      version: Application.nativeApplicationVersion ?? 'unknown',
      build: Application.nativeBuildVersion ?? 'unknown',
    },
    system: {
      platform: Platform.OS,
      osVersion: String(Platform.Version),
    },
    settings: input.settings,
    sync: input.sync,
    logs: await readDiagnosticLogs(),
    coverage: {
      rawMessagesIncluded: false,
      nativeExtensionLogsIncluded: false,
      eventClassification: 'fixed_events_and_categorized_reasons_v1',
    },
  };

  try {
    if (artifact.exists) artifact.delete();
    artifact.write(`${JSON.stringify(payload, null, 2)}\n`);
    return { uri: artifact.uri, fileName };
  } catch (error) {
    if (artifact.exists) artifact.delete();
    throw error;
  }
}

export function deleteDiagnosticPackage(uri: string): void {
  try {
    const artifact = new File(uri);
    if (artifact.exists) artifact.delete();
  } catch {
    // Cache cleanup is best-effort and must never leave the diagnostics UI stuck.
  }
}
