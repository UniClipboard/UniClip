import type { OutboundProgressSnapshot } from "@/platform/engine/outboundProgressProjection";
import { create } from 'zustand';
import type { EngineEvent, EngineState, EngineFailure, RejectedConfigImport } from '@/platform/engine';

export type UnifiedEngineStatus = EngineState | 'starting' | 'failed';
export type PeerConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';
export type UnifiedEngineFailure = Extract<EngineEvent, { type: 'fatal' }>['failure'];
export type UnifiedEngineLifecycleFailure = Pick<
  Extract<EngineEvent, { type: 'lifecycleFailed' }>,
  'action' | 'failure'
>;

export type ConfigImportStatus =
  | { kind: 'unchecked' }
  | { kind: 'checked'; rejection: RejectedConfigImport | null }
  | { kind: 'unavailable'; failure: EngineFailure | null };

export interface UnifiedEngineSnapshot {
  outbound: OutboundProgressSnapshot;
  configImportStatus: ConfigImportStatus;
  status: UnifiedEngineStatus;
  isStarted: boolean;
  lastEvent: EngineEvent | null;
  lastError: string | null;
  fatalFailure: UnifiedEngineFailure | null;
  lifecycleFailure: UnifiedEngineLifecycleFailure | null;
  peerConnectionStatus: PeerConnectionStatus;
  refreshRevision: number;
  lastChangedKind: string | null;
}

export function createInitialUnifiedEngineSnapshot(): UnifiedEngineSnapshot {
  return {
    outbound: { progress: [], available: false, failure: null },
    status: 'stopped',
    configImportStatus: { kind: 'unchecked' },
    isStarted: false,
    lastEvent: null,
    lastError: null,
    fatalFailure: null,
    lifecycleFailure: null,
    peerConnectionStatus: 'idle',
    refreshRevision: 0,
    lastChangedKind: null,
  };
}

export const useUnifiedEngineStore = create<UnifiedEngineSnapshot>(() =>
  createInitialUnifiedEngineSnapshot()
);

export function publishUnifiedEngineSnapshot(snapshot: UnifiedEngineSnapshot): void {
  useUnifiedEngineStore.setState(snapshot, true);
}
