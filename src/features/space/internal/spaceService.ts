import type {
  InvitationIssued,
  LegacyMemberRemovalResult,
  MemberRevocationResult,
  SpaceCreated,
  SpaceInvitation,
  SpaceJoined,
} from '@/platform/engine';
import {
  createInitialUnifiedSpaceSnapshot,
  publishUnifiedSpaceSnapshot,
  type UnifiedSpaceDevice,
  type UnifiedSpaceSnapshot,
} from '../store';
import { invitationCodeForSubmission } from '@/utils/invitationCode';
import { createLogger } from '@/support/observability';

const log = createLogger('UnifiedSpaceService');

export type { UnifiedSpaceSnapshot } from '../store';

export interface CoreSpaceState {
  hasCompleted: boolean;
  spaceId: string | null;
  currentInvitation: SpaceInvitation | null;
  deviceName: string | null;
}

export type ResendEntryOutcome =
  | {
      kind: 'completed';
      accepted: number;
      duplicate: number;
      offline: number;
      errored: number;
      pending: number;
    }
  | { kind: 'entryNotFound'; entryId: string }
  | { kind: 'entryNotResendable'; entryId: string; reason: string }
  | { kind: 'targetNotTrusted'; deviceId: string }
  | { kind: 'noEligibleTargets' };

export interface SpaceCreationResult extends SpaceCreated {
  invitation: InvitationIssued;
}

export interface UnifiedSpaceApi {
  querySpaceState(): Promise<CoreSpaceState>;
  listDevices(): Promise<UnifiedSpaceDevice[]>;
  createSpace(deviceName: string | null, passphrase: string): Promise<SpaceCreated>;
  issueInvitation(): Promise<InvitationIssued>;
  joinSpace(
    invitationCode: string,
    deviceName: string | null,
    passphrase: string,
    preserveUnreadableHistory: boolean
  ): Promise<SpaceJoined>;
  removeMember(deviceId: string): Promise<MemberRevocationResult>;
  queryCurrentMemberRevocation(): Promise<MemberRevocationResult | null>;
  continueMemberRevocation(
    revocationId: string,
    permanentlyLostDeviceIds: string[]
  ): Promise<MemberRevocationResult>;
  secureRemoveLegacyMember(deviceId: string): Promise<LegacyMemberRemovalResult>;
  resendEntry(entryId: string, targetDevices: string[]): Promise<ResendEntryOutcome>;
  leaveSpace(): Promise<void>;
}

export type P2pSpaceSetupRunner = <T>(operation: () => Promise<T>) => Promise<T>;

const runWithoutSetupTransition: P2pSpaceSetupRunner = (operation) => operation();

export type UnifiedSpaceInputErrorCode =
  | 'deviceNameRequired'
  | 'passphraseRequired'
  | 'invitationCodeRequired'
  | 'invitationCodeInvalid';

export type UnifiedSpaceUserErrorCode =
  | UnifiedSpaceInputErrorCode
  | 'invitationNotFound'
  | 'invitationExpired'
  | 'passphraseMismatch'
  | 'sponsorUnreachable'
  | 'connectionTimedOut'
  | 'invitationRejected'
  | 'serviceUnavailable'
  | 'connectionLost'
  | 'unreadableHistoryRequiresConfirmation';

const USER_ERROR_BY_ENGINE_CODE: Readonly<Record<number, UnifiedSpaceUserErrorCode>> = {
  1233: 'passphraseMismatch',
  1234: 'invitationNotFound',
  1235: 'invitationRejected',
  1236: 'sponsorUnreachable',
  1237: 'connectionTimedOut',
  1281: 'invitationExpired',
  1282: 'invitationRejected',
  1283: 'serviceUnavailable',
  1284: 'connectionLost',
  1285: 'connectionTimedOut',
  1292: 'unreadableHistoryRequiresConfirmation',
};

type JoinSpaceStage = 'prepareP2p' | 'requestJoin' | 'refreshDevices';

interface JoinSpaceFailureDetails {
  stage: JoinSpaceStage;
  hadExistingSpace: boolean;
  errorName: string;
  errorCode: number | null;
  userErrorCode: UnifiedSpaceUserErrorCode | null;
}

export class UnifiedSpaceInputError extends Error {
  readonly name = 'UnifiedSpaceInputError';

  constructor(readonly code: UnifiedSpaceInputErrorCode) {
    super(code);
  }
}

