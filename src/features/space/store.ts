import { create } from 'zustand';
import type { InvitationIssued, MemberRevocationResult, SpaceInvitation } from '@/platform/engine';

export interface UnifiedSpaceDevice {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  online: boolean;
}

export type UnifiedSpaceStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'failed';

export interface UnifiedSpaceSnapshot {
  status: UnifiedSpaceStatus;
  spaceId: string | null;
  deviceName: string | null;
  invitation: InvitationIssued | SpaceInvitation | null;
  devices: UnifiedSpaceDevice[];
  memberRemoval: MemberRevocationResult | null;
  lastError: string | null;
}

export function createInitialUnifiedSpaceSnapshot(
  status: UnifiedSpaceStatus = 'idle'
): UnifiedSpaceSnapshot {
  return {
    status,
    spaceId: null,
    deviceName: null,
    invitation: null,
    devices: [],
    memberRemoval: null,
    lastError: null,
  };
}

export const useUnifiedSpaceStore = create<UnifiedSpaceSnapshot>(() =>
  createInitialUnifiedSpaceSnapshot()
);

export function publishUnifiedSpaceSnapshot(snapshot: UnifiedSpaceSnapshot): void {
  useUnifiedSpaceStore.setState(snapshot, true);
}
