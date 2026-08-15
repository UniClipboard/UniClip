import type {
  DeviceCompatibility,
  DeviceGroupRelationship,
  DeviceMembership,
  DeviceReachability,
  DeviceSyncRelationship,
  DeviceTrustChoice,
  DeviceTrustImpact,
  DeviceTrustSnapshot,
  DeviceTrustUnavailableReason,
} from '@/platform/engine';
import type {
  DeviceListRefreshStatus,
  DeviceTrustQueryState,
  SpaceOperationContext,
  SpaceOperationDevice,
  SpaceOperationKind,
  SpaceOperationResult,
  SpaceOperationState,
  UnifiedSpaceDevice,
  UnifiedSpaceStatus,
} from './store';

export type DeviceTrustPrimaryStatus =
  | 'waitingForLocalDecision'
  | 'unverifiable'
  | 'upgradeRequired'
  | 'differentSpace'
  | 'removed'
  | 'updating'
  | 'usable'
  | 'unknown';

export interface DeviceTrustChoiceView {
  choice: DeviceTrustChoice;
  exitsCurrentSpace: boolean;
  continueSyncNames: string[];
  stopSyncNames: string[];
  requiresRejoinNames: string[];
}

export interface DeviceTrustDecisionView {
  changeId: string;
  sourceName: string;
  targetNames: string[];
  choices: DeviceTrustChoiceView[];
}

export interface DeviceTrustDeviceView {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  reachability: DeviceReachability;
  membership: DeviceMembership;
  groupRelationship: DeviceGroupRelationship;
  compatibility: DeviceCompatibility;
  syncRelationship: DeviceSyncRelationship;
  primaryStatus: DeviceTrustPrimaryStatus;
  canSync: boolean;
  canRemove: boolean;
  canUpdateThisDevice: boolean;
  blockedReason: DeviceTrustUnavailableReason | null;
}

export type SpaceOverviewPrimaryStatus =
  | 'decisionRequired'
  | 'unverifiable'
  | 'updateRequired'
  | 'updating'
  | 'refreshing'
  | 'healthy'
  | 'empty';

export interface SpaceOverviewView {
  memberCount: number;
  primaryStatus: SpaceOverviewPrimaryStatus;
  hasPendingDecision: boolean;
  isRefreshing: boolean;
}

export function deviceTrustSnapshotFromQuery(
  query: DeviceTrustQueryState
): DeviceTrustSnapshot | null {
  if (query.kind === 'ready') return query.snapshot;
  if (query.kind === 'loading') return query.previous;
  return null;
}

function displayNames(snapshot: DeviceTrustSnapshot): Map<string, string> {
  const counts = new Map<string, number>();
  for (const device of snapshot.devices) {
    counts.set(device.displayName, (counts.get(device.displayName) ?? 0) + 1);
  }
  return new Map(
    snapshot.devices.map((device) => [
      device.deviceId,
      counts.get(device.displayName) === 1
        ? device.displayName
        : `${device.displayName} · ${device.deviceId.slice(-8)}`,
    ])
  );
}

function names(ids: string[], labels: Map<string, string>): string[] {
  return ids.map((id) => labels.get(id) ?? id.slice(-8));
}

function choiceView(
  choice: DeviceTrustChoice,
  impact: DeviceTrustImpact,
  labels: Map<string, string>
): DeviceTrustChoiceView {
  return {
    choice,
    exitsCurrentSpace: impact.localDeviceOutcome === 'removed',
    continueSyncNames: names(impact.usableDeviceIds, labels),
    stopSyncNames: names(impact.pausedDeviceIds, labels),
    requiresRejoinNames: names(impact.requiresRejoinDeviceIds, labels),
  };
}

export function buildDeviceTrustDecisionView(
  snapshot: DeviceTrustSnapshot | null
): DeviceTrustDecisionView | null {
  const change = snapshot?.currentChange;
  if (!snapshot || !change) return null;
  const labels = displayNames(snapshot);
  return {
    changeId: change.changeId,
    sourceName: labels.get(change.proposedByDeviceId) ?? change.proposedByDeviceId.slice(-8),
    targetNames: names(change.targetDeviceIds, labels),
    choices: change.allowedChoices.map((choice) =>
      choiceView(
        choice,
        choice === 'applyChange' ? change.applyImpact : change.keepCurrentImpact,
        labels
      )
    ),
  };
}

export function initialDeviceTrustChoice(
  snapshot: DeviceTrustSnapshot | null,
  previousChangeId: string | null,
  previousChoice: DeviceTrustChoice | null
): { changeId: string | null; choice: DeviceTrustChoice | null } {
  const change = snapshot?.currentChange;
  if (!change) return { changeId: null, choice: null };
  if (change.changeId === previousChangeId && previousChoice) {
    if (change.allowedChoices.includes(previousChoice)) {
      return { changeId: change.changeId, choice: previousChoice };
    }
  }
  return { changeId: change.changeId, choice: change.allowedChoices[0] ?? null };
}

