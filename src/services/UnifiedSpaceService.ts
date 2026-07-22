import type { InvitationIssued, SpaceCreated, SpaceJoined } from 'uc-engine';

export interface UnifiedSpaceApi {
  createSpace(deviceName: string | null, passphrase: string): Promise<SpaceCreated>;
  issueInvitation(): Promise<InvitationIssued>;
  joinSpace(
    invitationCode: string,
    deviceName: string | null,
    passphrase: string
  ): Promise<SpaceJoined>;
}

export type UnifiedSpaceInputErrorCode =
  | 'deviceNameRequired'
  | 'passphraseRequired'
  | 'invitationCodeRequired';

export class UnifiedSpaceInputError extends Error {
  readonly name = 'UnifiedSpaceInputError';

  constructor(readonly code: UnifiedSpaceInputErrorCode) {
    super(code);
  }
}

function required(value: string, code: UnifiedSpaceInputErrorCode): string {
  const normalized = value.trim();
  if (!normalized) throw new UnifiedSpaceInputError(code);
  return normalized;
}

function passphrase(value: string): string {
  if (!value.trim()) throw new UnifiedSpaceInputError('passphraseRequired');
  return value;
}

export class UnifiedSpaceService {
  constructor(private readonly api: UnifiedSpaceApi) {}

  async createSpace(deviceName: string, secret: string): Promise<SpaceCreated> {
    return this.api.createSpace(required(deviceName, 'deviceNameRequired'), passphrase(secret));
  }

  issueInvitation(): Promise<InvitationIssued> {
    return this.api.issueInvitation();
  }

  async joinSpace(
    invitationCode: string,
    deviceName: string,
    secret: string
  ): Promise<SpaceJoined> {
    return this.api.joinSpace(
      required(invitationCode, 'invitationCodeRequired'),
      required(deviceName, 'deviceNameRequired'),
      passphrase(secret)
    );
  }
}

let sharedService: UnifiedSpaceService | null = null;

export function getUnifiedSpaceService(): UnifiedSpaceService {
  if (!sharedService) {
    const engine = require('uc-engine') as UnifiedSpaceApi;
    sharedService = new UnifiedSpaceService(engine);
  }
  return sharedService;
}
