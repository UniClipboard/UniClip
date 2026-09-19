export type SyncTransportId = 'lan' | 'p2p';

export type SyncRuntimeStatus = 'idle' | 'starting' | 'ready' | 'switching' | 'stopping' | 'failed';

export interface SyncRuntimePolicy {
  appState: 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
  backgroundSyncEnabled: boolean;
}

export interface SyncStartContext {
  appVersion: string;
  profileId: string;
  policy: SyncRuntimePolicy;
}

export type SyncDeliveryState = 'delivered' | 'partial' | 'offline' | 'failed' | 'pending';

export interface SyncSendOptions {
  targetIds?: string[];
}

export interface SyncSwitchOptions {
  rollbackOnFailure?: boolean;
}

export interface SyncImportedAsset {
  kind: 'image' | 'file';
  uri: string;
  fileName?: string;
  mimeType?: string | null;
}

export interface SyncAdapterDelivery {
  success: boolean;
  state: SyncDeliveryState;
  counts?: SyncDeliveryCounts;
}

export interface SyncDeliveryCounts {
  accepted: number;
  duplicate: number;
  offline: number;
  errored: number;
  pending: number;
}

export type SyncAdapterEvent =
  | { type: 'stopped' }
  | { type: 'contentChanged' }
  | { type: 'connectionChanged'; connected?: boolean; message?: string }
  | { type: 'configurationChanged' }
  | { type: 'failed'; message: string };

export interface SyncDeliveryResult extends SyncAdapterDelivery {
  transport: SyncTransportId;
}

export interface SyncAdapter {
  readonly id: SyncTransportId;
  start(context: SyncStartContext): Promise<void>;
  stop(): Promise<void>;
  refresh(policy: SyncRuntimePolicy): Promise<void>;
  handleAppStateChange(policy: SyncRuntimePolicy): void;
  synchronize(): Promise<void>;
  sendCurrentClipboard(): Promise<SyncAdapterDelivery>;
  sendImportedText(
    text: string,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery>;
  sendImportedAsset(
    asset: SyncImportedAsset,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery>;
  observeClipboardChange(
    content: ClipboardContent,
    dispatch: boolean
  ): Promise<SyncAdapterDelivery | null>;
  subscribe(listener: (event: SyncAdapterEvent) => void): () => void;
}

export interface SyncRuntimeSnapshot {
  activeTransport: SyncTransportId;
  pendingTransport: SyncTransportId | null;
  status: SyncRuntimeStatus;
  lastError: string | null;
  lastEvent: SyncAdapterEvent | null;
}
import type { ClipboardContent } from '@/types/clipboard';
