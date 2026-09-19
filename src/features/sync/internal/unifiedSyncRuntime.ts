import type {
  SyncAdapter,
  SyncAdapterEvent,
  SyncDeliveryResult,
  SyncImportedAsset,
  SyncRuntimePolicy,
  SyncRuntimeSnapshot,
  SyncSendOptions,
  SyncStartContext,
  SyncSwitchOptions,
  SyncTransportId,
} from '../contracts';
import type { ClipboardContent } from '@/types/clipboard';

export class UnifiedSyncRuntime {
  private readonly adapters: Map<SyncTransportId, SyncAdapter>;
  private snapshot: SyncRuntimeSnapshot;
  private startContext: SyncStartContext | null = null;
  private startInFlight: Promise<void> | null = null;
  private switchQueue: Promise<void> = Promise.resolve();
  private adapterEventUnsubscribe: (() => void) | null = null;
  private adapterEventGeneration = 0;
  private readonly subscribers = new Set<(event: SyncAdapterEvent) => void>();

  constructor(adapters: SyncAdapter[], initialTransport: SyncTransportId) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    if (!this.adapters.has(initialTransport)) {
      throw new Error(`No sync adapter registered for ${initialTransport}`);
    }
    this.snapshot = {
      activeTransport: initialTransport,
      pendingTransport: null,
      status: 'idle',
      lastError: null,
      lastEvent: null,
    };
  }

  getSnapshot(): SyncRuntimeSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (event: SyncAdapterEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async refresh(policy: SyncRuntimePolicy): Promise<void> {
    if (this.startContext) this.startContext = { ...this.startContext, policy };
    await this.adapters.get(this.snapshot.activeTransport)!.refresh(policy);
  }

  handleAppStateChange(policy: SyncRuntimePolicy): void {
    if (this.startContext) this.startContext = { ...this.startContext, policy };
    this.adapters.get(this.snapshot.activeTransport)!.handleAppStateChange(policy);
  }

  async stop(): Promise<void> {
    this.snapshot = { ...this.snapshot, status: 'stopping', pendingTransport: null };
    this.detachAdapterEvents();
    try {
      await this.requiredAdapter(this.snapshot.activeTransport).stop();
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        status: 'failed',
        lastError: this.errorMessage(error),
      };
      throw error;
    }
    this.snapshot = { ...this.snapshot, status: 'idle' };
  }

  start(
    context: SyncStartContext,
    transport: SyncTransportId = this.snapshot.activeTransport
  ): Promise<void> {
    if (this.startInFlight) return this.startInFlight;
    this.requiredAdapter(transport);
    this.snapshot = { ...this.snapshot, activeTransport: transport };
    this.startContext = context;
    const operation = this.performStart(context);
    this.startInFlight = operation;
    void operation.then(
      () => this.clearStartInFlight(operation),
      () => this.clearStartInFlight(operation)
    );
    return operation;
  }

  private async performStart(context: SyncStartContext): Promise<void> {
    this.snapshot = { ...this.snapshot, status: 'starting', lastError: null };
    const adapter = this.requiredAdapter(this.snapshot.activeTransport);
    try {
      await adapter.start(context);
    } catch (error) {
      try {
        await adapter.stop();
      } catch {
        // Startup remains the primary error; cleanup is best effort.
      }
      this.snapshot = {
        ...this.snapshot,
        status: 'failed',
        lastError: this.errorMessage(error),
      };
      throw error;
    }
    this.snapshot = { ...this.snapshot, status: 'ready' };
    this.attachAdapterEvents(adapter);
  }

  switchTo(transport: SyncTransportId, options?: SyncSwitchOptions): Promise<void> {
    const operation = this.switchQueue.then(() => this.performSwitch(transport, false, options));
    this.switchQueue = operation.catch(() => undefined);
    return operation;
  }

  restart(): Promise<void> {
    const operation = this.switchQueue.then(() =>
      this.performSwitch(this.snapshot.activeTransport, true)
    );
    this.switchQueue = operation.catch(() => undefined);
    return operation;
  }

  private async performSwitch(
    transport: SyncTransportId,
    restart = false,
    options?: SyncSwitchOptions
  ): Promise<void> {
    if (!restart && transport === this.snapshot.activeTransport) {
      if (this.startInFlight) await this.startInFlight;
      if (this.snapshot.status === 'ready') return;
      if (!this.startContext) throw new Error('Sync runtime has not been started');
      await this.start(this.startContext);
      return;
    }
    if (this.startInFlight) await this.startInFlight;
    if (!this.startContext) throw new Error('Sync runtime has not been started');
    const context = this.startContext;
    const current = this.requiredAdapter(this.snapshot.activeTransport);
    const target = this.requiredAdapter(transport);
    this.snapshot = {
      ...this.snapshot,
      status: 'switching',
      pendingTransport: transport,
      lastError: null,
    };
    this.detachAdapterEvents();
    await current.stop();
    try {
      await target.start(context);
    } catch (error) {
      if (options?.rollbackOnFailure === false) {
        this.snapshot = {
          ...this.snapshot,
          activeTransport: transport,
          pendingTransport: null,
          status: 'failed',
          lastError: this.errorMessage(error),
        };
        throw error;
      }
      try {
        await target.stop();
      } catch {
        // The original start failure remains the actionable switch error.
      }
      try {
        await current.start(context);
      } catch (rollbackError) {
        this.snapshot = {
          ...this.snapshot,
          pendingTransport: null,
          status: 'failed',
          lastError: `${this.errorMessage(error)}; rollback failed: ${this.errorMessage(
            rollbackError
          )}`,
        };
        throw error;
      }
      this.snapshot = {
        ...this.snapshot,
        pendingTransport: null,
        status: 'ready',
        lastError: this.errorMessage(error),
      };
      this.attachAdapterEvents(current);
      throw error;
    }
    this.snapshot = {
      ...this.snapshot,
      activeTransport: transport,
      pendingTransport: null,
      status: 'ready',
    };
    this.attachAdapterEvents(target);
  }

  async sendImportedText(
    text: string,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncDeliveryResult> {
    const adapter = this.readyAdapter();
    const result = await adapter.sendImportedText(text, profileHash, options);
    return { transport: adapter.id, ...result };
  }

  async synchronize(): Promise<void> {
    await this.readyAdapter().synchronize();
  }

  async sendCurrentClipboard(): Promise<SyncDeliveryResult> {
    const adapter = this.readyAdapter();
    const result = await adapter.sendCurrentClipboard();
    return { transport: adapter.id, ...result };
  }

  async sendImportedAsset(
    asset: SyncImportedAsset,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncDeliveryResult> {
    const adapter = this.readyAdapter();
    const result = await adapter.sendImportedAsset(asset, profileHash, options);
    return { transport: adapter.id, ...result };
  }

  async observeClipboardChange(
    content: ClipboardContent,
    dispatch: boolean
  ): Promise<SyncDeliveryResult | null> {
    const adapter = this.readyAdapter();
    const result = await adapter.observeClipboardChange(content, dispatch);
    return result ? { transport: adapter.id, ...result } : null;
  }

  private attachAdapterEvents(adapter: SyncAdapter): void {
    this.detachAdapterEvents();
    const generation = this.adapterEventGeneration;
    this.adapterEventUnsubscribe = adapter.subscribe((event) => {
      if (
        generation !== this.adapterEventGeneration ||
        this.snapshot.status !== 'ready' ||
        this.snapshot.activeTransport !== adapter.id
      ) {
        return;
      }
      this.snapshot = { ...this.snapshot, lastEvent: event };
      if (event.type === 'stopped') {
        this.snapshot = { ...this.snapshot, status: 'idle', lastError: null };
      }
      if (event.type === 'failed') {
        this.snapshot = { ...this.snapshot, status: 'failed', lastError: event.message };
      }
      for (const subscriber of this.subscribers) subscriber(event);
    });
  }

  private detachAdapterEvents(): void {
    this.adapterEventGeneration += 1;
    this.adapterEventUnsubscribe?.();
    this.adapterEventUnsubscribe = null;
  }

  private requiredAdapter(transport: SyncTransportId): SyncAdapter {
    const adapter = this.adapters.get(transport);
    if (!adapter) throw new Error(`No sync adapter registered for ${transport}`);
    return adapter;
  }

  private readyAdapter(): SyncAdapter {
    if (this.snapshot.status !== 'ready') throw new Error('Sync runtime is not ready');
    return this.requiredAdapter(this.snapshot.activeTransport);
  }

  private clearStartInFlight(operation: Promise<void>): void {
    if (this.startInFlight === operation) this.startInFlight = null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

let sharedRuntime: UnifiedSyncRuntime | null = null;

export function configureUnifiedSyncRuntime(
  adapters: SyncAdapter[],
  initialTransport: SyncTransportId
): UnifiedSyncRuntime {
  if (sharedRuntime) throw new Error('The unified sync runtime is already configured');
  sharedRuntime = new UnifiedSyncRuntime(adapters, initialTransport);
  return sharedRuntime;
}

export function getUnifiedSyncRuntime(): UnifiedSyncRuntime {
  if (!sharedRuntime) throw new Error('The unified sync runtime is not configured');
  return sharedRuntime;
}
