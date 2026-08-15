import type {
  DeviceTrustChoice as NativeDeviceTrustChoice,
  DeviceTrustQueryResult as NativeDeviceTrustQueryResult,
} from 'uc-engine';

export type DeviceMembership = 'active' | 'removed' | 'unavailable' | 'unknown';
export type DeviceReachability = 'online' | 'offline' | 'unknown';
export type DeviceGroupRelationship =
  | 'consistent'
  | 'pendingLocalDecision'
  | 'diverged'
  | 'unverifiable'
  | 'unknown';
export type DeviceCompatibility = 'compatible' | 'upgradeRequired' | 'unknown';
export type DeviceSyncRelationship =
  | 'usable'
  | 'waitingForLocalDecision'
  | 'pausedGroupDiverged'
  | 'pausedUpgradeRequired'
  | 'pausedUnverifiable'
  | 'removedLocalDevice'
  | 'removedPeerDevice'
  | 'unknown';
type DeviceTrustChoice = NativeDeviceTrustChoice;
export type DeviceTrustAction =
  | 'applyCurrentChange'
  | 'keepCurrentDeviceGroup'
  | 'confirmApplyRemovesLocalDevice'
  | 'rejoinDeviceGroup'
  | 'updateThisDevice';
export type DeviceTrustUnavailableReason =
  | 'noCurrentChange'
  | 'changeNoLongerCurrent'
  | 'localDeviceConfirmationRequired'
  | 'localDeviceRemoved'
  | 'recoveryNotAvailableInThisVersion'
  | 'peerUpgradeRequired'
  | 'deviceFactsUnverifiable'
  | 'engineUnavailable';

export interface DeviceTrustImpact {
  usableDeviceIds: string[];
  pausedDeviceIds: string[];
  localDeviceOutcome: DeviceMembership;
  requiresRejoinDeviceIds: string[];
}

export interface DeviceTrustChange {
  changeId: string;
  proposedByDeviceId: string;
  targetDeviceIds: string[];
  includesLocalDevice: boolean;
  applyImpact: DeviceTrustImpact;
  keepCurrentImpact: DeviceTrustImpact;
  allowedChoices: DeviceTrustChoice[];
  blockedReason: DeviceTrustUnavailableReason | null;
}

export interface DeviceTrustRelationship {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  reachability: DeviceReachability;
  membership: DeviceMembership;
  groupRelationship: DeviceGroupRelationship;
  compatibility: DeviceCompatibility;
  syncRelationship: DeviceSyncRelationship;
  availableActions: DeviceTrustAction[];
  blockedReason: DeviceTrustUnavailableReason | null;
}

export interface DeviceTrustSnapshot {
  revision: number;
  localDeviceId: string;
  localMembership: DeviceMembership;
  currentChange: DeviceTrustChange | null;
  devices: DeviceTrustRelationship[];
  recovery: 'notAvailableInThisVersion';
  allowedActions: DeviceTrustAction[];
  blockedReason: DeviceTrustUnavailableReason | null;
  updatedAtMs: number;
}

export type DeviceTrustDecision =
  | { kind: 'applied'; changeId: string; snapshot: DeviceTrustSnapshot }
  | { kind: 'keptCurrentDeviceGroup'; changeId: string; snapshot: DeviceTrustSnapshot }
  | {
      kind: 'alreadyCompleted';
      changeId: string;
      completedChoice: DeviceTrustChoice;
      snapshot: DeviceTrustSnapshot;
    }
  | {
      kind: 'stateChanged';
      currentChangeId: string | null;
      snapshot: DeviceTrustSnapshot;
    }
  | {
      kind: 'localDeviceConfirmationRequired';
      changeId: string;
      snapshot: DeviceTrustSnapshot;
    };

type JsonObject = Record<string, unknown>;

const MEMBERSHIP = {
  active: 'active',
  removed: 'removed',
  unavailable: 'unavailable',
  unknown: 'unknown',
} as const;
const REACHABILITY = { online: 'online', offline: 'offline', unknown: 'unknown' } as const;
const GROUP_RELATIONSHIP = {
  consistent: 'consistent',
  pending_local_decision: 'pendingLocalDecision',
  diverged: 'diverged',
  unverifiable: 'unverifiable',
  unknown: 'unknown',
} as const;
const COMPATIBILITY = {
  compatible: 'compatible',
  upgrade_required: 'upgradeRequired',
  unknown: 'unknown',
} as const;
const SYNC_RELATIONSHIP = {
  usable: 'usable',
  waiting_for_local_decision: 'waitingForLocalDecision',
  paused_group_diverged: 'pausedGroupDiverged',
  paused_upgrade_required: 'pausedUpgradeRequired',
  paused_unverifiable: 'pausedUnverifiable',
  removed_local_device: 'removedLocalDevice',
  removed_peer_device: 'removedPeerDevice',
  unknown: 'unknown',
} as const;
const CHOICE = {
  apply_change: 'applyChange',
  keep_current_device_group: 'keepCurrentDeviceGroup',
} as const;
const ACTION = {
  apply_current_change: 'applyCurrentChange',
  keep_current_device_group: 'keepCurrentDeviceGroup',
  confirm_apply_removes_local_device: 'confirmApplyRemovesLocalDevice',
  rejoin_device_group: 'rejoinDeviceGroup',
  update_this_device: 'updateThisDevice',
} as const;
const UNAVAILABLE_REASON = {
  no_current_change: 'noCurrentChange',
  change_no_longer_current: 'changeNoLongerCurrent',
  local_device_confirmation_required: 'localDeviceConfirmationRequired',
  local_device_removed: 'localDeviceRemoved',
  recovery_not_available_in_this_version: 'recoveryNotAvailableInThisVersion',
  peer_upgrade_required: 'peerUpgradeRequired',
  device_facts_unverifiable: 'deviceFactsUnverifiable',
  engine_unavailable: 'engineUnavailable',
} as const;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as JsonObject;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error();
  return value;
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error();
  return value as number;
}