function primaryStatus(sync: DeviceSyncRelationship): DeviceTrustPrimaryStatus {
  switch (sync) {
    case 'waitingForLocalDecision':
      return 'waitingForLocalDecision';
    case 'pausedUnverifiable':
      return 'unverifiable';
    case 'pausedUpgradeRequired':
      return 'upgradeRequired';
    case 'pausedGroupDiverged':
      return 'differentSpace';
    case 'removedLocalDevice':
    case 'removedPeerDevice':
      return 'removed';
    case 'usable':
      return 'usable';
    case 'unknown':
      return 'unknown';
  }
}

export function buildDeviceTrustDeviceViews(
  snapshot: DeviceTrustSnapshot | null,
  fallbackDevices: UnifiedSpaceDevice[]
): DeviceTrustDeviceView[] {
  if (!snapshot) {
    return fallbackDevices.map((device) => ({
      deviceId: device.deviceId,
      displayName: device.displayName,
      isLocal: device.isLocal,
      reachability: device.isLocal || device.online ? 'online' : 'offline',
      membership: 'unavailable',
      groupRelationship: 'unverifiable',
      compatibility: 'unknown',
      syncRelationship: 'pausedUnverifiable',
      primaryStatus: 'unverifiable',
      canSync: false,
      canRemove: false,
      canUpdateThisDevice: false,
      blockedReason: 'engineUnavailable',
    }));
  }
  const labels = displayNames(snapshot);
  const hasPendingDecision = snapshot.currentChange !== null;
  return snapshot.devices
    .filter(
      (device) =>
        device.membership !== 'removed' &&
        device.groupRelationship !== 'diverged' &&
        device.syncRelationship !== 'pausedGroupDiverged' &&
        device.syncRelationship !== 'removedLocalDevice' &&
        device.syncRelationship !== 'removedPeerDevice'
    )
    .map((device) => ({
      deviceId: device.deviceId,
      displayName: labels.get(device.deviceId) ?? device.displayName,
      isLocal: device.isLocal,
      reachability: device.reachability,
      membership: device.membership,
      groupRelationship: device.groupRelationship,
      compatibility: device.compatibility,
      syncRelationship: device.syncRelationship,
      primaryStatus: primaryStatus(device.syncRelationship),
      canSync: device.syncRelationship === 'usable',
      canRemove:
        !device.isLocal &&
        device.membership === 'active' &&
        device.groupRelationship === 'consistent' &&
        device.blockedReason === null &&
        !hasPendingDecision,
      canUpdateThisDevice: device.isLocal && device.availableActions.includes('updateThisDevice'),
      blockedReason: device.blockedReason,
    }));
}

export function buildCurrentSpaceDeviceViews(
  query: DeviceTrustQueryState,
  rosterDevices: UnifiedSpaceDevice[],
  operationState: SpaceOperationState = { kind: 'idle' }
): DeviceTrustDeviceView[] {
  const snapshot = deviceTrustSnapshotFromQuery(query);
  if (snapshot?.localMembership === 'removed') return [];
  const views = buildDeviceTrustDeviceViews(snapshot, rosterDevices);
  return views.map((view) => ({
    ...view,
    primaryStatus:
      operationState.kind === 'submitting' &&
      (view.primaryStatus === 'usable' || view.primaryStatus === 'unknown')
        ? 'updating'
        : view.primaryStatus,
    canRemove: query.kind === 'ready' && operationState.kind === 'idle' ? view.canRemove : false,
  }));
}

