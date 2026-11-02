import { randomUUID } from 'expo-crypto';
import { createLogger } from '@/support/observability';
import type { ClipboardItem } from '@/types/clipboard';

const log = createLogger('HistoryLatency');
const sessionId = randomUUID();
const contexts = new Map<string, FileReadTrace>();
const hashReads = new Map<string, Set<string>>();
const MAX_CONTEXTS = 128;
const CONTEXT_TTL_MS = 10 * 60 * 1000;

export interface FileReadTrace {
  readonly readId: string;
  sourceEntryId: string | null;
  readonly startedMs: number;
  hash?: string;
  committed?: boolean;
  published?: 'optimistic' | 'committed';
  visible?: boolean;
}

type Stage = 'monitor_started' | 'file_identity' | 'file_read' | 'source_copy' | 'sha256' | 'history_lookup' |
  'monitor_persist' | 'debounce' | 'monitor_callback' | 'monitor_discarded' |
  'history_admission' | 'history_queue' | 'payload_import' | 'sqlite_commit' |
  'history_notify' | 'history_published' | 'history_viewable' | 'history_frame_candidate' |
  'engine_event_js' | 'sender_report' | 'sender_settled' | 'sender_ui_state';
type Fields = {
  outcome?: 'started' | 'succeeded' | 'failed' | 'observed' | 'superseded';
  durationMs?: number;
  bytes?: number;
  delayMs?: number;
  entryId?: string | null;
  attemptId?: string | null;
  state?: string;
  eventType?: string;
  nativeReturnedAtMs?: number;
  nativeUptimeMs?: number;
  completed?: number;
  pending?: number;
  failed?: number;
};

/** Local archive only. Never pass content, paths, names, peers, or file hashes. */
export function recordHistoryLatency(stage: Stage, trace?: FileReadTrace, fields: Fields = {}): void {
  try {
    log.info(`history_latency ${JSON.stringify({
      schemaVersion: 1, sessionId, stage, timestamp: new Date().toISOString(),
      monotonicMs: performance.now(), readId: trace?.readId ?? null,
      sourceEntryId: trace?.sourceEntryId ?? null, ...fields,
    })}`);
  } catch {
    // Diagnostics cannot change the outcome of a product operation.
  }
}

/** The pinned Engine puts a source entry UUID in its default file cache path.
 * A custom receive directory has no such identity. Never infer it from a filename.
 */
export function beginFileRead(sourceUri?: string): FileReadTrace {
  const trace: FileReadTrace = {
    readId: randomUUID(), sourceEntryId: null,
    startedMs: performance.now(),
  };
  if (sourceUri) identifyFileRead(trace, sourceUri);
  recordHistoryLatency('file_read', trace, { outcome: 'started' });
  return trace;
}

/** Bind the source actually copied, because the clipboard can change during a read. */
export function identifyFileRead(trace: FileReadTrace, sourceUri: string): void {
  const match = sourceUri.match(/\/iroh-blobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
  trace.sourceEntryId = match?.[1].toLowerCase() ?? null;
  recordHistoryLatency('file_identity', trace, {
    outcome: 'observed', state: trace.sourceEntryId ? 'engine_cache_path' : 'unmatched',
  });
}

function removeContext(readId: string, trace: FileReadTrace): void {
  contexts.delete(readId);
  if (!trace.hash) return;
  const reads = hashReads.get(trace.hash);
  reads?.delete(readId);
  if (reads?.size === 0) hashReads.delete(trace.hash);
}

export function bindFileRead(trace: FileReadTrace, hash: string): void {
  trace.hash = hash.toUpperCase();
  contexts.set(trace.readId, trace);
  const reads = hashReads.get(trace.hash) ?? new Set<string>();
  reads.add(trace.readId);
  hashReads.set(trace.hash, reads);
  const now = performance.now();
  for (const [id, context] of contexts) {
    if (now - context.startedMs > CONTEXT_TTL_MS || contexts.size > MAX_CONTEXTS) removeContext(id, context);
  }
}

export function fileReadTrace(hash?: string, readId?: string): FileReadTrace | undefined {
  if (!hash) return;
  const key = hash.toUpperCase();
  const reads = hashReads.get(key);
  // A reloaded row loses its transient read ID. Never guess between duplicate reads.
  const id = readId ?? (reads?.size === 1 ? reads.values().next().value : undefined);
  const trace = id ? contexts.get(id) : undefined;
  if (!trace || trace.hash !== key) return;
  if (performance.now() - trace.startedMs > CONTEXT_TTL_MS) {
    removeContext(trace.readId, trace);
    return;
  }
  return trace;
}

export async function measureHistoryStage<T>(
  stage: Stage, trace: FileReadTrace | undefined, operation: () => Promise<T>, fields: Fields = {},
): Promise<T> {
  if (!trace) return operation();
  const start = performance.now();
  recordHistoryLatency(stage, trace, { ...fields, outcome: 'started' });
  try {
    const result = await operation();
    recordHistoryLatency(stage, trace, { ...fields, outcome: 'succeeded', durationMs: performance.now() - start });
    return result;
  } catch (error) {
    recordHistoryLatency(stage, trace, { ...fields, outcome: 'failed', durationMs: performance.now() - start });
    throw error;
  }
}

export function recordHistoryPublished(items: ClipboardItem[]): void {
  for (const item of items) {
    const trace = fileReadTrace(item.localClipboardHash ?? item.profileHash, item.diagnosticReadId);
    if (!trace) continue;
    const state = trace.committed ? 'committed' : 'optimistic';
    if (trace.published === state) continue;
    trace.published = state;
    recordHistoryLatency('history_published', trace, { outcome: 'observed', state });
  }
}

export function recordHistoryViewable(item: ClipboardItem): FileReadTrace | undefined {
  const trace = fileReadTrace(item.localClipboardHash ?? item.profileHash, item.diagnosticReadId);
  if (!trace || trace.visible) return;
  trace.visible = true;
  recordHistoryLatency('history_viewable', trace, { outcome: 'observed', state: trace.committed ? 'committed' : 'optimistic' });
  return trace;
}
