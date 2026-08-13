import { create } from 'zustand';
import type {
  DeviceTrustDecision,
  DeviceTrustSnapshot,
  InvitationIssued,
  SpaceInvitation,
  WorkspaceConvergence,
} from '@/platform/engine';

export interface UnifiedSpaceDevice {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  online: boolean;
}

export type UnifiedSpaceStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'failed';

export type DeviceListRefreshStatus = 'idle' | 'refreshing' | 'failed';
export type DeviceTrustDecisionStatus = 'idle' | 'submitting';

export interface UnifiedSpaceSnapshot {
  status: UnifiedSpaceStatus;
  spaceId: string | null;
  deviceName: string | null;
  invitation: InvitationIssued | SpaceInvitation | null;
  devices: UnifiedSpaceDevice[];
  workspaceConvergence: WorkspaceConvergence | null;
  deviceTrust: DeviceTrustSnapshot | null;
  deviceTrustDecisionStatus: DeviceTrustDecisionStatus;
  deviceTrustDecisionError: string | null;
  deviceTrustDecisionOutcome: DeviceTrustDecision['kind'] | null;
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
    deviceTrust: null,
    deviceTrustDecisionStatus: 'idle',
    deviceTrustDecisionError: null,
    deviceTrustDecisionOutcome: null,
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
