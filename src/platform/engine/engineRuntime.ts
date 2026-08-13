import type { EngineConfig, EngineEvent, PeerConnectionRefresh } from './contracts';
import { AppState } from 'react-native';
import { createLogger } from '@/support/observability';
import { useSettingsStore } from '@/features/settings';
import {
  createInitialUnifiedEngineSnapshot,
  publishUnifiedEngineSnapshot,
  type PeerConnectionStatus,
  type UnifiedEngineSnapshot,
} from '@/stores/unifiedEngineStore';

const log = createLogger('UnifiedEngineService');

export interface UnifiedEngineApi {
  start(config: EngineConfig): Promise<void>;
  shutdown(deadlineMs?: number): Promise<void>;
  resume(): Promise<void>;
  setBackgroundSyncEnabled(enabled: boolean, appIsBackground: boolean): Promise<void>;
  nextEvent(timeoutMs?: number): Promise<EngineEvent | null>;
  refreshPeerConnections(): Promise<PeerConnectionRefresh>;
}

type SnapshotPublisher = (snapshot: UnifiedEngineSnapshot) => void;
type EngineEventSubscriber = (event: EngineEvent) => void;

const DEFAULT_EVENT_TIMEOUT_MS = 250;
const SHUTDOWN_DEADLINE_MS = 5_000;
const DEFAULT_PEER_RECOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_PEER_RECOVERY_RETRY_DELAY_MS = 1_000;

export interface PeerRecoveryOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

type PeerRecoverySignal = 'online' | 'cancelled';

function emptyPeerRefresh(): PeerConnectionRefresh {
  return { total: 0, online: 0, offline: 0, errors: 0 };
}

function onlinePeerRefresh(): PeerConnectionRefresh {
  return { total: 1, online: 1, offline: 0, errors: 0 };
}

function delay(ms: number): Promise<'elapsed'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('elapsed'), ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relayContext(): string {
  const urls = useSettingsStore.getState().config?.customRelayUrls ?? [];
  return urls.length > 0
    ? `customRelayConfigured=true customRelayCount=${urls.length}`
    : 'customRelayConfigured=false';
}

