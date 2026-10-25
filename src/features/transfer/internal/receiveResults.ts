import type {
  EngineEvent,
  EntryReceiveCancellation,
  ReceiveItem,
  ReceiveProgress,
  ReceiveRetryOutcome,
} from '@/platform/engine';
import { createLogger } from '@/support/observability';

const log = createLogger('ReceiveResults');

/**
 * Receiver-side results. The Engine owns blob scheduling, retry, cancellation and
 * settlement; this module only mirrors its snapshots and forwards user intent.
 * Events are invalidation signals: state is always read back from the Engine.
 */
export interface ReceiveResultsApi {
  listEntryReceiveProgress(): Promise<ReceiveProgress[]>;
  queryEntryReceiveProgress(entryId: string): Promise<ReceiveProgress | null>;
  retryEntryReceive(
    entryId: string,
    expectedAttemptId: string,
    itemIds: string[]
  ): Promise<ReceiveRetryOutcome>;
  cancelEntryReceive(entryId: string, attemptId: string): Promise<EntryReceiveCancellation>;
}

export interface ReceiveResultsEvents {
  subscribeEvents(subscriber: (event: EngineEvent) => void): () => void;
}

export type ReceiveItemState =
  | 'pending'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface ReceiveItemView {
  itemId: string;
  kind: string;
  state: ReceiveItemState;
  /** The Engine string, kept so a newer value is never lost. */
  rawState: string;
  failureReason: string | null;
  /** Only a failed or cancelled item of a settled attempt can be retried. */
  selectable: boolean;
}

export type ReceiveRetryBlockedReason = 'source_unavailable' | 'access_denied';

export interface ReceiveEntryView {
  entryId: string;
  progress: ReceiveProgress;
  items: ReceiveItemView[];
  /** The aggregate attempt reached completed, failed or cancelled. */
  settled: boolean;
  retryableItemIds: string[];
  /** Member counts stay apart from `items`: a directory is one item with many members. */
  memberCounts: { total: number; completed: number };
  /** A retry was accepted and the new attempt is not visible in the snapshot yet. */
  awaitingRetryAttemptId: string | null;
  retryBlockedReason: ReceiveRetryBlockedReason | null;
}

export interface ReceiveResultsSnapshot {
  entries: Record<string, ReceiveEntryView>;
  /** The last query failed; `entries` still shows the last known Engine state. */
  stale: boolean;
  error: string | null;
}

export type ReceiveResultsErrorCode = 'unknownEntry' | 'invalidSelection';

export class ReceiveResultsError extends Error {
  readonly name = 'ReceiveResultsError';
  constructor(readonly code: ReceiveResultsErrorCode) {
    super(`Receive results request rejected: ${code}`);
  }
}

const TERMINAL_ATTEMPT_STATES = new Set(['completed', 'failed', 'cancelled']);
const KNOWN_ITEM_STATES = new Set<ReceiveItemState>([
  'pending',
  'transferring',
  'completed',
  'failed',
  'cancelled',
]);
const RETRYABLE_ITEM_STATES = new Set<ReceiveItemState>(['failed', 'cancelled']);

function itemState(item: ReceiveItem): ReceiveItemState {
  const normalized = item.state.toLowerCase() as ReceiveItemState;
  return KNOWN_ITEM_STATES.has(normalized) ? normalized : 'unknown';
}

export function describeReceiveEntry(progress: ReceiveProgress): ReceiveEntryView {
  const settled = TERMINAL_ATTEMPT_STATES.has(progress.state.toLowerCase());
  const items = progress.items.map<ReceiveItemView>((item) => {
    const state = itemState(item);
    return {
      itemId: item.itemId,
      kind: item.kind,
      state,
      rawState: item.state,
      failureReason: item.failureReason,
      selectable: settled && RETRYABLE_ITEM_STATES.has(state),
    };
  });
  return {
    entryId: progress.entryId,
    progress,
    items,
    settled,
    retryableItemIds: items.filter((item) => item.selectable).map((item) => item.itemId),
    memberCounts: { total: progress.itemsTotal, completed: progress.itemsCompleted },
    awaitingRetryAttemptId: null,
    retryBlockedReason: null,
  };
}

