import { describe, expect, it, jest } from '@jest/globals';
import { createLogger } from '../support/observability';
import {
  UnifiedSpaceInputError,
  UnifiedSpaceService,
  unifiedSpaceUserErrorCode,
  type UnifiedSpaceApi,
  type UnifiedSpaceSnapshot,
} from '../features/space';
import type { DeviceTrustDecision, DeviceTrustSnapshot } from '../platform/engine';

const log = createLogger('UnifiedSpaceService');

function deviceTrustSnapshot(
  revision = 1,
  changeId: string | null = 'change-1',
  allowedChoices: DeviceTrustSnapshot['currentChange'] extends infer _T
    ? ('applyChange' | 'keepCurrentDeviceGroup')[]
    : never = ['applyChange', 'keepCurrentDeviceGroup']
): DeviceTrustSnapshot {
  return {
    revision,
    localDeviceId: 'phone-1',
    localMembership: 'active',
    currentChange: changeId
      ? {
          changeId,
          proposedByDeviceId: 'desktop-1',
          targetDeviceIds: ['tablet-1'],
          includesLocalDevice: false,
          applyImpact: {
            usableDeviceIds: ['phone-1', 'desktop-1'],
            pausedDeviceIds: ['tablet-1'],
            localDeviceOutcome: 'active',
            requiresRejoinDeviceIds: ['tablet-1'],
          },
          keepCurrentImpact: {
            usableDeviceIds: ['phone-1', 'tablet-1'],
            pausedDeviceIds: ['desktop-1'],
            localDeviceOutcome: 'active',
            requiresRejoinDeviceIds: ['desktop-1'],
          },
          allowedChoices,
          blockedReason: null,
        }
      : null,
    devices: [
      {
        deviceId: 'phone-1',
        displayName: 'Phone',
        isLocal: true,
        reachability: 'online',
        membership: 'active',
        groupRelationship: changeId ? 'pendingLocalDecision' : 'consistent',
        compatibility: 'compatible',
        syncRelationship: changeId ? 'waitingForLocalDecision' : 'usable',
        availableActions: [],
        blockedReason: null,
      },
    ],
    recovery: 'notAvailableInThisVersion',
    allowedActions: changeId ? ['applyCurrentChange', 'keepCurrentDeviceGroup'] : [],
    blockedReason: null,
    updatedAtMs: 123_456 + revision,
  };
}

function createApi(overrides: Partial<UnifiedSpaceApi> = {}): UnifiedSpaceApi {
  return {
    querySpaceState: jest.fn(async () => ({
      hasCompleted: true,
      spaceId: 'space-1',
      currentInvitation: null,
      deviceName: 'Phone',
    })),
    listDevices: jest.fn(async () => [
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
    ]),
    createSpace: jest.fn(async () => ({
      spaceId: 'space-1',
      selfDeviceId: 'phone-1',
      identityFingerprint: 'fingerprint',
    })),
    issueInvitation: jest.fn(async () => ({
      invitationCode: '7K2M-8Q4R',
      expiresAtMs: 123_456,
      availability: 'crossNetwork' as const,
    })),
    joinSpace: jest.fn(async () => activeJoinStatus()),
    queryDeviceTrust: jest.fn(async () => deviceTrustSnapshot()),
    decideDeviceTrustChange: jest.fn(async () => ({
      kind: 'applied' as const,
      changeId: 'change-1',
      snapshot: deviceTrustSnapshot(2, null),
    })),
    removeMember: jest.fn(async () => ({
      phase: 'converging' as const,
      revision: 2,
      historyEventCount: 1,
      effectiveMemberCount: 1,
      pendingRemovalDecisionDeviceIds: ['laptop-1'],
      pendingRemovalDecisionEventId: 'event-1',
      divergedPeerDeviceIds: [],
      upgradeRequiredPeerDeviceIds: [],
      convergenceDigest: 'digest-2',
      removed: false,
      updatedAtMs: 123_457,
      failureCategory: null,
    })),
    resendEntry: jest.fn(async () => ({
      kind: 'completed' as const,
      accepted: 1,
      duplicate: 0,
      offline: 1,
      errored: 0,
      pending: 0,
    })),
    leaveSpace: jest.fn(async () => undefined),
    ...overrides,
  };
}