export class UnifiedEngineService {
  private snapshot = createInitialUnifiedEngineSnapshot();
  private generation = 0;
  private nativeStarted = false;
  private startInFlight: Promise<void> | null = null;
  private eventLoop: Promise<void> | null = null;
  private peerRecoveryGeneration = 0;
  private peerRecoveryInFlight: Promise<PeerConnectionRefresh> | null = null;
  private peerRecoverySignal: {
    generation: number;
    resolve: (signal: PeerRecoverySignal) => void;
  } | null = null;
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
    if (this.peerRecoveryInFlight) return this.peerRecoveryInFlight;
    this.updatePeerConnectionStatus('connecting');
    return this.api.refreshPeerConnections().then(
      (report) => {
        this.updatePeerConnectionStatus(report.online > 0 ? 'online' : 'offline');
        if (report.online > 0) {
          log.info(
            `peer connections online total=${report.total} online=${
              report.online
            } ${relayContext()} (actual relay url is logged by the engine)`
          );
        }
        return report;
      },
      (error) => {
        this.updatePeerConnectionStatus('offline');
        throw error;
      }
    );
  }

  recoverPeerConnections(options: PeerRecoveryOptions = {}): Promise<PeerConnectionRefresh> {
    if (this.peerRecoveryInFlight) return this.peerRecoveryInFlight;

    const generation = ++this.peerRecoveryGeneration;
    let resolveSignal!: (signal: PeerRecoverySignal) => void;
    const signal = new Promise<PeerRecoverySignal>((resolve) => {
      resolveSignal = resolve;
    });
    this.peerRecoverySignal = { generation, resolve: resolveSignal };
    this.updatePeerConnectionStatus('connecting');

    const recovery = this.runPeerRecovery(
      generation,
      signal,
      Math.max(0, options.timeoutMs ?? DEFAULT_PEER_RECOVERY_TIMEOUT_MS),
      Math.max(0, options.retryDelayMs ?? DEFAULT_PEER_RECOVERY_RETRY_DELAY_MS)
    );
    this.peerRecoveryInFlight = recovery;
    void recovery.then(
      () => this.clearPeerRecovery(recovery, generation),
      () => this.clearPeerRecovery(recovery, generation)
    );
    return recovery;
  }

  cancelPeerRecovery(): void {
    ++this.peerRecoveryGeneration;
    this.peerRecoverySignal?.resolve('cancelled');
    this.peerRecoverySignal = null;
    this.peerRecoveryInFlight = null;
    if (this.snapshot.peerConnectionStatus === 'connecting') {
      this.updatePeerConnectionStatus('idle');
    }
  }

  resume(): Promise<void> {
    if (!this.nativeStarted) return Promise.resolve();
    return this.api.resume();
  }

  setBackgroundSyncPolicy(enabled: boolean): Promise<void> {
    if (!this.nativeStarted) return Promise.resolve();
    return this.api.setBackgroundSyncEnabled(enabled, AppState.currentState !== 'active');
  }

  subscribeEvents(subscriber: EngineEventSubscriber): () => void {
    this.eventSubscribers.add(subscriber);
    return () => this.eventSubscribers.delete(subscriber);
  }

  async stop(): Promise<void> {
    this.cancelPeerRecovery();
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
      log.error('Failed to stop the P2P engine:', shutdownError);
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
        log.error('Failed to start the P2P engine:', error);
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
        log.error('Failed to read a P2P engine event:', error);
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
        log.error('A P2P event subscriber failed:', error);
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
      case 'deviceTrustChanged':
      case 'networkRecoveryChanged':
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
          ...(event.state === 'online' ? { peerConnectionStatus: 'online' as const } : {}),
          refreshRevision: this.snapshot.refreshRevision + 1,
        });
        if (event.state === 'online') {
          log.info(
            `peer connected deviceId=${
              event.deviceId
            } ${relayContext()} (actual relay url is logged by the engine)`
          );
          this.peerRecoverySignal?.resolve('online');
        }
        break;
      case 'transferProgress':
        this.updateSnapshot({ lastEvent: event, lastChangedKind: event.type });
        break;
      case 'fatal':
        this.updateSnapshot({ status: 'failed', lastEvent: event, fatalFailure: event.failure });
        log.error('The P2P engine reported a fatal failure:', event.failure);
        break;
      case 'lifecycleFailed':
        this.updateSnapshot({
          lastEvent: event,
          lifecycleFailure: { action: event.action, failure: event.failure },
        });
        log.error(`The P2P engine failed to ${event.action}:`, event.failure);
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

  private async runPeerRecovery(
    generation: number,
    signal: Promise<PeerRecoverySignal>,
    timeoutMs: number,
    retryDelayMs: number
  ): Promise<PeerConnectionRefresh> {
    const deadline = Date.now() + timeoutMs;
    let lastReport = emptyPeerRefresh();

    while (generation === this.peerRecoveryGeneration) {
      const remainingMs = Math.max(0, deadline - Date.now());
      if (remainingMs === 0) break;

      const outcome = await Promise.race([
        this.api.refreshPeerConnections().then(
          (report) => ({ kind: 'report' as const, report }),
          (error: unknown) => ({ kind: 'error' as const, error })
        ),
        signal.then((value) =>
          value === 'online' ? ({ kind: 'online' } as const) : ({ kind: 'cancelled' } as const)
        ),
        delay(remainingMs).then(() => ({ kind: 'timeout' as const })),
      ]);

      if (generation !== this.peerRecoveryGeneration || outcome.kind === 'cancelled') {
        return lastReport;
      }
      if (outcome.kind === 'online') {
        return onlinePeerRefresh();
      }
      if (outcome.kind === 'timeout') break;
      if (outcome.kind === 'report') {
        lastReport = outcome.report;
        if (outcome.report.online > 0) {
          this.updatePeerConnectionStatus('online');
          return outcome.report;
        }
      } else {
        log.warn('Peer recovery refresh failed:', outcome.error);
      }

      const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
      if (delayMs === 0) break;
      const waitOutcome = await Promise.race([signal, delay(delayMs)]);
      if (generation !== this.peerRecoveryGeneration || waitOutcome === 'cancelled') {
        return lastReport;
      }
      if (waitOutcome === 'online') return onlinePeerRefresh();
    }

    if (generation === this.peerRecoveryGeneration) this.updatePeerConnectionStatus('offline');
    return lastReport;
  }

  private updatePeerConnectionStatus(status: PeerConnectionStatus): void {
    if (this.snapshot.peerConnectionStatus !== status) {
      this.updateSnapshot({ peerConnectionStatus: status });
    }
  }

  private clearPeerRecovery(recovery: Promise<PeerConnectionRefresh>, generation: number): void {
    if (this.peerRecoveryInFlight === recovery) this.peerRecoveryInFlight = null;
    if (this.peerRecoverySignal?.generation === generation) this.peerRecoverySignal = null;
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
let sharedApi: UnifiedEngineApi | null = null;

export function configureUnifiedEngineService(api: UnifiedEngineApi): void {
  if (sharedService) {
    throw new Error('The unified engine service has already been created');
  }
  sharedApi = api;
}

export function getUnifiedEngineService(): UnifiedEngineService {
  if (!sharedService) {
    if (!sharedApi) throw new Error('The unified engine service is not configured');
    sharedService = new UnifiedEngineService(sharedApi);
  }
  return sharedService;
}
