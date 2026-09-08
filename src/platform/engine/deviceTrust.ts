import type {
  DeviceTrustChoice as NativeDeviceTrustChoice,
  DeviceTrustQueryResult as NativeDeviceTrustQueryResult,
  JoinSpaceStatus,
} from 'uc-engine';

export type DeviceMembership = 'active' | 'removed' | 'unavailable' | 'unknown';
export type DeviceReachability = 'online' | 'offline' | 'unknown';
export type DeviceGroupRelationship =
  | 'consistent'
  | 'confirmationPending'
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

export interface DeviceGroupChoiceDevice {
  deviceId: string;
  displayName: string;
}

export interface DeviceGroupChoiceReason {
  kind:
    | 'unknown'
    | 'pending_removal'
    | 'different_removals'
    | 'removal_decision_disagreement'
    | 'diverged_history';
  detailsComplete: boolean;
  changes: {
    side: 'local' | 'remote';
    kind: 'added_device' | 'removed_device';
    actor: DeviceGroupChoiceDevice;
    target: DeviceGroupChoiceDevice;
  }[];
  decisions: {
    device: DeviceGroupChoiceDevice;
    decision: 'accepted' | 'rejected';
    target: DeviceGroupChoiceDevice;
  }[];
}

export interface DeviceGroupChoiceOption {
  choiceId: string;
  isCurrentGroup: boolean;
  requiresRePairing: boolean;
  memberDeviceIds: string[];
  membersComplete: boolean;
  members?: (DeviceGroupChoiceDevice & { isLocal: boolean; active: boolean })[];
  sourceDeviceIds?: string[];
  impact?: {
    syncScopeDeviceIds: string[];
    pausedDeviceIds: string[];
    pendingConfirmationDeviceIds: string[];
    requiresRejoinDeviceIds: string[];
    localDeviceOutcome: DeviceMembership;
  } | null;
}

export interface DeviceGroupChoiceIssue {
  issueId: string;
  choices: DeviceGroupChoiceOption[];
  reason?: DeviceGroupChoiceReason;
}

