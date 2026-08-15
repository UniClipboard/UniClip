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

export type SpaceOperationKind = 'removeMember' | 'applyChange' | 'keepCurrentSpace' | 'leaveSpace';

export interface SpaceOperationDevice {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  reachability: 'online' | 'offline' | 'unknown';
}

export interface SpaceOperationContext {
  kind: SpaceOperationKind;
  spaceId: string | null;
  targetDeviceId: string | null;
  localDeviceId: string | null;
  beforeDevices: SpaceOperationDevice[];
}

export interface SpaceOperationResult {
  kind: SpaceOperationKind;
  spaceId: string | null;
  targetDeviceId: string | null;
  localDeviceInSpace: boolean;
  usableDevices: SpaceOperationDevice[];
  separatedDevices: SpaceOperationDevice[];
  continuingSpaceDevices: SpaceOperationDevice[];
  verification: 'verified' | 'unverified';
  hasOfflineDevices: boolean;
  decisionOutcome: DeviceTrustDecision['kind'] | null;
}

export type SpaceOperationState =
  | { kind: 'idle' }
  | { kind: 'submitting'; operation: SpaceOperationContext }
  | { kind: 'result'; result: SpaceOperationResult };

export interface DeviceTrustFailure {
  operation: 'queryDeviceTrust';
  code: number | null;
  category: string | null;
  retryable: boolean;
}

export type DeviceTrustQueryState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: DeviceTrustSnapshot | null }
  | { kind: 'ready'; snapshot: DeviceTrustSnapshot }
  | { kind: 'notApplicable' }
  | { kind: 'unavailable'; failure: DeviceTrustFailure }
  | { kind: 'failed'; failure: DeviceTrustFailure }
  | { kind: 'corrupt'; failure: DeviceTrustFailure };

export interface UnifiedSpaceSnapshot {
  status: UnifiedSpaceStatus;
  spaceId: string | null;
  deviceName: string | null;
  invitation: InvitationIssued | SpaceInvitation | null;
  devices: UnifiedSpaceDevice[];
  workspaceConvergence: WorkspaceConvergence | null;
  deviceTrustQuery: DeviceTrustQueryState;
  deviceTrustDecisionStatus: DeviceTrustDecisionStatus;
  deviceTrustDecisionError: string | null;
  deviceTrustDecisionOutcome: DeviceTrustDecision['kind'] | null;
  operationState: SpaceOperationState;
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
    deviceTrustQuery: status === 'empty' ? { kind: 'notApplicable' } : { kind: 'idle' },
    deviceTrustDecisionStatus: 'idle',
    deviceTrustDecisionError: null,
    deviceTrustDecisionOutcome: null,
    operationState: { kind: 'idle' },
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
