import { create } from 'zustand';
import type { InvitationIssued, SpaceInvitation, WorkspaceConvergence } from '@/platform/engine';

export interface UnifiedSpaceDevice {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  online: boolean;
}

export type UnifiedSpaceStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'failed';

export type DeviceListRefreshStatus = 'idle' | 'refreshing' | 'failed';

export interface UnifiedSpaceSnapshot {
  status: UnifiedSpaceStatus;
  spaceId: string | null;
  deviceName: string | null;
  invitation: InvitationIssued | SpaceInvitation | null;
  devices: UnifiedSpaceDevice[];
  workspaceConvergence: WorkspaceConvergence | null;
  lastError: string | null;
  hasResolvedDeviceList: boolean;
  deviceListRefreshStatus: DeviceListRefreshStatus;
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
    workspaceConvergence: null,
    lastError: null,
    hasResolvedDeviceList: false,
    deviceListRefreshStatus: 'idle',
  };
}

export const useUnifiedSpaceStore = create<UnifiedSpaceSnapshot>(() =>
  createInitialUnifiedSpaceSnapshot()
);

export function publishUnifiedSpaceSnapshot(snapshot: UnifiedSpaceSnapshot): void {
  useUnifiedSpaceStore.setState(snapshot, true);
}