export function buildSpaceOverviewView(
  spaceStatus: UnifiedSpaceStatus,
  query: DeviceTrustQueryState,
  deviceListRefreshStatus: DeviceListRefreshStatus,
  rosterDevices: UnifiedSpaceDevice[] = [],
  operationState: SpaceOperationState = { kind: 'idle' }
): SpaceOverviewView {
  const snapshot = deviceTrustSnapshotFromQuery(query);
  const devices = buildCurrentSpaceDeviceViews(query, rosterDevices, operationState);
  const hasPendingDecision =
    snapshot?.currentChange !== null && snapshot?.currentChange !== undefined;
  const isRefreshing = query.kind === 'loading' || deviceListRefreshStatus === 'refreshing';
  let primaryStatus: SpaceOverviewPrimaryStatus;

  if (
    spaceStatus === 'empty' ||
    query.kind === 'notApplicable' ||
    snapshot?.localMembership === 'removed'
  ) {
    primaryStatus = 'empty';
  } else if (hasPendingDecision) {
    primaryStatus = 'decisionRequired';
  } else if (
    query.kind === 'unavailable' ||
    query.kind === 'failed' ||
    query.kind === 'corrupt' ||
    devices.some((device) => device.syncRelationship === 'pausedUnverifiable')
  ) {
    primaryStatus = 'unverifiable';
  } else if (
    devices.some(
      (device) =>
        device.compatibility === 'upgradeRequired' ||
        device.syncRelationship === 'pausedUpgradeRequired'
    )
  ) {
    primaryStatus = 'updateRequired';
  } else if (operationState.kind === 'submitting') {
    primaryStatus = 'updating';
  } else if (isRefreshing || spaceStatus === 'loading' || query.kind === 'idle') {
    primaryStatus = 'refreshing';
  } else if (query.kind === 'ready') {
    primaryStatus = 'healthy';
  } else {
    primaryStatus = 'unverifiable';
  }

  return {
    memberCount: devices.length,
    primaryStatus,
    hasPendingDecision,
    isRefreshing,
  };
}

function operationDevice(device: DeviceTrustDeviceView): SpaceOperationDevice {
  return {
    deviceId: device.deviceId,
    displayName: device.displayName,
    isLocal: device.isLocal,
    reachability: device.reachability,
  };
}

export function buildSpaceOperationContext(
  kind: SpaceOperationKind,
  spaceId: string | null,
  query: DeviceTrustQueryState,
  rosterDevices: UnifiedSpaceDevice[],
  targetDeviceId: string | null = null
): SpaceOperationContext {
  const snapshot = deviceTrustSnapshotFromQuery(query);
  const beforeDevices = buildCurrentSpaceDeviceViews(query, rosterDevices).map(operationDevice);
  if (targetDeviceId && !beforeDevices.some((device) => device.deviceId === targetDeviceId)) {
    const target = rosterDevices.find((device) => device.deviceId === targetDeviceId);
    if (target) {
      beforeDevices.push({
        deviceId: target.deviceId,
        displayName: target.displayName,
        isLocal: target.isLocal,
        reachability: target.isLocal || target.online ? 'online' : 'offline',
      });
    }
  }
  return {
    kind,
    spaceId,
    targetDeviceId,
    localDeviceId:
      snapshot?.localDeviceId ?? rosterDevices.find((device) => device.isLocal)?.deviceId ?? null,
    beforeDevices,
  };
}

export function buildSpaceOperationResult(
  context: SpaceOperationContext,
  query: DeviceTrustQueryState,
  rosterDevices: UnifiedSpaceDevice[],
  verification: SpaceOperationResult['verification'],
  decisionOutcome: SpaceOperationResult['decisionOutcome'] = null
): SpaceOperationResult {
  if (context.kind === 'leaveSpace') {
    const local = context.beforeDevices.filter((device) => device.isLocal);
    const continuing = context.beforeDevices.filter((device) => !device.isLocal);
    return {
      kind: context.kind,
      spaceId: context.spaceId,
      targetDeviceId: null,
      localDeviceInSpace: false,
      usableDevices: [],
      separatedDevices: local,
      continuingSpaceDevices: continuing,
      verification,
      hasOfflineDevices: continuing.some((device) => device.reachability !== 'online'),
      decisionOutcome,
    };
  }

  const currentViews = buildCurrentSpaceDeviceViews(query, rosterDevices);
  const currentIds = new Set(currentViews.map((device) => device.deviceId));
  const usableDevices = currentViews.filter((device) => device.canSync).map(operationDevice);
  const localDeviceInSpace = context.localDeviceId
    ? currentIds.has(context.localDeviceId)
    : currentViews.some((device) => device.isLocal);
  const localDeviceLeft = context.localDeviceId !== null && !localDeviceInSpace;
  const separatedDevices = localDeviceLeft
    ? context.beforeDevices.filter((device) => device.deviceId === context.localDeviceId)
    : context.beforeDevices.filter(
        (device) =>
          !currentIds.has(device.deviceId) ||
          (context.kind === 'removeMember' && device.deviceId === context.targetDeviceId)
      );
  const continuingSpaceDevices = localDeviceLeft
    ? context.beforeDevices.filter((device) => device.deviceId !== context.localDeviceId)
    : [];
  return {
    kind: context.kind,
    spaceId: context.spaceId,
    targetDeviceId: context.targetDeviceId,
    localDeviceInSpace,
    usableDevices,
    separatedDevices,
    continuingSpaceDevices,
    verification,
    hasOfflineDevices: [...currentViews, ...continuingSpaceDevices].some(
      (device) => !device.isLocal && device.reachability !== 'online'
    ),
    decisionOutcome,
  };
}
