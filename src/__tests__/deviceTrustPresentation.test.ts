import {
  buildCurrentSpaceDeviceViews,
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
  buildSpaceOverviewView,
  buildSpaceOperationContext,
  buildSpaceOperationResult,
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
      {
        deviceId: 'laptop-11223344',
        displayName: 'Laptop',
        isLocal: false,
        reachability: 'offline',
        membership: 'active',
        groupRelationship: 'consistent',
        compatibility: 'compatible',
        syncRelationship: 'usable',
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

  it('keeps only current-space relationships and never lets online override their main state', () => {
    const views = buildDeviceTrustDeviceViews(snapshot(), [
      { deviceId: 'desktop-12345678', displayName: 'Temporary', isLocal: false, online: true },
    ]);

    expect(views.map((view) => [view.deviceId, view.primaryStatus, view.reachability])).toEqual([
      ['phone-12345678', 'usable', 'online'],
      ['desktop-12345678', 'waitingForLocalDecision', 'online'],
      ['laptop-11223344', 'usable', 'offline'],
    ]);
    expect(views[1]?.displayName).toBe('Work · 12345678');
    expect(views[0]).toEqual(
      expect.objectContaining({
        membership: 'active',
        groupRelationship: 'consistent',
        compatibility: 'compatible',
        syncRelationship: 'usable',
        canSync: true,
        canRemove: false,
      })
    );
    expect(views[1]).toEqual(
      expect.objectContaining({
        membership: 'active',
        groupRelationship: 'pendingLocalDecision',
        syncRelationship: 'waitingForLocalDecision',
        canSync: false,
        canRemove: false,
      })
    );
    expect(views[2]).toEqual(expect.objectContaining({ canSync: true, canRemove: false }));
  });

  it('fails closed when only the ordinary roster is available', () => {
    const views = buildDeviceTrustDeviceViews(null, [
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
    ]);

    expect(views).toEqual([
      expect.objectContaining({
        deviceId: 'phone-1',
        primaryStatus: 'unverifiable',
        membership: 'unavailable',
        groupRelationship: 'unverifiable',
        syncRelationship: 'pausedUnverifiable',
        canSync: false,
        canRemove: false,
      }),
      expect.objectContaining({
        deviceId: 'desktop-1',
        primaryStatus: 'unverifiable',
        membership: 'unavailable',
        groupRelationship: 'unverifiable',
        syncRelationship: 'pausedUnverifiable',
        canSync: false,
        canRemove: false,
      }),
    ]);
  });

  it('allows removal only for a verified remote current member when no decision is pending', () => {
    const current = snapshot();
    current.currentChange = null;
    const views = buildDeviceTrustDeviceViews(current, []);

    expect(views.find((device) => device.isLocal)?.canRemove).toBe(false);
    expect(views.find((device) => device.deviceId === 'laptop-11223344')?.canRemove).toBe(true);
  });

  it('shows no current-space devices after the local device has been removed', () => {
    const removed = snapshot();
    removed.localMembership = 'removed';

    expect(
      buildCurrentSpaceDeviceViews({ kind: 'ready', snapshot: removed }, [
        { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      ])
    ).toEqual([]);
    expect(
      buildSpaceOverviewView('ready', { kind: 'ready', snapshot: removed }, 'idle').primaryStatus
    ).toBe('empty');
  });

  it('chooses the highest-priority space overview without treating offline as an error', () => {
    const current = snapshot();
    const ready = { kind: 'ready' as const, snapshot: current };

    expect(buildSpaceOverviewView('ready', ready, 'idle').primaryStatus).toBe('decisionRequired');

    current.currentChange = null;
    current.devices[0]!.syncRelationship = 'pausedUpgradeRequired';
    expect(buildSpaceOverviewView('ready', ready, 'idle').primaryStatus).toBe('updateRequired');

    current.devices[0]!.syncRelationship = 'usable';
    current.devices[0]!.reachability = 'offline';
    expect(buildSpaceOverviewView('ready', ready, 'idle').primaryStatus).toBe('healthy');

    expect(
      buildSpaceOverviewView(
        'ready',
        {
          kind: 'failed',
          failure: {
            operation: 'queryDeviceTrust',
            code: 1393,
            category: 'invalidState',
            retryable: false,
          },
        },
        'refreshing'
      ).primaryStatus
    ).toBe('unverifiable');
  });

  it('shows an active space operation below trust warnings but above ordinary device status', () => {
    const current = snapshot();
    current.currentChange = null;
    const operation = {
      kind: 'submitting' as const,
      operation: buildSpaceOperationContext(
        'removeMember',
        'space-1',
        { kind: 'ready', snapshot: current },
        [],
        'laptop-11223344'
      ),
    };

    expect(
      buildCurrentSpaceDeviceViews({ kind: 'ready', snapshot: current }, [], operation).map(
        (device) => device.primaryStatus
      )
    ).toEqual(['updating', 'waitingForLocalDecision', 'updating']);
    expect(
      buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle', [], operation)
        .primaryStatus
    ).toBe('updating');

    current.devices[0]!.syncRelationship = 'pausedUpgradeRequired';
    expect(
      buildCurrentSpaceDeviceViews({ kind: 'ready', snapshot: current }, [], operation)[0]
        ?.primaryStatus
    ).toBe('upgradeRequired');
    expect(
      buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle', [], operation)
        .primaryStatus
    ).toBe('updateRequired');
  });

  it('keeps the remaining devices in the original space when the local device is removed', () => {
    const before = snapshot();
    before.currentChange = null;
    const context = buildSpaceOperationContext(
      'applyChange',
      'space-1',
      { kind: 'ready', snapshot: before },
      []
    );
    const after = snapshot();
    after.currentChange = null;
    after.localMembership = 'removed';
    after.devices[0]!.membership = 'removed';
    after.devices[0]!.syncRelationship = 'removedLocalDevice';

    const result = buildSpaceOperationResult(
      context,
      { kind: 'ready', snapshot: after },
      [],
      'verified'
    );

    expect(result.localDeviceInSpace).toBe(false);
    expect(result.separatedDevices.map((device) => device.deviceId)).toEqual(['phone-12345678']);
    expect(result.continuingSpaceDevices.map((device) => device.deviceId)).toEqual([
      'desktop-12345678',
      'laptop-11223344',
    ]);
  });
});
