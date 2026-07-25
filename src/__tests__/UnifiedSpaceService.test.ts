import { describe, expect, it, jest } from '@jest/globals';
import {
  UnifiedSpaceInputError,
  UnifiedSpaceService,
  type UnifiedSpaceApi,
  type UnifiedSpaceSnapshot,
} from '../services/UnifiedSpaceService';

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
      invitationCode: 'invite-code',
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
    })),
    removeMember: jest.fn(async () => undefined),
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
        await service.joinSpace('invitation', 'Phone', 'passphrase');
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

  it('normalizes the invitation and device name without rewriting the passphrase when joining', async () => {
    const api = createApi();
    const service = new UnifiedSpaceService(api);

    await service.joinSpace('  invite-code  ', '  Travel Phone  ', ' another secret ');

    expect(api.joinSpace).toHaveBeenCalledWith('invite-code', 'Travel Phone', ' another secret ');
  });

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
      expect.objectContaining({ invitationCode: 'invite-code' })
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
    expect(creation.invitation.invitationCode).toBe('invite-code');
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
    await service.joinSpace('new-invitation', 'New Phone', 'passphrase');
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