function array<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error();
  return value.map(parse);
}

function enumValue<T extends Record<string, string>>(value: unknown, values: T): T[keyof T] {
  const key = string(value);
  if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error();
  return values[key as keyof T];
}

function nullableEnum<T extends Record<string, string>>(
  value: unknown,
  values: T
): T[keyof T] | null {
  return value === null ? null : enumValue(value, values);
}

function impact(value: unknown): DeviceTrustImpact {
  const source = object(value);
  return {
    usableDeviceIds: array(source.usable_device_ids, string),
    pausedDeviceIds: array(source.paused_device_ids, string),
    localDeviceOutcome: enumValue(source.local_device_outcome, MEMBERSHIP),
    requiresRejoinDeviceIds: array(source.requires_rejoin_device_ids, string),
  };
}

function change(value: unknown): DeviceTrustChange | null {
  if (value === null) return null;
  const source = object(value);
  return {
    changeId: string(source.change_id),
    proposedByDeviceId: string(source.proposed_by_device_id),
    targetDeviceIds: array(source.target_device_ids, string),
    includesLocalDevice: boolean(source.includes_local_device),
    applyImpact: impact(source.apply_impact),
    keepCurrentImpact: impact(source.keep_current_impact),
    allowedChoices: array(source.allowed_choices, (entry) => enumValue(entry, CHOICE)),
    blockedReason: nullableEnum(source.blocked_reason, UNAVAILABLE_REASON),
  };
}

function relationship(value: unknown): DeviceTrustRelationship {
  const source = object(value);
  return {
    deviceId: string(source.device_id),
    displayName: string(source.display_name),
    isLocal: boolean(source.is_local),
    reachability: enumValue(source.reachability, REACHABILITY),
    membership: enumValue(source.membership, MEMBERSHIP),
    groupRelationship: enumValue(source.group_relationship, GROUP_RELATIONSHIP),
    compatibility: enumValue(source.compatibility, COMPATIBILITY),
    syncRelationship: enumValue(source.sync_relationship, SYNC_RELATIONSHIP),
    availableActions: array(source.available_actions, (entry) => enumValue(entry, ACTION)),
    blockedReason: nullableEnum(source.blocked_reason, UNAVAILABLE_REASON),
  };
}

function snapshot(value: unknown): DeviceTrustSnapshot {
  const source = object(value);
  if (source.recovery !== 'not_available_in_this_version') throw new Error();
  return {
    revision: integer(source.revision, 0),
    localDeviceId: string(source.local_device_id),
    localMembership: enumValue(source.local_membership, MEMBERSHIP),
    currentChange: change(source.current_change),
    devices: array(source.devices, relationship),
    recovery: 'notAvailableInThisVersion',
    allowedActions: array(source.allowed_actions, (entry) => enumValue(entry, ACTION)),
    blockedReason: nullableEnum(source.blocked_reason, UNAVAILABLE_REASON),
    updatedAtMs: integer(source.updated_at_ms),
  };
}

export function parseDeviceTrustSnapshot(value: string): DeviceTrustSnapshot {
  try {
    return snapshot(JSON.parse(value));
  } catch {
    throw new Error('Invalid device trust snapshot');
  }
}

export function parseDeviceTrustQueryResult(
  result: NativeDeviceTrustQueryResult
): DeviceTrustSnapshot {
  if (result.ok) return parseDeviceTrustSnapshot(result.value);
  throw Object.assign(new Error('Device trust query failed'), result.failure);
}

export function parseDeviceTrustDecision(value: string): DeviceTrustDecision {
  try {
    const source = object(JSON.parse(value));
    const parsedSnapshot = snapshot(source.snapshot);
    switch (source.kind) {
      case 'applied':
        return { kind: 'applied', changeId: string(source.change_id), snapshot: parsedSnapshot };
      case 'kept_current_device_group':
        return {
          kind: 'keptCurrentDeviceGroup',
          changeId: string(source.change_id),
          snapshot: parsedSnapshot,
        };
      case 'already_completed':
        return {
          kind: 'alreadyCompleted',
          changeId: string(source.change_id),
          completedChoice: enumValue(source.completed_choice, CHOICE),
          snapshot: parsedSnapshot,
        };
      case 'state_changed':
        return {
          kind: 'stateChanged',
          currentChangeId:
            source.current_change_id === null || source.current_change_id === undefined
              ? null
              : string(source.current_change_id),
          snapshot: parsedSnapshot,
        };
      case 'local_device_confirmation_required':
        return {
          kind: 'localDeviceConfirmationRequired',
          changeId: string(source.change_id),
          snapshot: parsedSnapshot,
        };
      default:
        throw new Error();
    }
  } catch {
    throw new Error('Invalid device trust decision');
  }
}
