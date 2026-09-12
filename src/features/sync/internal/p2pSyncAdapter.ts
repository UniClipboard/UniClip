import type {
  EngineConfig,
  EngineEvent,
  SendReport,
  ConnectivityOpportunity,
} from '@/platform/engine';
import {
  p2pDeliveryCountsFromReport,
  p2pDeliveryStateFromReport,
  type ImportedAssetSendOptions,
  type ImportedContentAsset,
  type UnifiedContentResult,
} from '@/features/transfer';
import type { ClipboardContent } from '@/types/clipboard';
import { createLogger } from '@/support/observability';
import type {
  SyncAdapter,
  SyncAdapterDelivery,
  SyncAdapterEvent,
  SyncImportedAsset,
  SyncRuntimePolicy,
  SyncSendOptions,
  SyncStartContext,
} from '../contracts';

const log = createLogger('P2pSyncAdapter');

interface P2pEnginePort {
  start(config: EngineConfig): Promise<void>;
  stop(): Promise<void>;
  setBackgroundSyncPolicy(enabled: boolean): Promise<void>;
  resume(): Promise<void>;
  notifyConnectivityOpportunity(reason: ConnectivityOpportunity): Promise<void>;
  refreshPeerConnections(): Promise<unknown>;
  subscribeEvents(listener: (event: EngineEvent) => void): () => void;
}

interface P2pSpacePort {
  refresh(options?: { afterInvalidation?: boolean }): Promise<{ devices: unknown[] }>;
  refreshDevices(): Promise<unknown>;
}

interface P2pContentPort {
  sendCurrentClipboard(): Promise<UnifiedContentResult>;
  sendImportedText(
    text: string,
    profileHash: string,
    options?: ImportedAssetSendOptions
  ): Promise<UnifiedContentResult>;
  sendImportedAsset(
    asset: ImportedContentAsset,
    profileHash: string,
    options?: ImportedAssetSendOptions
  ): Promise<UnifiedContentResult>;
}

interface P2pClipboardPort {
  observeClipboardChange(dispatch: boolean): Promise<SendReport | null>;
  persistDelivery(profileHash: string | undefined, report: SendReport): Promise<void>;
}

export interface P2pSyncAdapterDependencies {
  platform: 'android' | 'ios';
  engine: P2pEnginePort;
  space: P2pSpacePort;
  content: P2pContentPort;
  clipboard: P2pClipboardPort;
}

export class P2pSyncAdapter implements SyncAdapter {
  readonly id = 'p2p' as const;
  private engineEventsUnsubscribe: (() => void) | null = null;
  private policy: SyncRuntimePolicy = {
    appState: 'unknown',
    backgroundSyncEnabled: false,
  };
  private readonly subscribers = new Set<(event: SyncAdapterEvent) => void>();

  constructor(private readonly dependencies: P2pSyncAdapterDependencies) {}

  async start(context: SyncStartContext): Promise<void> {
    this.policy = context.policy;
    this.subscribeToEngineEvents();
    await this.dependencies.engine.start({
      appVersion: context.appVersion,
      profileId: context.profileId,
    });
    await this.refresh(context.policy);
  }

  async refresh(policy: SyncRuntimePolicy): Promise<void> {
    this.policy = policy;
    await this.dependencies.engine.setBackgroundSyncPolicy(policy.backgroundSyncEnabled);
    if (this.dependencies.platform === 'ios') {
      if (policy.appState !== 'active') return;
      await this.dependencies.engine.resume();
    }
    const space = await this.dependencies.space.refresh();
    log.info('P2P space state', { deviceCount: space.devices.length });
    if (policy.appState === 'active') {
      await this.dependencies.engine.notifyConnectivityOpportunity('foreground');
    }
  }

  handleAppStateChange(policy: SyncRuntimePolicy): void {
    this.policy = policy;
  }

  async stop(): Promise<void> {
    this.engineEventsUnsubscribe?.();
    this.engineEventsUnsubscribe = null;
    await this.dependencies.engine.stop();
  }

  subscribe(listener: (event: SyncAdapterEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async sendCurrentClipboard(): Promise<SyncAdapterDelivery> {
    return this.mapDelivery(await this.dependencies.content.sendCurrentClipboard());
  }

  async synchronize(): Promise<void> {
    await this.dependencies.engine.refreshPeerConnections();
  }

  async sendImportedText(
    text: string,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery> {
    return this.mapDelivery(
      await this.dependencies.content.sendImportedText(text, profileHash, this.mapOptions(options))
    );
  }

  async sendImportedAsset(
    asset: SyncImportedAsset,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery> {
    return this.mapDelivery(
      await this.dependencies.content.sendImportedAsset(
        asset,
        profileHash,
        this.mapOptions(options)
      )
    );
  }

  async observeClipboardChange(
    content: ClipboardContent,
    dispatch: boolean
  ): Promise<SyncAdapterDelivery | null> {
    const report = await this.dependencies.clipboard.observeClipboardChange(dispatch);
    if (!report) return null;
    await this.dependencies.clipboard.persistDelivery(content.profileHash, report);
    const state = p2pDeliveryStateFromReport(report);
    return {
      success: state === 'delivered' || state === 'partial',
      state,
      counts: p2pDeliveryCountsFromReport(report),
    };
  }

  private subscribeToEngineEvents(): void {
    if (this.engineEventsUnsubscribe) return;
    this.engineEventsUnsubscribe = this.dependencies.engine.subscribeEvents((event) => {
      this.handleEngineEvent(event);
    });
  }

  private handleEngineEvent(event: EngineEvent): void {
    if (event.type === 'deviceTrustChanged' || event.type === 'rePairingRequired') {
      if (this.policy.appState === 'active') {
        void this.dependencies.space
          .refresh({ afterInvalidation: true })
          .catch((error) =>
            log.error('Failed to refresh space after a device trust event:', error)
          );
      }
      this.publish({ type: 'configurationChanged' });
      return;
    }

    if (
      event.type === 'refreshRequired' ||
      event.type === 'peerPresenceChanged' ||
      (event.type === 'changed' && event.kind === 'pairing_completed')
    ) {
      if (this.policy.appState === 'active') {
        void this.dependencies.space
          .refreshDevices()
          .catch((error) => log.error('Failed to refresh devices after an engine event:', error));
      }
      this.publish({ type: 'connectionChanged' });
      return;
    }

    if (
      event.type === 'incomingEntry' ||
      event.type === 'incomingPending' ||
      event.type === 'deliveryStatusChanged' ||
      event.type === 'transferStatusChanged' ||
      event.type === 'activeClipboardChanged' ||
      (event.type === 'changed' && event.kind === 'incomingEntry')
    ) {
      this.publish({ type: 'contentChanged' });
      return;
    }

    if (event.type === 'fatal') {
      this.publish({
        type: 'failed',
        message: `${event.failure.category}:${event.failure.code}`,
      });
    }
  }

  private publish(event: SyncAdapterEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private mapOptions(options?: SyncSendOptions): ImportedAssetSendOptions | undefined {
    return options ? { targetDeviceIds: options.targetIds } : undefined;
  }

  private mapDelivery(result: UnifiedContentResult): SyncAdapterDelivery {
    return {
      success: result.success,
      state: result.deliveryState,
      counts: p2pDeliveryCountsFromReport(result.report),
    };
  }
}
