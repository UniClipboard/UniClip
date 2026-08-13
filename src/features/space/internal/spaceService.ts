import type {
  DeviceTrustChoice,
  DeviceTrustDecision,
  DeviceTrustSnapshot,
  InvitationIssued,
  SpaceCreated,
  SpaceInvitation,
  SpaceJoined,
  WorkspaceConvergence,
} from '@/platform/engine';
import {
  createInitialUnifiedSpaceSnapshot,
  publishUnifiedSpaceSnapshot,
  type UnifiedSpaceDevice,
  type UnifiedSpaceSnapshot,
} from '../store';
import { invitationCodeForSubmission } from '@/utils/invitationCode';
import { createLogger } from '@/support/observability';
import { getSpaceSetupCompletion, type SpaceSetupCompletionReporter } from './spaceSetupCompletion';

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
  | { kind: 'synchronizationDisabled' }
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
  queryDeviceTrust(): Promise<DeviceTrustSnapshot>;
  decideDeviceTrustChange(
    changeId: string,
    choice: DeviceTrustChoice,
    confirmLocalRemoval: boolean
  ): Promise<DeviceTrustDecision>;
  removeMember(deviceId: string): Promise<WorkspaceConvergence>;
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
type SpaceRefreshStage = 'querySpaceState' | 'listDevices' | 'queryDeviceTrust';

export type DeviceTrustDecisionInputErrorCode = 'noCurrentChange' | 'choiceNotAllowed';

export class DeviceTrustDecisionInputError extends Error {
  readonly name = 'DeviceTrustDecisionInputError';

  constructor(readonly code: DeviceTrustDecisionInputErrorCode) {
    super(code);
  }
}

interface JoinSpaceFailureDetails {
  stage: JoinSpaceStage;
  hadExistingSpace: boolean;
  errorName: string;
  errorCode: number | null;
  userErrorCode: UnifiedSpaceUserErrorCode | null;
}