interface EntryMemory {
  /** Attempt that was current when a retry was accepted. */
  retryAcceptedFrom: string | null;
  retryAcceptedAttemptId: string | null;
  blockedAttemptId: string | null;
  blockedReason: ReceiveRetryBlockedReason | null;
}

type Publisher = (snapshot: ReceiveResultsSnapshot) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ReceiveResultsService {
  private snapshot: ReceiveResultsSnapshot = { entries: {}, stale: false, error: null };
  private readonly memory = new Map<string, EntryMemory>();
  private readonly progressByEntry = new Map<string, ReceiveProgress>();
  private readonly appliedSequence = new Map<string, number>();
  private sequence = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly api: ReceiveResultsApi,
    private readonly events: ReceiveResultsEvents,
    private readonly publish: Publisher
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.events.subscribeEvents((event) => this.handleEvent(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getSnapshot(): ReceiveResultsSnapshot {
    return this.snapshot;
  }

  /** Rebuilds every entry from the Engine. Safe after missed events or a foreground return. */
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    try {
      const all = await this.api.listEntryReceiveProgress();
      const present = new Set<string>();
      for (const progress of all) {
        present.add(progress.entryId);
        this.apply(progress.entryId, progress, sequence);
      }
      for (const entryId of [...this.progressByEntry.keys()]) {
        if (!present.has(entryId)) this.apply(entryId, null, sequence);
      }
      this.markFresh();
    } catch (error) {
      this.markStale(error);
    }
  }

  async refreshEntry(entryId: string): Promise<void> {
    const sequence = ++this.sequence;
    try {
      this.apply(entryId, await this.api.queryEntryReceiveProgress(entryId), sequence);
      this.markFresh();
    } catch (error) {
      this.markStale(error);
    }
  }

  /**
   * Retries selected items of the current attempt. Item identities must come from the
   * current snapshot. `accepted` starts another attempt; it does not mean files are saved.
   */
  async retry(entryId: string, itemIds: string[]): Promise<ReceiveRetryOutcome> {
    const view = this.snapshot.entries[entryId];
    if (!view) throw new ReceiveResultsError('unknownEntry');
    const selection = [...new Set(itemIds)];
    if (selection.length === 0 || selection.some((id) => !view.retryableItemIds.includes(id))) {
      throw new ReceiveResultsError('invalidSelection');
    }
    const attemptId = view.progress.attemptId;
    let outcome: ReceiveRetryOutcome;
    try {
      outcome = await this.api.retryEntryReceive(entryId, attemptId, selection);
    } catch (error) {
      await this.refreshEntry(entryId);
      throw error;
    }
    const memory = this.memoryFor(entryId);
    if (outcome.kind === 'accepted') {
      memory.retryAcceptedFrom = attemptId;
      memory.retryAcceptedAttemptId = outcome.attemptId;
    } else if (outcome.kind === 'unavailable') {
      const reason = outcome.reason;
      if (reason === 'source_unavailable' || reason === 'access_denied') {
        memory.blockedAttemptId = attemptId;
        memory.blockedReason = reason as ReceiveRetryBlockedReason;
      }
    }
    await this.refreshEntry(entryId);
    return outcome;
  }

  /** Cancels the current attempt. Only `cancelled` means the Engine finished cancelling. */
  async cancel(entryId: string): Promise<EntryReceiveCancellation> {
    const view = this.snapshot.entries[entryId];
    if (!view) throw new ReceiveResultsError('unknownEntry');
    let outcome: EntryReceiveCancellation;
    try {
      outcome = await this.api.cancelEntryReceive(entryId, view.progress.attemptId);
    } catch (error) {
      await this.refreshEntry(entryId);
      throw error;
    }
    await this.refreshEntry(entryId);
    return outcome;
  }

  private handleEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'receiveAttemptStateChanged':
        // The payload may name an old attempt. It is never copied into state.
        void this.refreshEntry(event.entryId);
        return;
      case 'incomingEntry':
      case 'incomingPending':
      case 'transferStatusChanged':
        // Without an attempt the event is not about a receive attempt (for example a send).
        if (event.attemptId) void this.refreshEntry(event.entryId);
        return;
      case 'refreshRequired':
        void this.refresh();
        return;
      case 'stateChanged':
        if (event.state === 'running') void this.refresh();
        return;
      default:
        return;
    }
  }

  private memoryFor(entryId: string): EntryMemory {
    let memory = this.memory.get(entryId);
    if (!memory) {
      memory = {
        retryAcceptedFrom: null,
        retryAcceptedAttemptId: null,
        blockedAttemptId: null,
        blockedReason: null,
      };
      this.memory.set(entryId, memory);
    }
    return memory;
  }

  private apply(entryId: string, progress: ReceiveProgress | null, sequence: number): void {
    // A response older than one already applied for this entry must not roll the view back.
    if ((this.appliedSequence.get(entryId) ?? 0) > sequence) return;
    this.appliedSequence.set(entryId, sequence);
    const entries = { ...this.snapshot.entries };
    if (!progress) {
      delete entries[entryId];
      this.progressByEntry.delete(entryId);
      this.memory.delete(entryId);
    } else {
      this.progressByEntry.set(entryId, progress);
      entries[entryId] = this.viewFor(progress);
    }
    this.commit({ ...this.snapshot, entries });
  }

  private viewFor(progress: ReceiveProgress): ReceiveEntryView {
    const base = describeReceiveEntry(progress);
    const memory = this.memory.get(progress.entryId);
    if (!memory) return base;
    if (memory.retryAcceptedFrom && progress.attemptId !== memory.retryAcceptedFrom) {
      memory.retryAcceptedFrom = null;
      memory.retryAcceptedAttemptId = null;
    }
    const blocked =
      memory.blockedAttemptId === progress.attemptId ? memory.blockedReason : null;
    if (memory.retryAcceptedAttemptId) {
      // The accepted attempt is not visible yet: do not offer a second retry meanwhile.
      return {
        ...base,
        settled: false,
        retryableItemIds: [],
        items: base.items.map((item) => ({ ...item, selectable: false })),
        awaitingRetryAttemptId: memory.retryAcceptedAttemptId,
        retryBlockedReason: blocked,
      };
    }
    return { ...base, retryBlockedReason: blocked };
  }

  private markFresh(): void {
    if (!this.snapshot.stale && this.snapshot.error === null) return;
    this.commit({ ...this.snapshot, stale: false, error: null });
  }

  private markStale(error: unknown): void {
    log.warn('Receive results query failed:', errorMessage(error));
    this.commit({ ...this.snapshot, stale: true, error: errorMessage(error) });
  }

  private commit(snapshot: ReceiveResultsSnapshot): void {
    this.snapshot = snapshot;
    this.publish(snapshot);
  }
}

let sharedService: ReceiveResultsService | null = null;
let sharedDependencies: {
  api: ReceiveResultsApi;
  events: ReceiveResultsEvents;
  publish: Publisher;
} | null = null;

export function configureReceiveResultsService(
  api: ReceiveResultsApi,
  events: ReceiveResultsEvents,
  publish: Publisher
): void {
  if (sharedService) throw new Error('The receive results service has already been created');
  sharedDependencies = { api, events, publish };
}

export function getReceiveResultsService(): ReceiveResultsService {
  if (!sharedService) {
    if (!sharedDependencies) throw new Error('The receive results service is not configured');
    sharedService = new ReceiveResultsService(
      sharedDependencies.api,
      sharedDependencies.events,
      sharedDependencies.publish
    );
  }
  return sharedService;
}