export function unifiedSpaceUserErrorCode(cause: unknown): UnifiedSpaceUserErrorCode | null {
  if (cause instanceof UnifiedSpaceInputError) return cause.code;

  const details = [String(cause)];
  if (cause && typeof cause === 'object') {
    const error = cause as { code?: unknown; message?: unknown; cause?: unknown };
    details.push(String(error.code ?? ''), String(error.message ?? ''), String(error.cause ?? ''));
  }

  for (const match of details.join(' ').matchAll(/\b\d{4}\b/g)) {
    const mapped = USER_ERROR_BY_ENGINE_CODE[Number(match[0])];
    if (mapped) return mapped;
  }
  return null;
}

function engineErrorCode(cause: unknown): number | null {
  const details: unknown[] = [cause];
  if (cause && typeof cause === 'object') {
    const error = cause as { code?: unknown; message?: unknown; cause?: unknown };
    details.push(error.code, error.message, error.cause);
  }

  for (const detail of details) {
    if (typeof detail === 'number' && Number.isFinite(detail)) return detail;
    const match = String(detail ?? '').match(/\b\d{4}\b/);
    if (match) return Number(match[0]);
  }
  return null;
}

function joinSpaceFailureDetails(
  cause: unknown,
  stage: JoinSpaceStage,
  hadExistingSpace: boolean
): JoinSpaceFailureDetails {
  return {
    stage,
    hadExistingSpace,
    errorName: cause instanceof Error ? 'Error' : typeof cause,
    errorCode: engineErrorCode(cause),
    userErrorCode: unifiedSpaceUserErrorCode(cause),
  };
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
  private snapshot = createInitialUnifiedSpaceSnapshot();
  private operationRevision = 0;

  constructor(
    private readonly api: UnifiedSpaceApi,
    private readonly publish: (
      snapshot: UnifiedSpaceSnapshot
    ) => void = publishUnifiedSpaceSnapshot,
    private readonly runSetup: P2pSpaceSetupRunner = runWithoutSetupTransition
  ) {
    this.publishSnapshot();
  }

  async refresh(): Promise<UnifiedSpaceSnapshot> {
    const revision = this.beginOperation();
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      const state = await this.api.querySpaceState();
      if (!this.isCurrentOperation(revision)) return this.snapshot;
      if (!state.hasCompleted || !state.spaceId) {
        this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
        this.publishSnapshot();
        return this.snapshot;
      }
      const [devices, memberRemoval] = await Promise.all([
        this.api.listDevices(),
        this.api.queryCurrentMemberRevocation(),
      ]);
      if (!this.isCurrentOperation(revision)) return this.snapshot;
      this.snapshot = {
        status: 'ready',
        spaceId: state.spaceId,
        deviceName: state.deviceName,
        invitation: state.currentInvitation,
        devices,
        memberRemoval,
        lastError: null,
      };
      this.publishSnapshot();
      return this.snapshot;
    } catch (error) {
      if (this.isCurrentOperation(revision)) this.fail(error);
      throw error;
    }
  }

  async createSpace(deviceName: string, secret: string): Promise<SpaceCreationResult> {
    const normalizedName = required(deviceName, 'deviceNameRequired');
    const normalizedPassphrase = passphrase(secret);
    const revision = this.beginOperation();
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      return await this.runSetup(async () => {
        const space = await this.api.createSpace(normalizedName, normalizedPassphrase);
        const invitation = await this.api.issueInvitation();
        const devices = await this.api.listDevices();
        if (!this.isCurrentOperation(revision)) return { ...space, invitation };
        this.snapshot = {
          status: 'ready',
          spaceId: space.spaceId,
          deviceName: normalizedName,
          invitation,
          devices,
          memberRemoval: null,
          lastError: null,
        };
        this.publishSnapshot();
        return { ...space, invitation };
      });
    } catch (error) {
      if (this.isCurrentOperation(revision)) this.fail(error);
      throw error;
    }
  }

  async issueInvitation(): Promise<InvitationIssued> {
    const invitation = await this.api.issueInvitation();
    this.updateSnapshot({ invitation, lastError: null });
    return invitation;
  }

  async refreshDevices(): Promise<UnifiedSpaceSnapshot> {
    if (!this.snapshot.spaceId) return this.snapshot;

    const revision = this.beginOperation();
    const [devices, memberRemoval] = await Promise.all([
      this.api.listDevices(),
      this.api.queryCurrentMemberRevocation(),
    ]);
    if (!this.isCurrentOperation(revision)) return this.snapshot;

    this.updateSnapshot({ devices, memberRemoval, lastError: null });
    return this.snapshot;
  }

  async joinSpace(
    invitationCode: string,
    deviceName: string,
    secret: string,
    preserveUnreadableHistory = false
  ): Promise<SpaceJoined> {
    required(invitationCode, 'invitationCodeRequired');
    const normalizedInvitation = invitationCodeForSubmission(invitationCode);
    if (!normalizedInvitation) throw new UnifiedSpaceInputError('invitationCodeInvalid');
    const normalizedName = required(deviceName, 'deviceNameRequired');
    const normalizedPassphrase = passphrase(secret);
    const hadExistingSpace = Boolean(this.snapshot.spaceId);
    let stage: JoinSpaceStage = 'prepareP2p';
    const revision = this.beginOperation();
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      return await this.runSetup(async () => {
        stage = 'requestJoin';
        const joined = await this.api.joinSpace(
          normalizedInvitation,
          normalizedName,
          normalizedPassphrase,
          preserveUnreadableHistory
        );
        stage = 'refreshDevices';
        const devices = await this.api.listDevices();
        if (!this.isCurrentOperation(revision)) return joined;
        this.snapshot = {
          status: 'ready',
          spaceId: joined.spaceId,
          deviceName: normalizedName,
          invitation: null,
          devices,
          memberRemoval: null,
          lastError: null,
        };
        this.publishSnapshot();
        return joined;
      });
    } catch (error) {
      log.error('Join space failed', joinSpaceFailureDetails(error, stage, hadExistingSpace));
      if (this.isCurrentOperation(revision)) this.fail(error);
      throw error;
    }
  }

  async removeMember(deviceId: string): Promise<MemberRevocationResult> {
    const targetDeviceId = required(deviceId, 'deviceNameRequired');
    const revision = this.beginOperation();
    let result: MemberRevocationResult;
    try {
      result = await this.api.removeMember(targetDeviceId);
    } catch (error) {
      log.error('Failed to remove a space member:', error);
      throw error;
    }
    const devices = await this.api.listDevices();
    if (this.isCurrentOperation(revision)) {
      this.updateSnapshot({ devices, memberRemoval: result, lastError: null });
    }
    return result;
  }

  async continueMemberRevocation(
    revocationId: string,
    permanentlyLostDeviceIds: string[]
  ): Promise<MemberRevocationResult> {
    const revision = this.beginOperation();
    const result = await this.api.continueMemberRevocation(revocationId, permanentlyLostDeviceIds);
    const devices = await this.api.listDevices();
    if (this.isCurrentOperation(revision)) {
      this.updateSnapshot({ devices, memberRemoval: result, lastError: null });
    }
    return result;
  }

  resendEntry(entryId: string, targetDevices: string[] = []): Promise<ResendEntryOutcome> {
    return this.api.resendEntry(entryId, targetDevices);
  }

  async leaveSpace(): Promise<void> {
    const revision = this.beginOperation();
    await this.api.leaveSpace();
    if (!this.isCurrentOperation(revision)) return;
    this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
    this.publishSnapshot();
  }

  private beginOperation(): number {
    this.operationRevision += 1;
    return this.operationRevision;
  }

  private isCurrentOperation(revision: number): boolean {
    return revision === this.operationRevision;
  }

  private fail(error: unknown): void {
    this.updateSnapshot({
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  private updateSnapshot(updates: Partial<UnifiedSpaceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...updates };
    this.publishSnapshot();
  }

  private publishSnapshot(): void {
    this.publish({ ...this.snapshot, devices: [...this.snapshot.devices] });
  }
}

let sharedService: UnifiedSpaceService | null = null;
let sharedApi: UnifiedSpaceApi | null = null;
let sharedRunSetup: P2pSpaceSetupRunner = runWithoutSetupTransition;

export function configureUnifiedSpaceService(
  api: UnifiedSpaceApi,
  runSetup: P2pSpaceSetupRunner
): void {
  if (sharedService) throw new Error('The unified space service has already been created');
  sharedApi = api;
  sharedRunSetup = runSetup;
}

export function getUnifiedSpaceService(): UnifiedSpaceService {
  if (!sharedService) {
    if (!sharedApi) throw new Error('The unified space service is not configured');
    sharedService = new UnifiedSpaceService(sharedApi, publishUnifiedSpaceSnapshot, sharedRunSetup);
  }
  return sharedService;
}