interface SpaceRefreshFailureDetails {
  stage: SpaceRefreshStage;
  errorName: string;
  errorCode: number | null;
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

function spaceRefreshFailureDetails(
  cause: unknown,
  stage: SpaceRefreshStage
): SpaceRefreshFailureDetails {
  return {
    stage,
    errorName: cause instanceof Error ? 'Error' : typeof cause,
    errorCode: engineErrorCode(cause),
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
  private mutationRevision = 0;
  private activeMutationRevision: number | null = null;
  private refreshRevision = 0;
  private fullRefreshInFlight: Promise<UnifiedSpaceSnapshot> | null = null;
  private deviceRefreshInFlight: Promise<UnifiedSpaceSnapshot> | null = null;
  private deviceTrustRefreshInFlight: Promise<UnifiedSpaceSnapshot> | null = null;
  private deviceTrustDecisionInFlight: Promise<DeviceTrustDecision> | null = null;

  constructor(
    private readonly api: UnifiedSpaceApi,
    private readonly publish: (
      snapshot: UnifiedSpaceSnapshot
    ) => void = publishUnifiedSpaceSnapshot,
    private readonly runSetup: P2pSpaceSetupRunner = runWithoutSetupTransition,
    private readonly completion: SpaceSetupCompletionReporter = getSpaceSetupCompletion()
  ) {
    this.publishSnapshot();
  }

  refresh(): Promise<UnifiedSpaceSnapshot> {
    if (this.fullRefreshInFlight) return this.fullRefreshInFlight;

    const revision = this.beginRefresh();
    const refresh = this.performFullRefresh(revision);
    this.fullRefreshInFlight = refresh;
    void refresh.then(
      () => this.clearFullRefresh(refresh),
      () => this.clearFullRefresh(refresh)
    );
    return refresh;
  }

  private async performFullRefresh(
    revision: ReturnType<UnifiedSpaceService['beginRefresh']>
  ): Promise<UnifiedSpaceSnapshot> {
    if (this.canPublishRefresh(revision)) {
      this.updateSnapshot({
        status: 'loading',
        lastError: null,
        deviceListRefreshStatus: 'refreshing',
      });
    }
    try {
      const state = await this.runRefreshStep('querySpaceState', () => this.api.querySpaceState());
      await this.completion.resolveFromCore(Boolean(state.hasCompleted && state.spaceId));
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      if (!state.hasCompleted || !state.spaceId) {
        this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
        this.publishSnapshot();
        return this.snapshot;
      }
      const [devices, deviceTrust] = await Promise.all([
        this.runRefreshStep('listDevices', () => this.api.listDevices()),
        this.runRefreshStep('queryDeviceTrust', () => this.api.queryDeviceTrust()),
      ]);
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      this.snapshot = {
        status: 'ready',
        spaceId: state.spaceId,
        deviceName: state.deviceName,
        invitation: state.currentInvitation,
        devices,
        workspaceConvergence: this.snapshot.workspaceConvergence,
        deviceTrust,
        deviceTrustDecisionStatus: 'idle',
        deviceTrustDecisionError: null,
        deviceTrustDecisionOutcome: null,
        lastError: null,
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'idle',
      };
      this.publishSnapshot();
      return this.snapshot;
    } catch (error) {
      if (this.canPublishRefresh(revision)) this.failFullRefresh(error);
      throw error;
    }
  }

  async createSpace(deviceName: string, secret: string): Promise<SpaceCreationResult> {
    const normalizedName = required(deviceName, 'deviceNameRequired');
    const normalizedPassphrase = passphrase(secret);
    let revision: number | null = null;
    try {
      return await this.runSetup(async () => {
        revision = this.beginMutation();
        this.updateSnapshot({ status: 'loading', lastError: null });
        const space = await this.api.createSpace(normalizedName, normalizedPassphrase);
        const invitation = await this.api.issueInvitation();
        const devices = await this.api.listDevices();
        await this.completion.markComplete();
        if (!this.isCurrentMutation(revision)) return { ...space, invitation };
        this.snapshot = {
          status: 'ready',
          spaceId: space.spaceId,
          deviceName: normalizedName,
          invitation,
          devices,
          workspaceConvergence: null,
          deviceTrust: null,
          deviceTrustDecisionStatus: 'idle',
          deviceTrustDecisionError: null,
          deviceTrustDecisionOutcome: null,
          lastError: null,
          hasResolvedDeviceList: true,
          deviceListRefreshStatus: 'idle',
        };
        this.publishSnapshot();
        return { ...space, invitation };
      });
    } catch (error) {
      if (revision === null || this.isCurrentMutation(revision)) this.fail(error);
      throw error;
    } finally {
      if (revision !== null) this.endMutation(revision);
    }
  }

  async issueInvitation(): Promise<InvitationIssued> {
    const invitation = await this.api.issueInvitation();
    this.updateSnapshot({ invitation, lastError: null });
    return invitation;
  }

  refreshDevices(): Promise<UnifiedSpaceSnapshot> {
    if (this.fullRefreshInFlight) return this.fullRefreshInFlight;
    if (!this.snapshot.spaceId) return Promise.resolve(this.snapshot);
    if (this.deviceRefreshInFlight) return this.deviceRefreshInFlight;

    const revision = this.beginRefresh();
    const refresh = this.performDeviceRefresh(revision);
    this.deviceRefreshInFlight = refresh;
    void refresh.then(
      () => this.clearDeviceRefresh(refresh),
      () => this.clearDeviceRefresh(refresh)
    );
    return refresh;
  }

  private async performDeviceRefresh(
    revision: ReturnType<UnifiedSpaceService['beginRefresh']>
  ): Promise<UnifiedSpaceSnapshot> {
    if (this.canPublishRefresh(revision)) {
      this.updateSnapshot({ lastError: null, deviceListRefreshStatus: 'refreshing' });
    }
    try {
      const [devices, deviceTrust] = await Promise.all([
        this.runRefreshStep('listDevices', () => this.api.listDevices()),
        this.runRefreshStep('queryDeviceTrust', () => this.api.queryDeviceTrust()),
      ]);
      if (!this.canPublishRefresh(revision)) return this.snapshot;

      this.updateSnapshot({
        status: this.snapshot.status === 'failed' ? 'ready' : this.snapshot.status,
        devices,
        deviceTrust,
        deviceTrustDecisionError: null,
        lastError: null,
        hasResolvedDeviceList: true,
        deviceListRefreshStatus: 'idle',
      });
      return this.snapshot;
    } catch (error) {
      if (this.canPublishRefresh(revision)) this.failDeviceRefresh(error);
      throw error;
    }
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
    let revision: number | null = null;
    try {
      return await this.runSetup(async () => {
        revision = this.beginMutation();
        this.updateSnapshot({ status: 'loading', lastError: null });
        stage = 'requestJoin';
        const joined = await this.api.joinSpace(
          normalizedInvitation,
          normalizedName,
          normalizedPassphrase,
          preserveUnreadableHistory
        );
        stage = 'refreshDevices';
        const devices = await this.api.listDevices();
        await this.completion.markComplete();
        if (!this.isCurrentMutation(revision)) return joined;
        this.snapshot = {
          status: 'ready',
          spaceId: joined.spaceId,
          deviceName: normalizedName,
          invitation: null,
          devices,
          workspaceConvergence: null,
          deviceTrust: null,
          deviceTrustDecisionStatus: 'idle',
          deviceTrustDecisionError: null,
          deviceTrustDecisionOutcome: null,
          lastError: null,
          hasResolvedDeviceList: true,
          deviceListRefreshStatus: 'idle',
        };
        this.publishSnapshot();
        return joined;
      });
    } catch (error) {
      log.error('Join space failed', joinSpaceFailureDetails(error, stage, hadExistingSpace));
      if (revision === null || this.isCurrentMutation(revision)) this.fail(error);
      throw error;
    } finally {
      if (revision !== null) this.endMutation(revision);
    }
  }

  async removeMember(deviceId: string): Promise<WorkspaceConvergence> {
    const targetDeviceId = required(deviceId, 'deviceNameRequired');
    const revision = this.beginMutation();
    try {
      const result = await this.api.removeMember(targetDeviceId);
      const devices = await this.api.listDevices();
      if (this.isCurrentMutation(revision)) {
        this.updateSnapshot({
          devices,
          workspaceConvergence: result,
          lastError: null,
          hasResolvedDeviceList: true,
          deviceListRefreshStatus: 'idle',
        });
      }
      return result;
    } catch (error) {
      log.error('Failed to remove a space member:', error);
      throw error;
    } finally {
      this.endMutation(revision);
    }
  }

  refreshDeviceTrust(): Promise<UnifiedSpaceSnapshot> {
    if (this.deviceTrustRefreshInFlight) return this.deviceTrustRefreshInFlight;
    const revision = this.beginRefresh();
    const refresh = this.performDeviceTrustRefresh(revision);
    this.deviceTrustRefreshInFlight = refresh;
    void refresh.then(
      () => this.clearDeviceTrustRefresh(refresh),
      () => this.clearDeviceTrustRefresh(refresh)
    );
    return refresh;
  }

  private async performDeviceTrustRefresh(
    revision: ReturnType<UnifiedSpaceService['beginRefresh']>
  ): Promise<UnifiedSpaceSnapshot> {
    try {
      const deviceTrust = await this.runRefreshStep('queryDeviceTrust', () =>
        this.api.queryDeviceTrust()
      );
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      this.updateSnapshot({ deviceTrust, deviceTrustDecisionError: null });
      return this.snapshot;
    } catch (error) {
      if (this.canPublishRefresh(revision)) {
        this.updateSnapshot({
          deviceTrustDecisionError: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  decideDeviceTrust(
    choice: DeviceTrustChoice,
    confirmLocalRemoval: boolean
  ): Promise<DeviceTrustDecision> {
    if (this.deviceTrustDecisionInFlight) return this.deviceTrustDecisionInFlight;

    const change = this.snapshot.deviceTrust?.currentChange;
    if (!change) return Promise.reject(new DeviceTrustDecisionInputError('noCurrentChange'));
    if (!change.allowedChoices.includes(choice)) {
      return Promise.reject(new DeviceTrustDecisionInputError('choiceNotAllowed'));
    }

    const revision = this.beginMutation();
    this.updateSnapshot({
      deviceTrustDecisionStatus: 'submitting',
      deviceTrustDecisionError: null,
      deviceTrustDecisionOutcome: null,
    });
    const decision = this.performDeviceTrustDecision(
      revision,
      change.changeId,
      choice,
      confirmLocalRemoval
    );
    this.deviceTrustDecisionInFlight = decision;
    void decision.then(
      () => this.clearDeviceTrustDecision(decision),
      () => this.clearDeviceTrustDecision(decision)
    );
    return decision;
  }

  private async performDeviceTrustDecision(
    revision: number,
    changeId: string,
    choice: DeviceTrustChoice,
    confirmLocalRemoval: boolean
  ): Promise<DeviceTrustDecision> {
    try {
      const result = await this.api.decideDeviceTrustChange(changeId, choice, confirmLocalRemoval);
      if (this.isCurrentMutation(revision)) {
        this.updateSnapshot({
          deviceTrust: result.snapshot,
          deviceTrustDecisionStatus: 'idle',
          deviceTrustDecisionError: null,
          deviceTrustDecisionOutcome: result.kind,
        });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.endMutation(revision);
      try {
        await this.refreshDeviceTrust();
      } catch {
        // The original decision failure is the actionable error shown to the user.
      }
      this.updateSnapshot({
        deviceTrustDecisionStatus: 'idle',
        deviceTrustDecisionError: message,
        deviceTrustDecisionOutcome: null,
      });
      throw error;
    } finally {
      this.endMutation(revision);
    }
  }

  getSnapshot(): UnifiedSpaceSnapshot {
    return this.snapshot;
  }

  resendEntry(entryId: string, targetDevices: string[] = []): Promise<ResendEntryOutcome> {
    return this.api.resendEntry(entryId, targetDevices);
  }

  async leaveSpace(): Promise<void> {
    const revision = this.beginMutation();
    try {
      await this.api.leaveSpace();
      await this.completion.markIncomplete();
      if (!this.isCurrentMutation(revision)) return;
      this.snapshot = createInitialUnifiedSpaceSnapshot('empty');
      this.publishSnapshot();
    } finally {
      this.endMutation(revision);
    }
  }

  private beginMutation(): number {
    this.mutationRevision += 1;
    this.refreshRevision += 1;
    this.activeMutationRevision = this.mutationRevision;
    this.fullRefreshInFlight = null;
    this.deviceRefreshInFlight = null;
    this.deviceTrustRefreshInFlight = null;
    return this.mutationRevision;
  }

  private endMutation(revision: number): void {
    if (this.activeMutationRevision !== revision) return;
    this.activeMutationRevision = null;
    this.fullRefreshInFlight = null;
    this.deviceRefreshInFlight = null;
    this.deviceTrustRefreshInFlight = null;
  }

  private isCurrentMutation(revision: number): boolean {
    return revision === this.mutationRevision;
  }

  private beginRefresh(): {
    refreshRevision: number;
    mutationRevision: number;
    startedDuringMutation: boolean;
  } {
    this.refreshRevision += 1;
    return {
      refreshRevision: this.refreshRevision,
      mutationRevision: this.mutationRevision,
      startedDuringMutation: this.activeMutationRevision !== null,
    };
  }

  private canPublishRefresh(revision: {
    refreshRevision: number;
    mutationRevision: number;
    startedDuringMutation: boolean;
  }): boolean {
    return (
      !revision.startedDuringMutation &&
      this.activeMutationRevision === null &&
      revision.refreshRevision === this.refreshRevision &&
      revision.mutationRevision === this.mutationRevision
    );
  }

  private fail(error: unknown): void {
    this.updateSnapshot({
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  private failFullRefresh(error: unknown): void {
    this.updateSnapshot({
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      deviceListRefreshStatus: 'failed',
    });
  }

  private failDeviceRefresh(error: unknown): void {
    this.updateSnapshot({
      deviceListRefreshStatus: 'failed',
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

  private clearFullRefresh(refresh: Promise<UnifiedSpaceSnapshot>): void {
    if (this.fullRefreshInFlight === refresh) this.fullRefreshInFlight = null;
  }

  private clearDeviceRefresh(refresh: Promise<UnifiedSpaceSnapshot>): void {
    if (this.deviceRefreshInFlight === refresh) this.deviceRefreshInFlight = null;
  }

  private clearDeviceTrustRefresh(refresh: Promise<UnifiedSpaceSnapshot>): void {
    if (this.deviceTrustRefreshInFlight === refresh) this.deviceTrustRefreshInFlight = null;
  }

  private clearDeviceTrustDecision(decision: Promise<DeviceTrustDecision>): void {
    if (this.deviceTrustDecisionInFlight === decision) this.deviceTrustDecisionInFlight = null;
  }

  private async runRefreshStep<T>(
    stage: SpaceRefreshStage,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      log.error('Space refresh failed', spaceRefreshFailureDetails(error, stage));
      throw error;
    }
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
