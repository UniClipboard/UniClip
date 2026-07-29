import type { EngineConfig, EngineEvent, PeerConnectionRefresh } from 'uc-engine';
import { log } from './Logger';
import {
  createInitialUnifiedEngineSnapshot,
  publishUnifiedEngineSnapshot,
  type UnifiedEngineSnapshot,
} from '@/stores/unifiedEngineStore';

export interface UnifiedEngineApi {
  start(config: EngineConfig): Promise<void>;
  shutdown(deadlineMs?: number): Promise<void>;
  nextEvent(timeoutMs?: number): Promise<EngineEvent | null>;
  refreshPeerConnections(): Promise<PeerConnectionRefresh>;
}

type SnapshotPublisher = (snapshot: UnifiedEngineSnapshot) => void;
type EngineEventSubscriber = (event: EngineEvent) => void;

const DEFAULT_EVENT_TIMEOUT_MS = 250;
const SHUTDOWN_DEADLINE_MS = 5_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UnifiedEngineService {
  private snapshot = createInitialUnifiedEngineSnapshot();
  private generation = 0;
  private nativeStarted = false;
  private startInFlight: Promise<void> | null = null;
  private eventLoop: Promise<void> | null = null;
  private readonly eventSubscribers = new Set<EngineEventSubscriber>();

  constructor(
    private readonly api: UnifiedEngineApi,
    private readonly publish: SnapshotPublisher = publishUnifiedEngineSnapshot,
    private readonly eventTimeoutMs = DEFAULT_EVENT_TIMEOUT_MS
  ) {
    this.publishSnapshot();
  }

  start(config: EngineConfig): Promise<void> {
    if (this.nativeStarted) return Promise.resolve();
    if (this.startInFlight) return this.startInFlight;

    const generation = ++this.generation;
    this.snapshot = { ...createInitialUnifiedEngineSnapshot(), status: 'starting' };
    this.publishSnapshot();

    const attempt = this.startNative(config, generation);
    this.startInFlight = attempt;
    void attempt.then(
      () => this.clearStartInFlight(attempt),
      () => this.clearStartInFlight(attempt)
    );
    return attempt;
  }

  isStarting(): boolean {
    return this.startInFlight !== null;
  }

  refreshPeerConnections(): Promise<PeerConnectionRefresh> {
    return this.api.refreshPeerConnections();
  }

  subscribeEvents(subscriber: EngineEventSubscriber): () => void {
    this.eventSubscribers.add(subscriber);
    return () => this.eventSubscribers.delete(subscriber);
  }

  async stop(): Promise<void> {
    ++this.generation;

    const startInFlight = this.startInFlight;
    let shutdownError: unknown;

    if (startInFlight || this.nativeStarted) {
      this.nativeStarted = false;
      try {
        await this.api.shutdown(SHUTDOWN_DEADLINE_MS);
      } catch (error) {
        shutdownError = error;
      }
    }

    if (startInFlight) {
      try {
        await startInFlight;
      } catch {
        // The failed start already published its terminal state.
      }

      // Cover the narrow window where shutdown arrived before the native
      // engine became visible to the module.
      try {
        await this.api.shutdown(SHUTDOWN_DEADLINE_MS);
      } catch (error) {
        shutdownError ??= error;
      }
    }

    const eventLoop = this.eventLoop;
    this.eventLoop = null;
    await eventLoop;

    if (shutdownError) {
      const message = errorMessage(shutdownError);
      this.updateSnapshot({ status: 'failed', isStarted: false, lastError: message });
      log.error('[UnifiedEngineService] Failed to stop the P2P engine:', shutdownError);
      throw shutdownError;
    }

    this.snapshot = createInitialUnifiedEngineSnapshot();
    this.publishSnapshot();
  }

  private async startNative(config: EngineConfig, generation: number): Promise<void> {
    try {
      await this.api.start(config);
      if (generation !== this.generation) return;

      this.nativeStarted = true;
      this.updateSnapshot({ status: 'running', isStarted: true, lastError: null });
      const eventLoop = this.consumeEvents(generation);
      this.eventLoop = eventLoop;
      void eventLoop.then(
        () => this.clearEventLoop(eventLoop),
        () => this.clearEventLoop(eventLoop)
      );
    } catch (error) {
      if (generation === this.generation) {
        const message = errorMessage(error);
        this.updateSnapshot({ status: 'failed', isStarted: false, lastError: message });
        log.error('[UnifiedEngineService] Failed to start the P2P engine:', error);
      }
      throw error;
    }
  }

  private async consumeEvents(generation: number): Promise<void> {
    while (generation === this.generation && this.nativeStarted) {
      let event: EngineEvent | null;
      try {
        event = await this.api.nextEvent(this.eventTimeoutMs);
      } catch (error) {
        if (generation !== this.generation) return;
        const message = errorMessage(error);
        this.updateSnapshot({ status: 'failed', lastError: message });
        log.error('[UnifiedEngineService] Failed to read a P2P engine event:', error);
        return;
      }

      if (generation !== this.generation || !event) continue;
      this.applyEvent(event);
      if (event.type === 'fatal') return;
    }
  }

  private applyEvent(event: EngineEvent): void {
    for (const subscriber of this.eventSubscribers) {
      try {
        subscriber(event);
      } catch (error) {
        log.error('[UnifiedEngineService] A P2P event subscriber failed:', error);
      }
    }

    switch (event.type) {
      case 'stateChanged':
        if (event.state === 'stopped') this.nativeStarted = false;
        this.updateSnapshot({
          status: event.state,
          isStarted: event.state !== 'stopped',
          lastEvent: event,
        });
        break;
      case 'refreshRequired':
        this.updateSnapshot({
          lastEvent: event,
          refreshRevision: this.snapshot.refreshRevision + 1,
        });
        break;
      case 'changed':
        this.updateSnapshot({ lastEvent: event, lastChangedKind: event.kind });
        break;
      case 'incomingEntry':
      case 'incomingPending':
      case 'receiveAttemptStateChanged':
      case 'deliveryStatusChanged':
      case 'transferStatusChanged':
      case 'activeClipboardChanged':
        this.updateSnapshot({
          lastEvent: event,
          lastChangedKind: event.type,
          refreshRevision: this.snapshot.refreshRevision + 1,
        });
        break;
      case 'peerPresenceChanged':
        this.updateSnapshot({
          lastEvent: event,
          lastChangedKind: event.type,
          refreshRevision: this.snapshot.refreshRevision + 1,
        });
        break;
      case 'transferProgress':
        this.updateSnapshot({ lastEvent: event, lastChangedKind: event.type });
        break;
      case 'fatal':
        this.updateSnapshot({ status: 'failed', lastEvent: event, fatalFailure: event.failure });
        log.error('[UnifiedEngineService] The P2P engine reported a fatal failure:', event.failure);
        break;
      case 'lifecycleFailed':
        this.updateSnapshot({
          lastEvent: event,
          lifecycleFailure: { action: event.action, failure: event.failure },
        });
        log.error(
          `[UnifiedEngineService] The P2P engine failed to ${event.action}:`,
          event.failure
        );
        break;
      case 'operationFinished':
        this.updateSnapshot({ lastEvent: event });
        break;
    }
  }

  private updateSnapshot(updates: Partial<UnifiedEngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...updates };
    this.publishSnapshot();
  }

  private publishSnapshot(): void {
    this.publish({ ...this.snapshot });
  }

  private clearStartInFlight(attempt: Promise<void>): void {
    if (this.startInFlight === attempt) this.startInFlight = null;
  }

  private clearEventLoop(eventLoop: Promise<void>): void {
    if (this.eventLoop === eventLoop) this.eventLoop = null;
  }
}

let sharedService: UnifiedEngineService | null = null;

export function getUnifiedEngineService(): UnifiedEngineService {
  if (!sharedService) {
    const engine = require('uc-engine') as UnifiedEngineApi;
    sharedService = new UnifiedEngineService(engine);
  }
  return sharedService;
}
