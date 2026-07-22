import { describe, expect, it, jest } from '@jest/globals';
import type { InvitationIssued, SpaceCreated, SpaceJoined } from 'uc-engine';
import {
  UnifiedSpaceInputError,
  UnifiedSpaceService,
  type UnifiedSpaceApi,
} from '../services/UnifiedSpaceService';

const created: SpaceCreated = {
  spaceId: 'space-1',
  selfDeviceId: 'device-1',
  identityFingerprint: 'fingerprint-1',
};

const invitation: InvitationIssued = {
  invitationCode: '1234-5678',
  expiresAtMs: 1_800_000,
  availability: 'sameLocalNetwork',
};

const joined: SpaceJoined = {
  sponsorDeviceId: 'sponsor-1',
  sponsorIdentityFingerprint: 'sponsor-fingerprint',
  spaceId: 'space-1',
  selfDeviceId: 'device-2',
  selfIdentityFingerprint: 'self-fingerprint',
  migratedRecords: 0,
};

function api(): jest.Mocked<UnifiedSpaceApi> {
  return {
    createSpace: jest.fn(async () => created),
    issueInvitation: jest.fn(async () => invitation),
    joinSpace: jest.fn(async () => joined),
  };
}

describe('UnifiedSpaceService', () => {
  it('normalizes the device name without rewriting the passphrase when creating a space', async () => {
    const native = api();
    const service = new UnifiedSpaceService(native);

    await expect(service.createSpace('  My Phone  ', ' secret with spaces ')).resolves.toEqual(
      created
    );

    expect(native.createSpace).toHaveBeenCalledWith('My Phone', ' secret with spaces ');
  });

  it('normalizes the invitation and device name without rewriting the passphrase when joining', async () => {
    const native = api();
    const service = new UnifiedSpaceService(native);

    await expect(
      service.joinSpace('  1234-5678  ', '  Travel Phone  ', ' another secret ')
    ).resolves.toEqual(joined);

    expect(native.joinSpace).toHaveBeenCalledWith('1234-5678', 'Travel Phone', ' another secret ');
  });

  it.each([
    ['deviceNameRequired', '', 'passphrase', undefined],
    ['passphraseRequired', 'Phone', '   ', undefined],
    ['invitationCodeRequired', 'Phone', 'passphrase', '   '],
  ] as const)(
    'rejects %s before calling the native engine',
    async (code, deviceName, passphrase, invitationCode) => {
      const native = api();
      const service = new UnifiedSpaceService(native);

      const operation =
        invitationCode === undefined
          ? service.createSpace(deviceName, passphrase)
          : service.joinSpace(invitationCode, deviceName, passphrase);

      await expect(operation).rejects.toMatchObject<UnifiedSpaceInputError>({ code });
      expect(native.createSpace).not.toHaveBeenCalled();
      expect(native.joinSpace).not.toHaveBeenCalled();
    }
  );

  it('issues an invitation independently from space creation', async () => {
    const native = api();
    const service = new UnifiedSpaceService(native);

    await expect(service.issueInvitation()).resolves.toEqual(invitation);
    expect(native.issueInvitation).toHaveBeenCalledTimes(1);
    expect(native.createSpace).not.toHaveBeenCalled();
  });
});
