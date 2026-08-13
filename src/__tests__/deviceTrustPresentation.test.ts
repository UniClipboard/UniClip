import {
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
  initialDeviceTrustChoice,
} from '../features/space/deviceTrustPresentation';
import type { DeviceTrustSnapshot } from '../platform/engine';

function snapshot(): DeviceTrustSnapshot {
  return {
    revision: 1,
    localDeviceId: 'phone-12345678',
    localMembership: 'active',
    currentChange: {
      changeId: 'change-1',
      proposedByDeviceId: 'desktop-12345678',
      targetDeviceIds: ['tablet-abcdef12'],
      includesLocalDevice: false,
      applyImpact: {
        usableDeviceIds: ['phone-12345678', 'desktop-12345678'],
        pausedDeviceIds: ['tablet-abcdef12'],
        localDeviceOutcome: 'active',
        requiresRejoinDeviceIds: ['tablet-abcdef12'],
      },
      keepCurrentImpact: {
        usableDeviceIds: ['phone-12345678', 'tablet-abcdef12'],
        pausedDeviceIds: ['desktop-12345678'],
        localDeviceOutcome: 'active',
        requiresRejoinDeviceIds: ['desktop-12345678'],
      },
      allowedChoices: ['keepCurrentDeviceGroup'],
      blockedReason: null,
    },
    devices: [
      {
        deviceId: 'phone-12345678',
        displayName: 'Phone',
        isLocal: true,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'consistent',
        compatibility: 'compatible',
        syncRelationship: 'usable',
        availableActions: [],
        blockedReason: null,
      },
      {
        deviceId: 'desktop-12345678',
        displayName: 'Work',
        isLocal: false,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'pendingLocalDecision',
        compatibility: 'compatible',
        syncRelationship: 'waitingForLocalDecision',
        availableActions: [],
        blockedReason: null,
      },
      {
        deviceId: 'tablet-abcdef12',
        displayName: 'Work',
        isLocal: false,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'diverged',
        compatibility: 'compatible',
        syncRelationship: 'pausedGroupDiverged',
        availableActions: [],
        blockedReason: null,
      },
      {
        deviceId: 'old-99887766',
        displayName: 'Old laptop',
        isLocal: false,
        reachability: 'offline',
        membership: 'removed',
        groupRelationship: 'unknown',
        compatibility: 'unknown',
        syncRelationship: 'removedPeerDevice',
        availableActions: [],
        blockedReason: null,
      },
    ],
    recovery: 'notAvailableInThisVersion',
    allowedActions: ['keepCurrentDeviceGroup'],
    blockedReason: null,
    updatedAtMs: 1,
  };
}

describe('device trust presentation', () => {
  it('shows only Engine-allowed choices and their exact impact groups', () => {
    const view = buildDeviceTrustDecisionView(snapshot());

    expect(view?.sourceName).toBe('Work · 12345678');
    expect(view?.targetNames).toEqual(['Work · abcdef12']);
    expect(view?.choices).toEqual([
      expect.objectContaining({
        choice: 'keepCurrentDeviceGroup',
        continueSyncNames: ['Phone', 'Work · abcdef12'],
        stopSyncNames: ['Work · 12345678'],
      }),
    ]);
  });

  it('resets selection to the first allowed choice when the change changes', () => {
    expect(initialDeviceTrustChoice(snapshot(), 'old-change', 'applyChange')).toEqual({
      changeId: 'change-1',
      choice: 'keepCurrentDeviceGroup',
    });
  });

  it('keeps trust relationships visible and never lets online override their main state', () => {
    const views = buildDeviceTrustDeviceViews(snapshot(), [
      { deviceId: 'desktop-12345678', displayName: 'Temporary', isLocal: false, online: true },
    ]);

    expect(views.map((view) => [view.deviceId, view.primaryStatus, view.reachability])).toEqual([
      ['phone-12345678', 'usable', 'online'],
      ['desktop-12345678', 'waitingForLocalDecision', 'online'],
      ['tablet-abcdef12', 'differentSpace', 'online'],
      ['old-99887766', 'removed', 'offline'],
    ]);
    expect(views[1]?.displayName).toBe('Work · 12345678');
    expect(views[2]?.displayName).toBe('Work · abcdef12');
  });
});
