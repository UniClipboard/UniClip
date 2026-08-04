import { create } from 'zustand';
import type { EngineEvent, EngineState } from '@/platform/engine';

export type UnifiedEngineStatus = EngineState | 'starting' | 'failed';
export type PeerConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';
export type UnifiedEngineFailure = Extract<EngineEvent, { type: 'fatal' }>['failure'];
export type UnifiedEngineLifecycleFailure = Pick<
  Extract<EngineEvent, { type: 'lifecycleFailed' }>,
  'action' | 'failure'
>;

export interface UnifiedEngineSnapshot {
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
    status: 'stopped',
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