function activeJoinStatus(
  joinedSpace: Partial<{
    sponsorDeviceId: string;
    sponsorIdentityFingerprint: string;
    spaceId: string;
    selfDeviceId: string;
    selfIdentityFingerprint: string;
    migratedRecords: number;
    preservedUnreadableRecords: number;
  }> = {}
) {
  return {
    type: 'active' as const,
    joinId: 'join-1',
    joinedSpace: {
      sponsorDeviceId: 'desktop-1',
      sponsorIdentityFingerprint: 'sponsor-fingerprint',
      spaceId: 'space-1',
      selfDeviceId: 'phone-1',
      selfIdentityFingerprint: 'phone-fingerprint',
      migratedRecords: 0,
      preservedUnreadableRecords: 0,
      ...joinedSpace,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createCompletionReporter() {
  return {
    resolveFromCore: jest.fn(async () => undefined),
    markComplete: jest.fn(async () => undefined),
    markIncomplete: jest.fn(async () => undefined),
  };
}

function createServiceWithCompletion(
  api: UnifiedSpaceApi,
  publish: (snapshot: UnifiedSpaceSnapshot) => void,
  runSetup: <T>(operation: () => Promise<T>) => Promise<T>,
  completion: ReturnType<typeof createCompletionReporter>
): UnifiedSpaceService {
  const Service = UnifiedSpaceService as unknown as new (
    api: UnifiedSpaceApi,
    publish: (snapshot: UnifiedSpaceSnapshot) => void,
    runSetup: <T>(operation: () => Promise<T>) => Promise<T>,
    completion: ReturnType<typeof createCompletionReporter>
  ) => UnifiedSpaceService;
  return new Service(api, publish, runSetup, completion);
}

describe('UnifiedSpaceService', () => {
  it('returns to setup when Engine requires every device to pair again', async () => {
    const api = createApi({
      querySpaceState: jest.fn(async () => ({
        hasCompleted: true,
        rePairingRequired: true,
        spaceId: 'legacy-space',
        currentInvitation: null,
        deviceName: 'Phone',
      })),
    });
    const service = new UnifiedSpaceService(api);

    await service.refresh();

    expect(service.getSnapshot().status).toBe('empty');
    expect(service.getSnapshot().spaceId).toBeNull();
    expect(api.listDevices).not.toHaveBeenCalled();
  });

  it('loads the complete device trust snapshot during a full refresh', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const trust = deviceTrustSnapshot(4, 'pending-4');
    const api = createApi({ queryDeviceTrust: jest.fn(async () => trust) });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();

    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        deviceTrustQuery: { kind: 'ready', snapshot: trust },
      })
    );
    expect(snapshots.at(-1)).not.toHaveProperty('deviceTrust');
  });

  it('does not retain device trust after the space becomes empty', async () => {
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockResolvedValueOnce({
          hasCompleted: false,
          spaceId: null,
          currentInvitation: null,
          deviceName: null,
        }),
    });
    const service = new UnifiedSpaceService(api);

    expect((await service.refresh()).deviceTrustQuery.kind).toBe('ready');
    expect((await service.refresh()).deviceTrustQuery.kind).toBe('notApplicable');
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({ deviceTrustQuery: { kind: 'notApplicable' } })
    );
  });

  it('keeps the ordinary roster visible and marks corrupt device-trust data explicitly', async () => {
    const failure = Object.assign(new Error('device trust query failed'), {
      code: 1394,
      category: 'invalidState',
      retryable: false,
    });
    const api = createApi({
      queryDeviceTrust: jest.fn(async () => {
        throw failure;
      }),
    });
    const service = new UnifiedSpaceService(api);

    await service.refresh();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'ready',
        devices: expect.arrayContaining([
          expect.objectContaining({ deviceId: 'phone-1' }),
          expect.objectContaining({ deviceId: 'desktop-1' }),
        ]),
        deviceListRefreshStatus: 'idle',
        deviceTrustQuery: {
          kind: 'corrupt',
          failure: {
            operation: 'queryDeviceTrust',
            code: 1394,
            category: 'invalidState',
            retryable: false,
          },
        },
      })
    );
  });

  it('keeps the ordinary roster visible when device trust is unavailable for this space', async () => {
    const failure = Object.assign(new Error('device trust is unavailable'), {
      code: 1392,
      category: 'invalidState',
      retryable: false,
    });
    const api = createApi({
      queryDeviceTrust: jest.fn(async () => {
        throw failure;
      }),
    });
    const service = new UnifiedSpaceService(api);

    await service.refresh();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'ready',
        deviceTrustQuery: {
          kind: 'unavailable',
          failure: {
            operation: 'queryDeviceTrust',
            code: 1392,
            category: 'invalidState',
            retryable: false,
          },
        },
      })
    );
  });

  it('publishes only the newest device trust refresh when reads finish out of order', async () => {
    const oldTrust = deferred<DeviceTrustSnapshot>();
    const newTrust = deferred<DeviceTrustSnapshot>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(0, null))
        .mockImplementationOnce(() => oldTrust.promise)
        .mockImplementationOnce(() => newTrust.promise),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();
    const oldRefresh = service.refresh();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(2);
    const newRefresh = service.refreshDeviceTrust();
    newTrust.resolve(deviceTrustSnapshot(2, 'new-change'));
    await newRefresh;
    oldTrust.resolve(deviceTrustSnapshot(1, 'old-change'));
    await oldRefresh;

    expect(snapshots.at(-1)?.deviceTrustQuery).toEqual(
      expect.objectContaining({
        kind: 'ready',
        snapshot: expect.objectContaining({
          currentChange: expect.objectContaining({ changeId: 'new-change' }),
        }),
      })
    );
  });

  it('runs a new complete refresh after an in-flight snapshot is invalidated', async () => {
    const staleTrust = deferred<DeviceTrustSnapshot>();
    const api = createApi({
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockImplementationOnce(() => staleTrust.promise)
        .mockResolvedValueOnce(deviceTrustSnapshot(3, 'latest-change')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const staleRefresh = service.refresh();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    const latestRefresh = service.refresh({ afterInvalidation: true });
    staleTrust.resolve(deviceTrustSnapshot(2, 'stale-change'));
    await staleRefresh;
    await latestRefresh;

    expect(api.querySpaceState).toHaveBeenCalledTimes(3);
    expect(service.getSnapshot().deviceTrustQuery).toEqual(
      expect.objectContaining({
        kind: 'ready',
        snapshot: expect.objectContaining({
          currentChange: expect.objectContaining({ changeId: 'latest-change' }),
        }),
      })
    );
  });

  it('does not publish the result of a complete refresh invalidated while it is in flight', async () => {
    const staleTrust = deferred<DeviceTrustSnapshot>();
    const latestTrust = deferred<DeviceTrustSnapshot>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockImplementationOnce(() => staleTrust.promise)
        .mockImplementationOnce(() => latestTrust.promise),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    const staleRefresh = service.refresh();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    const latestRefresh = service.refresh({ afterInvalidation: true });
    staleTrust.resolve(deviceTrustSnapshot(2, 'stale-change'));
    await staleRefresh;

    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.deviceTrustQuery.kind === 'ready' &&
          snapshot.deviceTrustQuery.snapshot.currentChange?.changeId === 'stale-change'
      )
    ).toBe(false);

    latestTrust.resolve(deviceTrustSnapshot(3, 'latest-change'));
    await latestRefresh;
    expect(service.getSnapshot().deviceTrustQuery).toEqual(
      expect.objectContaining({
        kind: 'ready',
        snapshot: expect.objectContaining({
          currentChange: expect.objectContaining({ changeId: 'latest-change' }),
        }),
      })
    );
  });

  it('does not carry an old-space roster into a new space when its roster read fails', async () => {
    const trustFailure = Object.assign(new Error('new space trust failed'), {
      code: 1393,
      category: 'invalidState',
      retryable: false,
    });
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'old-space',
          currentInvitation: null,
          deviceName: 'Old Phone',
        })
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'new-space',
          currentInvitation: null,
          deviceName: 'New Phone',
        }),
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'old-phone', displayName: 'Old Phone', isLocal: true, online: true },
          { deviceId: 'old-peer', displayName: 'Old Peer', isLocal: false, online: false },
        ])
        .mockRejectedValueOnce(new Error('new space roster failed')),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockRejectedValueOnce(trustFailure),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.refresh();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'new-space',
        devices: [],
        workspaceConvergence: null,
        hasResolvedDeviceList: false,
        deviceListRefreshStatus: 'failed',
        deviceTrustQuery: expect.objectContaining({ kind: 'failed' }),
      })
    );
  });

  it('does not restore device trust when there is no current space', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await expect(service.refreshDeviceTrust()).resolves.toEqual(
      expect.objectContaining({
        status: 'idle',
        spaceId: null,
        deviceTrustQuery: { kind: 'idle' },
      })
    );

    expect(api.queryDeviceTrust).not.toHaveBeenCalled();
  });

  it('publishes a decision result even when a read started during the decision finishes later', async () => {
    const decision = deferred<DeviceTrustDecision>();
    const staleTrust = deferred<DeviceTrustSnapshot>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      decideDeviceTrustChange: jest.fn(() => decision.promise),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot())
        .mockImplementationOnce(() => staleTrust.promise)
        .mockResolvedValueOnce(deviceTrustSnapshot(3, null)),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    const deciding = service.decideDeviceTrust('applyChange', false);
    const reading = service.refreshDeviceTrust();
    decision.resolve({
      kind: 'applied',
      changeId: 'change-1',
      snapshot: deviceTrustSnapshot(3, null),
    });
    await deciding;
    staleTrust.resolve(deviceTrustSnapshot(2, 'stale-change'));
    await reading;

    expect(snapshots.at(-1)?.deviceTrustQuery).toEqual({
      kind: 'ready',
      snapshot: expect.objectContaining({ revision: 3, currentChange: null }),
    });
    expect(snapshots.at(-1)?.operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({ kind: 'applyChange', verification: 'verified' }),
      })
    );
  });

  it('completely refreshes the current space after a decision succeeds', async () => {
    const api = createApi({
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot())
        .mockResolvedValueOnce(deviceTrustSnapshot(3, null)),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', false);

    expect(api.querySpaceState).toHaveBeenCalledTimes(2);
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        deviceTrustQuery: {
          kind: 'ready',
          snapshot: expect.objectContaining({ revision: 3 }),
        },
        operationState: expect.objectContaining({
          kind: 'result',
          result: expect.objectContaining({ kind: 'applyChange', verification: 'verified' }),
        }),
      })
    );
  });

  it('keeps an accepted decision result when its complete refresh fails', async () => {
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockRejectedValueOnce(new Error('post-decision refresh failed')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.decideDeviceTrust('applyChange', false)).resolves.toEqual(
      expect.objectContaining({ kind: 'applied' })
    );

    expect(api.decideDeviceTrustChange).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({ kind: 'applyChange', verification: 'unverified' }),
      })
    );
  });

  it('drops an old operation result when the complete refresh finds a different space', async () => {
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-2',
          currentInvitation: null,
          deviceName: 'New Phone',
        }),
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockResolvedValueOnce([
          { deviceId: 'phone-2', displayName: 'New Phone', isLocal: true, online: true },
        ]),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot())
        .mockResolvedValueOnce(deviceTrustSnapshot(3, null)),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', false);

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'space-2',
        deviceName: 'New Phone',
        devices: [{ deviceId: 'phone-2', displayName: 'New Phone', isLocal: true, online: true }],
        operationState: { kind: 'idle' },
      })
    );
  });

  it('shares one in-flight decision for repeated taps', async () => {
    const pending = deferred<DeviceTrustDecision>();
    const api = createApi({ decideDeviceTrustChange: jest.fn(() => pending.promise) });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const first = service.decideDeviceTrust('applyChange', false);
    const second = service.decideDeviceTrust('applyChange', false);
    expect(second).toBe(first);
    pending.resolve({
      kind: 'applied',
      changeId: 'change-1',
      snapshot: deviceTrustSnapshot(2, null),
    });
    await first;

    expect(api.decideDeviceTrustChange).toHaveBeenCalledTimes(1);
  });

  it('does not claim the requested choice succeeded when Engine reports a newer state', async () => {
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => ({
        kind: 'stateChanged' as const,
        currentChangeId: null,
        snapshot: deviceTrustSnapshot(2, null),
      })),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', false);

    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({ decisionOutcome: 'stateChanged' }),
      })
    );
  });

  it('uses the choice that Engine says was already completed', async () => {
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => ({
        kind: 'alreadyCompleted' as const,
        changeId: 'change-1',
        completedChoice: 'keepCurrentDeviceGroup' as const,
        snapshot: deviceTrustSnapshot(2, null),
      })),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', false);

    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({
          kind: 'keepCurrentSpace',
          decisionOutcome: 'alreadyCompleted',
        }),
      })
    );
  });

  it('keeps the decision open when Engine still requires local-device confirmation', async () => {
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => ({
        kind: 'localDeviceConfirmationRequired' as const,
        changeId: 'change-1',
        snapshot: deviceTrustSnapshot(2, 'change-1'),
      })),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', true);

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        deviceTrustDecisionError: 'localDeviceConfirmationRequired',
        operationState: { kind: 'idle' },
      })
    );
  });

  it('returns to the normal no-space state after applying a change that removes this device', async () => {
    const removed = deviceTrustSnapshot(2, null);
    removed.localMembership = 'removed';
    removed.devices[0]!.membership = 'removed';
    removed.devices[0]!.syncRelationship = 'removedLocalDevice';
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => ({
        kind: 'applied' as const,
        changeId: 'change-1',
        snapshot: removed,
      })),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.decideDeviceTrust('applyChange', true);

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'empty',
        spaceId: null,
        devices: [],
        operationState: expect.objectContaining({
          kind: 'result',
          result: expect.objectContaining({ localDeviceInSpace: false }),
        }),
      })
    );
  });

  it('treats a previously removed local device as having no current space on refresh', async () => {
    const removed = deviceTrustSnapshot(2, null);
    removed.localMembership = 'removed';
    const service = new UnifiedSpaceService(
      createApi({ queryDeviceTrust: jest.fn(async () => removed) })
    );

    await service.refresh();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'empty',
        spaceId: null,
        devices: [],
        deviceTrustQuery: { kind: 'notApplicable' },
      })
    );
  });

  it('rejects a choice that the current Engine snapshot does not allow', async () => {
    const api = createApi({
      queryDeviceTrust: jest.fn(async () => deviceTrustSnapshot(1, 'change-1', ['applyChange'])),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.decideDeviceTrust('keepCurrentDeviceGroup', false)).rejects.toMatchObject({
      code: 'choiceNotAllowed',
    });
    expect(api.decideDeviceTrustChange).not.toHaveBeenCalled();
  });

  it('does not retry a failed decision, refreshes once, and keeps the error visible', async () => {
    const failure = new Error('Engine decision failed');
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => {
        throw failure;
      }),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot())
        .mockResolvedValueOnce(deviceTrustSnapshot(2, 'change-2')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.decideDeviceTrust('applyChange', false)).rejects.toBe(failure);

    expect(api.decideDeviceTrustChange).toHaveBeenCalledTimes(1);
    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        deviceTrustQuery: {
          kind: 'ready',
          snapshot: expect.objectContaining({ revision: 2 }),
        },
        deviceTrustDecisionStatus: 'idle',
        deviceTrustDecisionError: 'Engine decision failed',
      })
    );
  });

  it('keeps conflicting operations blocked while a failed decision refreshes current trust', async () => {
    const refreshedTrust = deferred<DeviceTrustSnapshot>();
    const failure = new Error('Engine decision failed');
    const api = createApi({
      decideDeviceTrustChange: jest.fn(async () => {
        throw failure;
      }),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot())
        .mockImplementationOnce(() => refreshedTrust.promise),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const decision = service.decideDeviceTrust('applyChange', false);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(2);

    await expect(service.leaveSpace()).rejects.toMatchObject({
      name: 'SpaceOperationInProgressError',
    });
    expect(api.leaveSpace).not.toHaveBeenCalled();

    refreshedTrust.resolve(deviceTrustSnapshot(2, 'change-2'));
    await expect(decision).rejects.toBe(failure);
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        deviceTrustQuery: {
          kind: 'ready',
          snapshot: expect.objectContaining({ revision: 2 }),
        },
        deviceTrustDecisionError: 'Engine decision failed',
        operationState: { kind: 'idle' },
      })
    );
  });
  it.each([
    ['engine error 1233 (Unauthorized)', 'passphraseMismatch'],
    ['BindingError.Engine(code: 1234, category: notFound, retryable: false)', 'invitationNotFound'],
    ['BindingError.Engine(code: 1281, category: notFound, retryable: false)', 'invitationExpired'],
    ['engine error 1236 (Unavailable)', 'sponsorUnreachable'],
    ['engine error 1285 (DeadlineExceeded)', 'connectionTimedOut'],
    ['engine error 1282 (Conflict)', 'invitationRejected'],
    ['engine error 1283 (Unavailable)', 'serviceUnavailable'],
    ['engine error 1284 (Unavailable)', 'connectionLost'],
    ['engine error 1292 (Conflict)', 'unreadableHistoryRequiresConfirmation'],
  ] as const)('maps native failure %s to %s', (message, expected) => {
    expect(unifiedSpaceUserErrorCode(new Error(message))).toBe(expected);
  });

  it('keeps input validation errors and ignores unknown native failures', () => {
    expect(unifiedSpaceUserErrorCode(new UnifiedSpaceInputError('invitationCodeInvalid'))).toBe(
      'invitationCodeInvalid'
    );
    expect(unifiedSpaceUserErrorCode(new Error('unknown failure'))).toBeNull();
  });

  it.each(['create', 'join'] as const)(
    'prepares the P2P runtime before a %s operation reaches the native engine',
    async (operation) => {
      const events: string[] = [];
      const api = createApi({
        createSpace: jest.fn(async () => {
          events.push('native:create');
          return {
            spaceId: 'space-1',
            selfDeviceId: 'phone-1',
            identityFingerprint: 'fingerprint',
          };
        }),
        joinSpace: jest.fn(async () => {
          events.push('native:join');
          return activeJoinStatus();
        }),
      });
      const runSetup = async <T>(setup: () => Promise<T>): Promise<T> => {
        events.push('prepare:p2p');
        return setup();
      };
      const service = new UnifiedSpaceService(api, () => {}, runSetup);

      if (operation === 'create') {
        await service.createSpace('Phone', 'passphrase');
      } else {
        await service.joinSpace('7K2M-8Q4R', 'Phone', 'passphrase');
      }

      expect(events.slice(0, 2)).toEqual(['prepare:p2p', `native:${operation}`]);
    }
  );

  it('normalizes the device name without rewriting the passphrase when creating a space', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await service.createSpace('  My Phone  ', ' secret with spaces ');

    expect(api.createSpace).toHaveBeenCalledWith('My Phone', ' secret with spaces ');
  });

  it.each([
    ['7k2m8q4r', '7K2M-8Q4R'],
    ['  7k2m-8q4r  ', '7K2M-8Q4R'],
    ['7k2m 8q4r', '7K2M-8Q4R'],
    ['olk2-m8qr', '01K2-M8QR'],
  ])('normalizes invitation %s for joining as %s', async (input, expected) => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await service.joinSpace(input, '  Travel Phone  ', ' another secret ');

    expect(api.joinSpace).toHaveBeenCalledWith(expected, 'Travel Phone', ' another secret ', false);
  });

  it('passes explicit unreadable-history confirmation to the native engine', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await service.joinSpace('7K2M-8Q4R', 'Phone', 'passphrase', true);

    expect(api.joinSpace).toHaveBeenCalledWith('7K2M-8Q4R', 'Phone', 'passphrase', true);
  });

  it.each([
    [
      'pending',
      {
        type: 'pending',
        joinId: 'join-1',
        targetSpaceId: 'space-1',
        sponsorDeviceId: 'desktop-1',
        sponsorIdentityFingerprint: 'sponsor-fingerprint',
        cancelRequested: false,
      },
      'serviceUnavailable',
    ],
    [
      'rejected',
      { type: 'rejected', joinId: 'join-1', reason: 'authenticationRejected' },
      'passphraseMismatch',
    ],
  ] as const)(
    'does not complete setup when the Engine reports a %s join',
    async (_status, joinStatus, expectedCode) => {
      const api = createApi({
        joinSpace: jest.fn(
          async () => joinStatus as unknown as Awaited<ReturnType<UnifiedSpaceApi['joinSpace']>>
        ),
      });
      const completion = createCompletionReporter();
      const service = createServiceWithCompletion(
        api,
        () => {},
        async (operation) => operation(),
        completion
      );

      await expect(service.joinSpace('7K2M-8Q4R', 'Phone', 'passphrase')).rejects.toMatchObject({
        code: expectedCode,
      });

      expect(api.listDevices).not.toHaveBeenCalled();
      expect(completion.markComplete).not.toHaveBeenCalled();
      expect(service.getSnapshot()).toEqual(
        expect.objectContaining({ status: 'failed', spaceId: null })
      );
    }
  );

  it.each([
    ['requestJoin', true],
    ['refreshDevices', false],
  ] as const)(
    'logs a redacted %s failure with enough context to diagnose joining',
    async (expectedStage, failJoinRequest) => {
      const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
      const invitation = '7K2M-8Q4R';
      const deviceName = 'Private Phone';
      const secret = 'secret with spaces';
      const privatePath = '/private/var/mobile/Containers/Data/Application/SECRET/history.db';
      const nativeError = Object.assign(
        new Error(
          `Engine error 1283 while joining ${invitation} as ${deviceName} using ${secret} at ${privatePath}`
        ),
        { code: 1283 }
      );
      const api = createApi({
        joinSpace: failJoinRequest
          ? jest.fn(async () => {
              throw nativeError;
            })
          : createApi().joinSpace,
        listDevices: failJoinRequest
          ? createApi().listDevices
          : jest.fn(async () => {
              throw nativeError;
            }),
      });
      const service = new UnifiedSpaceService(api, () => undefined);

      await expect(service.joinSpace(invitation, deviceName, secret)).rejects.toBe(nativeError);

      expect(logError).toHaveBeenCalledWith(
        'Join space failed',
        expect.objectContaining({
          stage: expectedStage,
          hadExistingSpace: false,
          errorName: 'Error',
          errorCode: 1283,
          userErrorCode: 'serviceUnavailable',
        })
      );
      expect(logError.mock.calls[0]?.[1]).not.toHaveProperty('errorMessage');
      const logged = JSON.stringify(logError.mock.calls);
      expect(logged).not.toContain(invitation);
      expect(logged).not.toContain(deviceName);
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(privatePath);
      logError.mockRestore();
    }
  );

  it.each(['ABCD-123', 'ABCD-12345', 'ABCD-U234', '----'])(
    'rejects incomplete or unsupported invitation %s before joining',
    async (input) => {
      const api = createApi();
      const service = new UnifiedSpaceService(api);

      await expect(service.joinSpace(input, 'Phone', 'passphrase')).rejects.toMatchObject({
        code: 'invitationCodeInvalid',
      });
      expect(api.joinSpace).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['deviceNameRequired', '', 'passphrase', undefined],
    ['passphraseRequired', 'Phone', '   ', undefined],
    ['invitationCodeRequired', 'Phone', 'passphrase', '   '],
  ] as const)(
    'rejects %s before calling the native engine',
    async (code, deviceName, secret, invitationCode) => {
      const api = createApi();
      const service = new UnifiedSpaceService(api);

      const operation =
        invitationCode === undefined
          ? service.createSpace(deviceName, secret)
          : service.joinSpace(invitationCode, deviceName, secret);

      await expect(operation).rejects.toMatchObject<UnifiedSpaceInputError>({ code });
      expect(api.createSpace).not.toHaveBeenCalled();
      expect(api.joinSpace).not.toHaveBeenCalled();
    }
  );

  it('can issue a replacement invitation independently', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await expect(service.issueInvitation()).resolves.toEqual(
      expect.objectContaining({ invitationCode: '7K2M-8Q4R' })
    );
    expect(api.issueInvitation).toHaveBeenCalledTimes(1);
    expect(api.createSpace).not.toHaveBeenCalled();
  });

  it('restores the active space and its devices from the core', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi();
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'space-1',
        deviceName: 'Phone',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ],
      })
    );
  });

  it('uses the local Core completion record to resolve startup setup state', async () => {
    const completion = createCompletionReporter();
    const service = createServiceWithCompletion(
      createApi(),
      () => undefined,
      async (operation) => operation(),
      completion
    );

    await service.refresh();

    expect(completion.resolveFromCore).toHaveBeenCalledWith(true);
  });

  it('logs a failed space-state step while refreshing a space', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const service = new UnifiedSpaceService(
      createApi({
        querySpaceState: jest.fn(async () => {
          throw new Error('Engine error 1322');
        }),
      }),
      () => undefined
    );

    await expect(service.refresh()).rejects.toThrow('Engine error');

    expect(logError).toHaveBeenCalledWith(
      'Space refresh failed',
      expect.objectContaining({ stage: 'querySpaceState', errorCode: expect.any(Number) })
    );
  });

  it('publishes device trust when the ordinary roster fails during a full refresh', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const trust = deviceTrustSnapshot(8, null);
    const service = new UnifiedSpaceService(
      createApi({
        listDevices: jest.fn(async () => {
          throw new Error('Engine error 1383');
        }),
        queryDeviceTrust: jest.fn(async () => trust),
      }),
      () => undefined
    );

    await expect(service.refresh()).resolves.toEqual(
      expect.objectContaining({
        status: 'ready',
        deviceListRefreshStatus: 'failed',
        deviceTrustQuery: { kind: 'ready', snapshot: trust },
      })
    );

    expect(logError).toHaveBeenCalledWith(
      'Space refresh failed',
      expect.objectContaining({ stage: 'listDevices', errorCode: 1383 })
    );
  });

  it('creates a space and immediately issues an invitation', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi();
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    const creation = await service.createSpace('Phone', 'correct horse battery staple');

    expect(api.createSpace).toHaveBeenCalledWith('Phone', 'correct horse battery staple');
    expect(api.issueInvitation).toHaveBeenCalledTimes(1);
    expect(creation.invitation.invitationCode).toBe('7K2M-8Q4R');
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'space-1',
        invitation: creation.invitation,
      })
    );
  });

  it.each(['create', 'join'] as const)(
    'marks setup complete after a successful %s',
    async (kind) => {
      const completion = createCompletionReporter();
      const service = createServiceWithCompletion(
        createApi(),
        () => undefined,
        async (operation) => operation(),
        completion
      );

      if (kind === 'create') {
        await service.createSpace('Phone', 'passphrase');
      } else {
        await service.joinSpace('7K2M-8Q4R', 'Phone', 'passphrase');
      }

      expect(completion.markComplete).toHaveBeenCalledTimes(1);
      expect(completion.markIncomplete).not.toHaveBeenCalled();
    }
  );

  it('preserves every resend outcome count', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await expect(service.resendEntry('entry-1')).resolves.toEqual({
      kind: 'completed',
      accepted: 1,
      duplicate: 0,
      offline: 1,
      errored: 0,
      pending: 0,
    });
    expect(api.resendEntry).toHaveBeenCalledWith('entry-1', []);
  });

  it('returns workspace convergence and refreshes the roster after removing a device', async () => {
    const convergence = {
      phase: 'converging' as const,
      revision: 2,
      historyEventCount: 1,
      effectiveMemberCount: 1,
      pendingRemovalDecisionDeviceIds: ['laptop-1'],
      pendingRemovalDecisionEventId: 'event-1',
      divergedPeerDeviceIds: [],
      upgradeRequiredPeerDeviceIds: [],
      convergenceDigest: 'digest-2',
      removed: false,
      updatedAtMs: 123_456,
      failureCategory: null,
    };
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      removeMember: jest.fn(async () => convergence) as unknown as UnifiedSpaceApi['removeMember'],
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ])
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();

    await expect(service.removeMember('desktop-1')).resolves.toEqual(convergence);
    expect(api.removeMember).toHaveBeenCalledWith('desktop-1');
    expect(api.querySpaceState).toHaveBeenCalledTimes(2);
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(api.queryDeviceTrust).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.devices).toEqual([
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
    ]);
    expect(snapshots.at(-1)?.workspaceConvergence).toEqual(convergence);
    expect(snapshots.at(-1)?.operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({
          kind: 'removeMember',
          verification: 'verified',
          separatedDevices: [expect.objectContaining({ deviceId: 'desktop-1' })],
        }),
      })
    );
  });

  it('keeps an accepted removal result when its complete refresh cannot read the space', async () => {
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockRejectedValueOnce(new Error('post-removal refresh failed')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.removeMember('desktop-1')).resolves.toEqual(
      expect.objectContaining({ revision: 2 })
    );

    expect(api.removeMember).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({ kind: 'removeMember', verification: 'unverified' }),
      })
    );
  });

  it('publishes a submitting state while removing a member', async () => {
    const pendingRemoval = deferred<Awaited<ReturnType<UnifiedSpaceApi['removeMember']>>>();
    const api = createApi({ removeMember: jest.fn(() => pendingRemoval.promise) });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const removing = service.removeMember('desktop-1');

    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'submitting',
        operation: expect.objectContaining({ kind: 'removeMember', targetDeviceId: 'desktop-1' }),
      })
    );
    pendingRemoval.resolve(await createApi().removeMember('desktop-1'));
    await removing;
  });

  it('rejects a different high-impact operation while one is already submitting', async () => {
    const pendingRemoval = deferred<Awaited<ReturnType<UnifiedSpaceApi['removeMember']>>>();
    const api = createApi({ removeMember: jest.fn(() => pendingRemoval.promise) });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const removing = service.removeMember('desktop-1');
    await expect(service.leaveSpace()).rejects.toMatchObject({
      name: 'SpaceOperationInProgressError',
    });

    expect(api.leaveSpace).not.toHaveBeenCalled();
    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'submitting',
        operation: expect.objectContaining({ kind: 'removeMember' }),
      })
    );

    pendingRemoval.resolve(await createApi().removeMember('desktop-1'));
    await removing;
  });

  it('keeps an accepted removal result when its post-operation roster refresh fails', async () => {
    const convergence = await createApi().removeMember('desktop-1');
    const api = createApi({
      removeMember: jest.fn(async () => convergence),
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockRejectedValueOnce(new Error('initial roster failed'))
        .mockRejectedValueOnce(new Error('post-operation roster failed')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.removeMember('desktop-1')).resolves.toEqual(convergence);

    expect(api.removeMember).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({
          kind: 'removeMember',
          verification: 'unverified',
        }),
      })
    );
    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        hasResolvedDeviceList: false,
        deviceListRefreshStatus: 'failed',
      })
    );
  });

  it('publishes no current space when post-removal trust says this device was also removed', async () => {
    const removed = deviceTrustSnapshot(2, null);
    removed.localMembership = 'removed';
    removed.devices[0]!.membership = 'removed';
    removed.devices[0]!.syncRelationship = 'removedLocalDevice';
    const api = createApi({
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockResolvedValueOnce(removed),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await service.removeMember('desktop-1');

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'empty',
        spaceId: null,
        devices: [],
        operationState: expect.objectContaining({
          kind: 'result',
          result: expect.objectContaining({ localDeviceInSpace: false }),
        }),
      })
    );
  });

  it('refreshes devices without reloading the whole space', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: true },
        ])
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();
    await service.refreshDevices();

    expect(api.querySpaceState).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ],
      })
    );
  });

  it('marks device trust as loading while retaining the previous snapshot during refresh', async () => {
    const nextDevices = deferred<Awaited<ReturnType<UnifiedSpaceApi['listDevices']>>>();
    const nextTrust = deferred<DeviceTrustSnapshot>();
    const api = createApi({
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockImplementationOnce(() => nextDevices.promise),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockImplementationOnce(() => nextTrust.promise),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    const refreshing = service.refreshDevices();

    expect(service.getSnapshot().deviceTrustQuery).toEqual({
      kind: 'loading',
      previous: expect.objectContaining({ revision: 1 }),
    });
    nextDevices.resolve([
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
    ]);
    nextTrust.resolve(deviceTrustSnapshot(2, null));
    await refreshing;
  });

  it('reports a device-removal failure without starting another flow', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const finalError = new Error(
      'Engine error 1410: prepared revocation epoch mismatch for desktop-secret-device-id'
    );
    const api = createApi({
      removeMember: jest.fn(async () => {
        throw finalError;
      }) as unknown as UnifiedSpaceApi['removeMember'],
    });
    const service = new UnifiedSpaceService(api, () => undefined);

    await expect(service.removeMember('desktop-1')).rejects.toBe(finalError);

    expect(logError).toHaveBeenCalledWith(
      'Failed to remove a space member',
      expect.objectContaining({ operation: 'removeMember', errorName: 'Error', errorCode: 1410 })
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('desktop-secret-device-id');
    await expect(service.refresh()).resolves.toEqual(
      expect.objectContaining({ status: 'ready', spaceId: 'space-1' })
    );
    logError.mockRestore();
  });

  it('leaves the space without invoking any history deletion', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockResolvedValueOnce({
          hasCompleted: false,
          spaceId: null,
          currentInvitation: null,
          deviceName: null,
        }),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    await service.leaveSpace();

    expect(api.leaveSpace).toHaveBeenCalledTimes(1);
    expect(api.querySpaceState).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'empty', spaceId: null, devices: [] })
    );
    expect(snapshots.at(-1)?.operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({
          kind: 'leaveSpace',
          localDeviceInSpace: false,
          verification: 'verified',
        }),
      })
    );
  });

  it('keeps an accepted leave result when its complete refresh fails', async () => {
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockRejectedValueOnce(new Error('post-leave refresh failed')),
    });
    const service = new UnifiedSpaceService(api);
    await service.refresh();

    await expect(service.leaveSpace()).resolves.toBeUndefined();

    expect(api.leaveSpace).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().operationState).toEqual(
      expect.objectContaining({
        kind: 'result',
        result: expect.objectContaining({ kind: 'leaveSpace', verification: 'unverified' }),
      })
    );
  });

  it('clears only the temporary operation result when the user finishes it', async () => {
    const service = new UnifiedSpaceService(
      createApi({
        querySpaceState: jest
          .fn<UnifiedSpaceApi['querySpaceState']>()
          .mockResolvedValueOnce({
            hasCompleted: true,
            spaceId: 'space-1',
            currentInvitation: null,
            deviceName: 'Phone',
          })
          .mockResolvedValueOnce({
            hasCompleted: false,
            spaceId: null,
            currentInvitation: null,
            deviceName: null,
          }),
      })
    );
    await service.refresh();
    await service.leaveSpace();

    service.clearOperationResult();

    expect(service.getSnapshot()).toEqual(
      expect.objectContaining({
        status: 'empty',
        operationState: { kind: 'idle' },
      })
    );
  });

  it('does not force first-time setup after an existing user leaves a space', async () => {
    const completion = createCompletionReporter();
    const leaveFailure = new Error('leave failed');
    const api = createApi({
      leaveSpace: jest
        .fn<UnifiedSpaceApi['leaveSpace']>()
        .mockRejectedValueOnce(leaveFailure)
        .mockResolvedValueOnce(undefined),
    });
    const service = createServiceWithCompletion(
      api,
      () => undefined,
      async (operation) => operation(),
      completion
    );

    await expect(service.leaveSpace()).rejects.toBe(leaveFailure);
    expect(completion.markIncomplete).not.toHaveBeenCalled();

    await service.leaveSpace();
    expect(completion.markIncomplete).not.toHaveBeenCalled();
  });

  it('does not restore an old space when a refresh finishes after leaving', async () => {
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockImplementationOnce(() => pendingState.promise)
        .mockResolvedValueOnce({
          hasCompleted: false,
          spaceId: null,
          currentInvitation: null,
          deviceName: null,
        }),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    const staleRefresh = service.refresh();
    await service.leaveSpace();
    pendingState.resolve({
      hasCompleted: true,
      spaceId: 'old-space',
      currentInvitation: null,
      deviceName: 'Old Phone',
    });
    await staleRefresh;

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'empty', spaceId: null, devices: [] })
    );
  });

  it('does not replace a newly joined space when an older refresh finishes later', async () => {
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest.fn(() => pendingState.promise),
      joinSpace: jest.fn(async () =>
        activeJoinStatus({
          sponsorDeviceId: 'new-desktop',
          sponsorIdentityFingerprint: 'new-sponsor-fingerprint',
          spaceId: 'new-space',
          selfDeviceId: 'new-phone',
          selfIdentityFingerprint: 'new-phone-fingerprint',
        })
      ),
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'new-phone', displayName: 'New Phone', isLocal: true, online: true },
        ])
        .mockResolvedValueOnce([
          { deviceId: 'old-phone', displayName: 'Old Phone', isLocal: true, online: false },
        ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    const staleRefresh = service.refresh();
    await service.joinSpace('9R3N-6W2X', 'New Phone', 'passphrase');
    pendingState.resolve({
      hasCompleted: true,
      spaceId: 'old-space',
      currentInvitation: null,
      deviceName: 'Old Phone',
    });
    await staleRefresh;

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'new-space',
        deviceName: 'New Phone',
        devices: [{ deviceId: 'new-phone', displayName: 'New Phone', isLocal: true, online: true }],
      })
    );
  });

  it('does not let activation refresh invalidate the setup that starts immediately after it', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest.fn(async () => ({
        hasCompleted: false,
        spaceId: null,
        currentInvitation: null,
        deviceName: null,
      })),
      listDevices: jest.fn(async () => [
        { deviceId: 'new-phone', displayName: 'New Phone', isLocal: true, online: true },
      ]),
      joinSpace: jest.fn(async () =>
        activeJoinStatus({
          sponsorDeviceId: 'new-desktop',
          sponsorIdentityFingerprint: 'new-sponsor-fingerprint',
          spaceId: 'new-space',
          selfDeviceId: 'new-phone',
          selfIdentityFingerprint: 'new-phone-fingerprint',
        })
      ),
    });
    let service!: UnifiedSpaceService;
    const runSetup = async <T>(operation: () => Promise<T>) => {
      await service.refresh();
      return operation();
    };
    service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot), runSetup);

    await service.joinSpace('9R3N-6W2X', 'New Phone', 'passphrase');

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'ready', spaceId: 'new-space' })
    );
  });

  it('does not let a refresh started during join overwrite the successful join result', async () => {
    const joinResult = deferred<Awaited<ReturnType<UnifiedSpaceApi['joinSpace']>>>();
    const refreshState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest.fn(() => refreshState.promise),
      joinSpace: jest.fn(() => joinResult.promise),
      listDevices: jest.fn(async () => [
        { deviceId: 'new-phone', displayName: 'New Phone', isLocal: true, online: true },
      ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    const joining = service.joinSpace('9R3N-6W2X', 'New Phone', 'passphrase');
    const refresh = service.refresh();
    joinResult.resolve(
      activeJoinStatus({
        sponsorDeviceId: 'new-desktop',
        sponsorIdentityFingerprint: 'new-sponsor-fingerprint',
        spaceId: 'new-space',
        selfDeviceId: 'new-phone',
        selfIdentityFingerprint: 'new-phone-fingerprint',
      })
    );
    await joining;
    refreshState.resolve({
      hasCompleted: false,
      spaceId: null,
      currentInvitation: null,
      deviceName: null,
    });
    await refresh;

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'ready', spaceId: 'new-space' })
    );
  });

  it('starts with an unresolved device list and resolves it even when the list is empty', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      listDevices: jest.fn(async () => []),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    expect(snapshots[0]).toEqual(
      expect.objectContaining({ hasResolvedDeviceList: false, deviceListRefreshStatus: 'idle' })
    );

    await service.refreshDevices();
    expect(api.listDevices).not.toHaveBeenCalled();

    await service.refresh();

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'idle',
        devices: [],
        status: 'ready',
      })
    );
  });

  it('keeps existing devices when a full refresh starts and fails', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockImplementationOnce(() => Promise.reject(new Error('Engine error 1322'))),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    const refresh = service.refresh();
    const inFlight = snapshots.at(-1);
    expect(inFlight).toEqual(
      expect.objectContaining({
        status: 'loading',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ],
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'refreshing',
      })
    );

    await expect(refresh).rejects.toThrow('Engine error 1322');

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'failed',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ],
        spaceId: 'space-1',
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'failed',
      })
    );
  });

  it('publishes fresh trust without failing the whole space when the roster refresh fails', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockRejectedValueOnce(new Error('Engine error 1383')),
      queryDeviceTrust: jest
        .fn<UnifiedSpaceApi['queryDeviceTrust']>()
        .mockResolvedValueOnce(deviceTrustSnapshot(1, null))
        .mockResolvedValueOnce(deviceTrustSnapshot(2, null)),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    await expect(service.refreshDevices()).resolves.toEqual(
      expect.objectContaining({ status: 'ready', deviceListRefreshStatus: 'failed' })
    );

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        spaceId: 'space-1',
        devices: [{ deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true }],
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'failed',
        deviceTrustQuery: {
          kind: 'ready',
          snapshot: expect.objectContaining({ revision: 2 }),
        },
      })
    );
  });

  it('really executes the next request after a failed refresh and restores idle', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockRejectedValueOnce(new Error('Engine error 1383'))
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: true },
        ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    await expect(service.refreshDevices()).resolves.toEqual(
      expect.objectContaining({ deviceListRefreshStatus: 'failed' })
    );
    expect(api.listDevices).toHaveBeenCalledTimes(2);

    await service.refreshDevices();

    expect(api.listDevices).toHaveBeenCalledTimes(3);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        deviceListRefreshStatus: 'idle',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: true },
        ],
      })
    );
  });

  it('runs a single Engine query for two concurrent full refreshes', async () => {
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const api = createApi({
      querySpaceState: jest.fn(() => pendingState.promise),
    });
    const service = new UnifiedSpaceService(api, () => undefined);

    const first = service.refresh();
    const second = service.refresh();
    expect(second).toBe(first);

    pendingState.resolve({
      hasCompleted: true,
      spaceId: 'space-1',
      currentInvitation: null,
      deviceName: 'Phone',
    });
    await first;
    await second;

    expect(api.querySpaceState).toHaveBeenCalledTimes(1);
  });

  it('runs a single listDevices for two concurrent device refreshes', async () => {
    const pendingDevices = deferred<Awaited<ReturnType<UnifiedSpaceApi['listDevices']>>>();
    const api = createApi({
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockImplementationOnce(() => pendingDevices.promise),
    });
    const service = new UnifiedSpaceService(api, () => undefined);
    await service.refresh();

    const first = service.refreshDevices();
    const second = service.refreshDevices();
    expect(second).toBe(first);

    pendingDevices.resolve([
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
    ]);
    await first;
    await second;

    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it('joins an in-flight full refresh when a device refresh arrives and never stays loading', async () => {
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest.fn(() => pendingState.promise),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    const full = service.refresh();
    const device = service.refreshDevices();
    expect(device).toBe(full);

    pendingState.resolve({
      hasCompleted: true,
      spaceId: 'space-1',
      currentInvitation: null,
      deviceName: 'Phone',
    });
    await full;

    expect(api.querySpaceState).toHaveBeenCalledTimes(1);
    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'ready', deviceListRefreshStatus: 'idle' })
    );
  });

  it('lets a full refresh started during a device refresh win in the end', async () => {
    const pendingDevices = deferred<Awaited<ReturnType<UnifiedSpaceApi['listDevices']>>>();
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        })
        .mockImplementationOnce(() => pendingState.promise),
      listDevices: jest
        .fn<UnifiedSpaceApi['listDevices']>()
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ])
        .mockImplementationOnce(() => pendingDevices.promise)
        .mockResolvedValueOnce([
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    const device = service.refreshDevices();
    const full = service.refresh();
    expect(full).not.toBe(device);

    pendingDevices.resolve([
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: true },
    ]);
    await device;
    expect(snapshots.at(-1)).not.toEqual(
      expect.objectContaining({ deviceListRefreshStatus: 'idle' })
    );

    pendingState.resolve({
      hasCompleted: true,
      spaceId: 'space-1',
      currentInvitation: null,
      deviceName: 'Phone',
    });
    await full;

    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: 'ready',
        deviceListRefreshStatus: 'idle',
        devices: [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
        ],
      })
    );
  });

  it('publishes a resolved device list after create, join, remove, and continue removal', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest
        .fn<UnifiedSpaceApi['querySpaceState']>()
        .mockResolvedValueOnce({
          hasCompleted: false,
          spaceId: null,
          currentInvitation: null,
          deviceName: null,
        })
        .mockResolvedValue({
          hasCompleted: true,
          spaceId: 'space-1',
          currentInvitation: null,
          deviceName: 'Phone',
        }),
      listDevices: jest.fn(async () => [
        { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.createSpace('Phone', 'passphrase');
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ hasResolvedDeviceList: true, deviceListRefreshStatus: 'idle' })
    );

    await service.leaveSpace();
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ hasResolvedDeviceList: false, deviceListRefreshStatus: 'idle' })
    );

    await service.joinSpace('9R3N-6W2X', 'Phone', 'passphrase');
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ hasResolvedDeviceList: true, deviceListRefreshStatus: 'idle' })
    );

    await service.removeMember('desktop-1');
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ hasResolvedDeviceList: true, deviceListRefreshStatus: 'idle' })
    );
  });
});
