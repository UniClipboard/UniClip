import type { InvitationIssued, SpaceCreated, SpaceInvitation, SpaceJoined } from 'uc-engine';
import {
  createInitialUnifiedSpaceSnapshot,
  publishUnifiedSpaceSnapshot,
  type UnifiedSpaceDevice,
  type UnifiedSpaceSnapshot,
} from '@/stores/unifiedSpaceStore';
import { getP2pSpaceSetupCoordinator } from './P2pSpaceSetupCoordinator';

export type { UnifiedSpaceSnapshot } from '@/stores/unifiedSpaceStore';

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
    passphrase: string
  ): Promise<SpaceJoined>;
  removeMember(deviceId: string): Promise<void>;
  resendEntry(entryId: string, targetDevices: string[]): Promise<ResendEntryOutcome>;
  leaveSpace(): Promise<void>;
}

export type P2pSpaceSetupRunner = <T>(operation: () => Promise<T>) => Promise<T>;

const runWithoutSetupTransition: P2pSpaceSetupRunner = (operation) => operation();

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
  private snapshot = createInitialUnifiedSpaceSnapshot();

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
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      const state = await this.api.querySpaceState();
      if (!state.hasCompleted || !state.spaceId) {
        this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
        this.publishSnapshot();
        return this.snapshot;
      }
      const devices = await this.api.listDevices();
      this.snapshot = {
        status: 'ready',
        spaceId: state.spaceId,
        deviceName: state.deviceName,
        invitation: state.currentInvitation,
        devices,
        lastError: null,
      };
      this.publishSnapshot();
      return this.snapshot;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async createSpace(deviceName: string, secret: string): Promise<SpaceCreationResult> {
    const normalizedName = required(deviceName, 'deviceNameRequired');
    const normalizedPassphrase = passphrase(secret);
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      return await this.runSetup(async () => {
        const space = await this.api.createSpace(normalizedName, normalizedPassphrase);
        const invitation = await this.api.issueInvitation();
        const devices = await this.api.listDevices();
        this.snapshot = {
          status: 'ready',
          spaceId: space.spaceId,
          deviceName: normalizedName,
          invitation,
          devices,
          lastError: null,
        };
        this.publishSnapshot();
        return { ...space, invitation };
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async issueInvitation(): Promise<InvitationIssued> {
    const invitation = await this.api.issueInvitation();
    this.updateSnapshot({ invitation, lastError: null });
    return invitation;
  }

  async joinSpace(
    invitationCode: string,
    deviceName: string,
    secret: string
  ): Promise<SpaceJoined> {
    const normalizedInvitation = required(invitationCode, 'invitationCodeRequired');
    const normalizedName = required(deviceName, 'deviceNameRequired');
    const normalizedPassphrase = passphrase(secret);
    this.updateSnapshot({ status: 'loading', lastError: null });
    try {
      return await this.runSetup(async () => {
        const joined = await this.api.joinSpace(
          normalizedInvitation,
          normalizedName,
          normalizedPassphrase
        );
        const devices = await this.api.listDevices();
        this.snapshot = {
          status: 'ready',
          spaceId: joined.spaceId,
          deviceName: normalizedName,
          invitation: null,
          devices,
          lastError: null,
        };
        this.publishSnapshot();
        return joined;
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async removeMember(deviceId: string): Promise<void> {
    await this.api.removeMember(required(deviceId, 'deviceNameRequired'));
    const devices = await this.api.listDevices();
    this.updateSnapshot({ devices, lastError: null });
  }

  resendEntry(entryId: string, targetDevices: string[] = []): Promise<ResendEntryOutcome> {
    return this.api.resendEntry(entryId, targetDevices);
  }

  async leaveSpace(): Promise<void> {
    await this.api.leaveSpace();
    this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
    this.publishSnapshot();
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

export function getUnifiedSpaceService(): UnifiedSpaceService {
  if (!sharedService) {
    const engine = require('uc-engine') as UnifiedSpaceApi;
    const coordinator = getP2pSpaceSetupCoordinator();
    sharedService = new UnifiedSpaceService(engine, publishUnifiedSpaceSnapshot, (operation) =>
      coordinator.run(operation)
    );
  }
  return sharedService;
}