export interface DeviceTrustSnapshot {
  currentJoin?: JoinSpaceStatus | null;
  groupChoices?: { revision: number; issues: DeviceGroupChoiceIssue[] };

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
  | {
      kind: 'completed' | 'pending' | 'rePairingRequired';
      snapshot: DeviceTrustSnapshot;
    }
  | { kind: 'applied'; changeId: string; snapshot: DeviceTrustSnapshot }
  | {
      kind: 'keptCurrentDeviceGroup';
      changeId: string;
      snapshot: DeviceTrustSnapshot;
    }
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
const REACHABILITY = {
  online: 'online',
  offline: 'offline',
  unknown: 'unknown',
} as const;
const GROUP_RELATIONSHIP = {
  consistent: 'consistent',
  confirmation_pending: 'confirmationPending',
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

function currentJoin(value: unknown): JoinSpaceStatus | null {
  if (value == null) return null;
  const source = object(value);
  const joinId = nonemptyString(source.join_id);
  switch (source.status) {
    case 'pending':
      return {
        type: 'pending',
        joinId,
        targetSpaceId:
          source.target_space_id === null ? null : nonemptyString(source.target_space_id),
        sponsorDeviceId:
          source.sponsor_device_id === null ? null : nonemptyString(source.sponsor_device_id),
        sponsorIdentityFingerprint:
          source.sponsor_identity_fingerprint === null
            ? null
            : nonemptyString(source.sponsor_identity_fingerprint),
        cancelRequested: boolean(source.cancel_requested),
        peerUpgradeRequired: boolean(source.peer_upgrade_required),
      };
    case 'active': {
      const joined = object(source.joined_space);
      return {
        type: 'active',
        joinId,
        peerUpgradeRequired: boolean(source.peer_upgrade_required),
        joinedSpace: {
          sponsorDeviceId: nonemptyString(joined.sponsor_device_id),
          sponsorIdentityFingerprint: nonemptyString(joined.sponsor_identity_fingerprint),
          spaceId: nonemptyString(joined.space_id),
          selfDeviceId: nonemptyString(joined.self_device_id),
          selfIdentityFingerprint: nonemptyString(joined.self_identity_fingerprint),
          migratedRecords:
            joined.migrated_records === null ? 0 : integer(joined.migrated_records, 0),
          preservedUnreadableRecords:
            joined.preserved_unreadable_records === null
              ? 0
              : integer(joined.preserved_unreadable_records, 0),
        },
      };
    }
    case 'rejected':
      return {
        type: 'rejected',
        joinId,
        reason: enumValue(source.reason, {
          invitation_unavailable: 'invitationUnavailable',
          authentication_rejected: 'authenticationRejected',
          identity_conflict: 'identityConflict',
          base_history_changed: 'baseHistoryChanged',
          joiner_history_ahead: 'joinerHistoryAhead',
          history_conflict: 'historyConflict',
          peer_upgrade_required: 'peerUpgradeRequired',
          cancelled: 'cancelled',
          removed_before_activation: 'removedBeforeActivation',
        } as const),
      };
    default:
      throw new Error();
  }
}

function snapshot(value: unknown): DeviceTrustSnapshot {
  const source = object(value);
  if (source.recovery !== 'not_available_in_this_version') throw new Error();
  return {
    revision: integer(source.revision, 0),
    localDeviceId: string(source.local_device_id),
    localMembership: enumValue(source.local_membership, MEMBERSHIP),
    currentChange: change(source.current_change),
    currentJoin: currentJoin(source.current_join),
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
        return {
          kind: 'applied',
          changeId: string(source.change_id),
          snapshot: parsedSnapshot,
        };
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

function groupDevice(value: unknown): DeviceGroupChoiceDevice {
  const source = object(value);
  return {
    deviceId: nonemptyString(source.device_id),
    displayName: string(source.display_name),
  };
}

function groupReason(value: unknown): DeviceGroupChoiceReason {
  const source = object(value);
  return {
    kind: enumValue(source.kind, {
      unknown: 'unknown',
      pending_removal: 'pending_removal',
      different_removals: 'different_removals',
      removal_decision_disagreement: 'removal_decision_disagreement',
      diverged_history: 'diverged_history',
    } as const),
    detailsComplete: boolean(source.details_complete),
    changes: array(source.changes, (value) => {
      const change = object(value);
      return {
        side: enumValue(change.side, {
          local: 'local',
          remote: 'remote',
        } as const),
        kind: enumValue(change.kind, {
          added_device: 'added_device',
          removed_device: 'removed_device',
        } as const),
        actor: groupDevice(change.actor),
        target: groupDevice(change.target),
      };
    }),
    decisions: array(source.decisions, (value) => {
      const decision = object(value);
      return {
        device: groupDevice(decision.device),
        target: groupDevice(decision.target),
        decision: enumValue(decision.decision, {
          accepted: 'accepted',
          rejected: 'rejected',
        } as const),
      };
    }),
  };
}

function groupImpact(value: unknown): DeviceGroupChoiceOption['impact'] {
  if (value === null) return null;
  const source = object(value);
  return {
    syncScopeDeviceIds: array(source.sync_scope_device_ids, nonemptyString),
    pausedDeviceIds: array(source.paused_device_ids, nonemptyString),
    pendingConfirmationDeviceIds: array(
      source.pending_confirmation_device_ids,
      nonemptyString
    ),
    requiresRejoinDeviceIds: array(source.requires_rejoin_device_ids, nonemptyString),
    localDeviceOutcome: enumValue(source.local_device_outcome, MEMBERSHIP),
  };
}

export function parseDeviceGroupChoices(
  result: NativeDeviceTrustQueryResult
): DeviceTrustSnapshot {
  if (!result.ok) throw Object.assign(new Error('Device trust query failed'), result.failure);
  try {
    const source = object(JSON.parse(result.value));
    const issues = array(source.issues, (value): DeviceGroupChoiceIssue => {
      const issue = object(value);
      const choices = array(issue.choices, (value): DeviceGroupChoiceOption => {
        const choice = object(value);
        return {
          choiceId: nonemptyString(choice.choice_id),
          isCurrentGroup: boolean(choice.is_current_group),
          requiresRePairing: boolean(choice.requires_re_pairing),
          memberDeviceIds: array(choice.member_device_ids, string),
          membersComplete: boolean(choice.members_complete),
          ...(choice.members === undefined
            ? {}
            : {
                members: array(choice.members, (value) => {
                  const member = object(value);
                  return {
                    ...groupDevice(member),
                    isLocal: boolean(member.is_local),
                    active: boolean(member.active),
                  };
                }),
              }),
          ...(choice.source_device_ids === undefined
            ? {}
            : {
                sourceDeviceIds: array(choice.source_device_ids, nonemptyString),
              }),
          ...(choice.impact === undefined ? {} : { impact: groupImpact(choice.impact) }),
        };
      });
      if (new Set(choices.map((choice) => choice.choiceId)).size !== choices.length)
        throw new Error();
      return {
        issueId: nonemptyString(issue.issue_id),
        choices,
        ...(issue.reason === undefined ? {} : { reason: groupReason(issue.reason) }),
      };
    });
    if (new Set(issues.map((issue) => issue.issueId)).size !== issues.length)
      throw new Error();
    return {
      ...snapshot(source.device_trust),
      groupChoices: { revision: integer(source.revision, 0), issues },
    };
  } catch {
    throw new Error('Invalid device group choices');
  }
}

function nonemptyString(value: unknown): string {
  const result = string(value);
  if (!result.trim()) throw new Error();
  return result;
}

export function parseDeviceGroupChoiceResult(value: string) {
  try {
    const source = object(JSON.parse(value));
    return {
      outcome: enumValue(source.outcome, {
        completed: 'completed',
        pending: 'pending',
        re_pairing_required: 'rePairingRequired',
        already_completed: 'alreadyCompleted',
        state_changed: 'stateChanged',
        local_device_confirmation_required: 'localDeviceConfirmationRequired',
      } as const),
      currentRevision:
        source.current_revision === null ? null : integer(source.current_revision, 0),
    };
  } catch {
    throw new Error('Invalid device group choice result');
  }
}
