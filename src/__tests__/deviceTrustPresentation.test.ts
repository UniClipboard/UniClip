import {
  buildCurrentSpaceDeviceViews,
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
  buildSpaceOverviewView,
  buildSpaceOperationContext,
  buildSpaceOperationResult,
  initialDeviceTrustChoice,
  spaceDeviceUpdateOffersReview,
  spaceMaintenanceMessage,
} from '../features/space/deviceTrustPresentation';
import type { DeviceTrustSnapshot } from '../platform/engine';

function snapshot(): DeviceTrustSnapshot {
  return {
    revision: 1,
    localDeviceId: 'phone-12345678',
    localMembership: 'active',
    spaceDeviceUpdate: {
      phase: 'completed',
      reason: null,
      recovery: null,
      nextRetryAtMs: null,
    },
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

describe('space device update display', () => {
  it.each(['retryableFailure', 'needsAttention'] as const)(
    'keeps an admitted member joined while the device update is %s', (phase) => {
      const current = snapshot();
      current.spaceDeviceUpdate = {
        phase,
        reason: phase === 'needsAttention' ? 'deviceRelationshipConflict' : null,
        recovery: phase === 'needsAttention' ? 'reviewDevices' : null,
        nextRetryAtMs: phase === 'retryableFailure' ? 123_000 : null,
      };
      expect(buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle'))
        .toMatchObject({
          primaryStatus:
            phase === 'retryableFailure'
              ? 'maintenanceRetrying'
              : 'maintenanceNeedsAttention',
          spaceDeviceUpdate: current.spaceDeviceUpdate,
        });
    }
  );

  it('explains a local identity mismatch without offering a recovery action', () => {
    const current = snapshot();
    current.spaceDeviceUpdate = {
      phase: 'needsAttention',
      reason: 'localIdentityMismatch',
      recovery: null,
      nextRetryAtMs: null,
    };
    const overview = buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle');

    expect(overview.primaryStatus).toBe('maintenanceNeedsAttention');
    expect(spaceMaintenanceMessage(overview, (key) => key)).toBe(
      'space.overview.localIdentityMismatch'
    );
  });

  it.each([
    ['deviceStateRejected', 'reviewDevices', true],
    ['deviceRelationshipConflict', 'reviewDevices', true],
    ['deviceSecurityUpdateRejected', 'reviewDevices', true],
    ['deviceUpgradeRequired', 'updateApp', true],
    ['localIdentityMismatch', null, false],
  ] as const)('offers the review action for %s only when Engine names a recovery', (reason, recovery, offered) => {
    expect(
      spaceDeviceUpdateOffersReview({ phase: 'needsAttention', reason, recovery, nextRetryAtMs: null })
    ).toBe(offered);
  });

  it('keeps the generic attention message for Engine reasons that offer recovery', () => {
    const current = snapshot();
    current.spaceDeviceUpdate = {
      phase: 'needsAttention',
      reason: 'deviceRelationshipConflict',
      recovery: 'reviewDevices',
      nextRetryAtMs: null,
    };
    const overview = buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle');

    expect(spaceMaintenanceMessage(overview, (key) => key)).toBe('space.overview.maintenanceAction');
  });

  it('uses the existing updating device status while the holistic update is running', () => {
    const current = snapshot();
    current.spaceDeviceUpdate.phase = 'updating';

    expect(
      buildSpaceOverviewView('ready', { kind: 'ready', snapshot: current }, 'idle')
    ).toMatchObject({ primaryStatus: 'refreshing' });
  });
});

describe('device trust presentation', () => {
  it('shows only remote devices in each Engine-allowed choice impact group', () => {
    const view = buildDeviceTrustDecisionView(snapshot());

    expect(view?.sourceName).toBe('Work · 12345678');
    expect(view?.targetNames).toEqual(['Work · abcdef12']);
    expect(view?.choices).toEqual([
      expect.objectContaining({
        choice: 'keepCurrentDeviceGroup',
        continueSyncNames: ['Work · abcdef12'],
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

  it('does not preselect when the user must compare two choices', () => {
    const current = snapshot();
    if (!current.currentChange) throw new Error('fixture must contain a change');
    current.currentChange.allowedChoices = ['applyChange', 'keepCurrentDeviceGroup'];

    expect(initialDeviceTrustChoice(current, 'old-change', 'applyChange')).toEqual({
      changeId: 'change-1',
      choice: null,
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

  it('shows Engine pairing confirmation without weakening higher-priority safety states', () => {
    const current = snapshot();
    current.currentChange = null;
    const laptop = current.devices.find((device) => device.deviceId === 'laptop-11223344');
    if (!laptop) throw new Error('fixture must contain the remote laptop');

    laptop.pairingConfirmation = 'awaitingPeerConfirmation';
    expect(buildDeviceTrustDeviceViews(current, []).find((device) => device.deviceId === laptop.deviceId))
      .toEqual(expect.objectContaining({ primaryStatus: 'pairingAwaitingConfirmation', canRemove: true }));

    laptop.pairingConfirmation = 'unconfirmed';
    expect(buildDeviceTrustDeviceViews(current, []).find((device) => device.deviceId === laptop.deviceId))
      .toEqual(expect.objectContaining({ primaryStatus: 'pairingUnconfirmed', canRemove: true }));

    laptop.pairingConfirmation = 'confirmed';
    expect(buildDeviceTrustDeviceViews(current, []).find((device) => device.deviceId === laptop.deviceId))
      .toEqual(expect.objectContaining({ primaryStatus: 'usable' }));

    laptop.pairingConfirmation = 'unconfirmed';
    laptop.syncRelationship = 'pausedUpgradeRequired';
    expect(buildDeviceTrustDeviceViews(current, []).find((device) => device.deviceId === laptop.deviceId))
      .toEqual(expect.objectContaining({ primaryStatus: 'upgradeRequired' }));
  });

  it('keeps removal acknowledgement delivery informational, non-blocking, and Engine-convergent', () => {
    const current = snapshot();
    current.currentChange = null;
    current.devices.push({
      deviceId: 'removed-12345678',
      displayName: 'Retired desktop',
      isLocal: false,
      reachability: 'offline',
      membership: 'removed',
      groupRelationship: 'awaitingRemovalAcknowledgement',
      compatibility: 'compatible',
      syncRelationship: 'removedPeerDevice',
      availableActions: [],
      blockedReason: null,
    });

    const ready = { kind: 'ready' as const, snapshot: current };
    const pendingRemoval = buildCurrentSpaceDeviceViews(ready, []).find(
      (device) => device.deviceId === 'removed-12345678'
    );
    expect(pendingRemoval).toEqual(
      expect.objectContaining({
        primaryStatus: 'removalAcknowledgementPending',
        canSync: false,
        canRemove: false,
      })
    );
    expect(buildSpaceOverviewView('ready', ready, 'idle').primaryStatus).toBe('healthy');

    const afterEngineExpiry = {
      ...current,
      devices: current.devices.filter((device) => device.deviceId !== 'removed-12345678'),
    };
    expect(
      buildCurrentSpaceDeviceViews({ kind: 'ready', snapshot: afterEngineExpiry }, []).find(
        (device) => device.deviceId === 'removed-12345678'
      )
    ).toBeUndefined();
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
