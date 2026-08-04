import { describe, expect, it, jest } from '@jest/globals';
import { createLogger } from '../support/observability';
import {
  UnifiedSpaceInputError,
  UnifiedSpaceService,
  unifiedSpaceUserErrorCode,
  type UnifiedSpaceApi,
  type UnifiedSpaceSnapshot,
} from '../features/space';

const log = createLogger('UnifiedSpaceService');

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
    joinSpace: jest.fn(async () => ({
      sponsorDeviceId: 'desktop-1',
      sponsorIdentityFingerprint: 'sponsor-fingerprint',
      spaceId: 'space-1',
      selfDeviceId: 'phone-1',
      selfIdentityFingerprint: 'phone-fingerprint',
      migratedRecords: 0,
      preservedUnreadableRecords: 0,
    })),
    removeMember: jest.fn(async () => undefined),
    queryCurrentMemberRevocation: jest.fn(async () => null),
    continueMemberRevocation: jest.fn(async () => ({
      revocationId: 'revocation-1',
      outcome: 'complete' as const,
      pendingRecipients: 0,
      removedDeviceIds: ['desktop-1'],
      pendingRecipientDeviceIds: [],
      updatedAtMs: 123_456,
    })),
    secureRemoveLegacyMember: jest.fn(async () => ({
      bootstrapId: 'bootstrap-1',
      outcome: 'complete' as const,
      pendingReadmission: 0,
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

describe('UnifiedSpaceService', () => {
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
          return {
            sponsorDeviceId: 'desktop-1',
            sponsorIdentityFingerprint: 'sponsor-fingerprint',
            spaceId: 'space-1',
            selfDeviceId: 'phone-1',
            selfIdentityFingerprint: 'phone-fingerprint',
            migratedRecords: 0,
            preservedUnreadableRecords: 0,
          };
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

  it('returns the member-removal result and refreshes the roster', async () => {
    const removal = {
      revocationId: 'revocation-1',
      outcome: 'applied' as const,
      pendingRecipients: 1,
      removedDeviceIds: ['desktop-1'],
      pendingRecipientDeviceIds: ['laptop-1'],
      updatedAtMs: 123_456,
    };
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      removeMember: jest.fn(async () => removal) as unknown as UnifiedSpaceApi['removeMember'],
      listDevices: jest.fn(async () => [
        { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
      ]),
    });
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));

    await service.refresh();

    await expect(service.removeMember('desktop-1')).resolves.toEqual(removal);
    expect(api.removeMember).toHaveBeenCalledWith('desktop-1');
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.devices).toEqual([
      { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
    ]);
    expect(
      (snapshots.at(-1) as UnifiedSpaceSnapshot & { memberRemoval?: unknown }).memberRemoval
    ).toEqual(removal);
  });

  it('restores a pending member removal after an app restart', async () => {
    const pendingRemoval = {
      revocationId: 'revocation-1',
      outcome: 'applied' as const,
      pendingRecipients: 1,
      removedDeviceIds: ['desktop-1'],
      pendingRecipientDeviceIds: ['laptop-1'],
      updatedAtMs: 123_456,
    };
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = {
      ...createApi(),
      queryCurrentMemberRevocation: jest.fn(async () => pendingRemoval),
    };
    const service = new UnifiedSpaceService(api as UnifiedSpaceApi, (snapshot) =>
      snapshots.push(snapshot)
    );

    await service.refresh();

    expect(api.queryCurrentMemberRevocation).toHaveBeenCalledTimes(1);
    expect(
      (snapshots.at(-1) as UnifiedSpaceSnapshot & { memberRemoval?: unknown }).memberRemoval
    ).toEqual(pendingRemoval);
  });

  it('refreshes a pending member removal when the engine reports a status change', async () => {
    const pendingRemoval = {
      revocationId: 'revocation-1',
      outcome: 'applied' as const,
      pendingRecipients: 1,
      removedDeviceIds: ['desktop-1'],
      pendingRecipientDeviceIds: ['laptop-1'],
      updatedAtMs: 123_456,
    };
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = {
      ...createApi(),
      queryCurrentMemberRevocation: jest.fn(async () => pendingRemoval),
    };
    const service = new UnifiedSpaceService(api as UnifiedSpaceApi, (snapshot) =>
      snapshots.push(snapshot)
    );

    await service.refresh();
    await service.refreshDevices();

    expect(api.queryCurrentMemberRevocation).toHaveBeenCalledTimes(2);
    expect(
      (snapshots.at(-1) as UnifiedSpaceSnapshot & { memberRemoval?: unknown }).memberRemoval
    ).toEqual(pendingRemoval);
  });

  it('continues permanent-loss recovery only through the native engine', async () => {
    const completedRemoval = {
      revocationId: 'revocation-1',
      outcome: 'complete' as const,
      pendingRecipients: 0,
      removedDeviceIds: ['desktop-1'],
      pendingRecipientDeviceIds: [],
      updatedAtMs: 234_567,
    };
    const api = {
      ...createApi(),
      continueMemberRevocation: jest.fn(async () => completedRemoval),
    };
    const service = new UnifiedSpaceService(api as UnifiedSpaceApi, () => undefined);
    const continueMemberRevocation = (
      service as unknown as {
        continueMemberRevocation: (
          revocationId: string,
          permanentlyLostDeviceIds: string[]
        ) => Promise<typeof completedRemoval>;
      }
    ).continueMemberRevocation;

    expect(continueMemberRevocation).toEqual(expect.any(Function));
    await expect(
      continueMemberRevocation.call(service, 'revocation-1', ['laptop-1'])
    ).resolves.toEqual(completedRemoval);
    expect(api.continueMemberRevocation).toHaveBeenCalledWith('revocation-1', ['laptop-1']);
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

  it('does not retry member removal through legacy security operations', async () => {
    const api = {
      ...createApi({
        removeMember: jest.fn(async () => {
          throw new Error('Engine error 1388');
        }) as unknown as UnifiedSpaceApi['removeMember'],
        listDevices: jest.fn(async () => [
          { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        ]),
      }),
      secureRemoveLegacyMember: jest.fn(),
    };
    const service = new UnifiedSpaceService(api, () => undefined);

    await service.refresh();

    await expect(service.removeMember('desktop-1')).rejects.toThrow('Engine error 1388');
    expect(api.removeMember).toHaveBeenCalledWith('desktop-1');
    expect(api.secureRemoveLegacyMember).not.toHaveBeenCalled();
    expect(api.listDevices).toHaveBeenCalledTimes(1);
  });

  it('logs a member-removal failure without starting a legacy recovery flow', async () => {
    const logError = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    const finalError = new Error('Engine error 1410: prepared revocation epoch mismatch');
    const api = {
      ...createApi({
        removeMember: jest.fn(async () => {
          throw finalError;
        }) as unknown as UnifiedSpaceApi['removeMember'],
      }),
      secureRemoveLegacyMember: jest.fn(),
    };
    const service = new UnifiedSpaceService(api, () => undefined);

    await expect(service.removeMember('desktop-1')).rejects.toBe(finalError);

    expect(logError).toHaveBeenCalledWith('Failed to remove a space member:', finalError);
    expect(api.secureRemoveLegacyMember).not.toHaveBeenCalled();
    logError.mockRestore();
  });

  it('leaves the space without invoking any history deletion', async () => {
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi();
    const service = new UnifiedSpaceService(api, (snapshot) => snapshots.push(snapshot));
    await service.refresh();

    await service.leaveSpace();

    expect(api.leaveSpace).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toEqual(
      expect.objectContaining({ status: 'empty', spaceId: null, devices: [] })
    );
  });

  it('does not restore an old space when a refresh finishes after leaving', async () => {
    const pendingState = deferred<Awaited<ReturnType<UnifiedSpaceApi['querySpaceState']>>>();
    const snapshots: UnifiedSpaceSnapshot[] = [];
    const api = createApi({
      querySpaceState: jest.fn(() => pendingState.promise),
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
      joinSpace: jest.fn(async () => ({
        sponsorDeviceId: 'new-desktop',
        sponsorIdentityFingerprint: 'new-sponsor-fingerprint',
        spaceId: 'new-space',
        selfDeviceId: 'new-phone',
        selfIdentityFingerprint: 'new-phone-fingerprint',
        migratedRecords: 0,
      })),
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
});
