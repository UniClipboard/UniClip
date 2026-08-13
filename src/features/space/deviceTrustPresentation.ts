import type {
  DeviceSyncRelationship,
  DeviceTrustChoice,
  DeviceTrustImpact,
  DeviceTrustSnapshot,
} from '@/platform/engine';
import type { UnifiedSpaceDevice } from './store';

export type DeviceTrustPrimaryStatus =
  | 'waitingForLocalDecision'
  | 'unverifiable'
  | 'upgradeRequired'
  | 'differentSpace'
  | 'removed'
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
  reachability: 'online' | 'offline' | 'unknown';
  primaryStatus: DeviceTrustPrimaryStatus;
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
      primaryStatus: 'usable',
    }));
  }
  const labels = displayNames(snapshot);
  return snapshot.devices.map((device) => ({
    deviceId: device.deviceId,
    displayName: labels.get(device.deviceId) ?? device.displayName,
    isLocal: device.isLocal,
    reachability: device.reachability,
    primaryStatus: primaryStatus(device.syncRelationship),
  }));
}
