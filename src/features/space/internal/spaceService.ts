import type {
  DeviceTrustChoice,
  DeviceTrustDecision,
  DeviceTrustSnapshot,
  InvitationIssued,
  JoinedSpace,
  JoinSpaceRejectionReason,
  JoinSpaceStatus,
  SpaceCreated,
  SpaceInvitation,
  WorkspaceConvergence,
} from '@/platform/engine';
import {
  createInitialUnifiedSpaceSnapshot,
  publishUnifiedSpaceSnapshot,
  type UnifiedSpaceDevice,
  type UnifiedSpaceSnapshot,
  type DeviceTrustFailure,
  type DeviceTrustQueryState,
} from '../store';
import { invitationCodeForSubmission } from '@/utils/invitationCode';
import { createLogger } from '@/support/observability';
import { buildSpaceOperationContext, buildSpaceOperationResult } from '../deviceTrustPresentation';
import { getSpaceSetupCompletion, type SpaceSetupCompletionReporter } from './spaceSetupCompletion';

const log = createLogger('UnifiedSpaceService');

export type { UnifiedSpaceSnapshot } from '../store';

export interface CoreSpaceState {
  hasCompleted: boolean;
  rePairingRequired?: boolean;
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
  ): Promise<JoinSpaceStatus>;
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

export interface UnifiedSpaceRefreshOptions {
  afterInvalidation?: boolean;
}

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

type DeviceListReadResult = { kind: 'ready'; devices: UnifiedSpaceDevice[] } | { kind: 'failed' };

type PostOperationSpaceRead =
  | {
      kind: 'ready';
      state: CoreSpaceState & { spaceId: string };
      devices: DeviceListReadResult;
      deviceTrustQuery: DeviceTrustQueryState;
    }
  | {
      kind: 'empty';
      devices: DeviceListReadResult;
      deviceTrustQuery: DeviceTrustQueryState;
    }
  | { kind: 'failed' };

export type DeviceTrustDecisionInputErrorCode = 'noCurrentChange' | 'choiceNotAllowed';

export class DeviceTrustDecisionInputError extends Error {
  readonly name = 'DeviceTrustDecisionInputError';

  constructor(readonly code: DeviceTrustDecisionInputErrorCode) {
    super(code);
  }
}

export class SpaceOperationInProgressError extends Error {
  readonly name = 'SpaceOperationInProgressError';

  constructor() {
    super('spaceOperationInProgress');
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

interface SpaceOperationFailureDetails {
  operation: 'removeMember';
  errorName: string;
  errorCode: number | null;
}

export class UnifiedSpaceInputError extends Error {
  readonly name = 'UnifiedSpaceInputError';

  constructor(readonly code: UnifiedSpaceInputErrorCode) {
    super(code);
  }
}

class UnifiedSpaceJoinResultError extends Error {
  readonly name = 'UnifiedSpaceJoinResultError';

  constructor(readonly code: UnifiedSpaceUserErrorCode) {
    super(code);
  }
}

export function unifiedSpaceUserErrorCode(cause: unknown): UnifiedSpaceUserErrorCode | null {
  if (cause instanceof UnifiedSpaceInputError) return cause.code;
  if (cause instanceof UnifiedSpaceJoinResultError) return cause.code;

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

function rejectedJoinErrorCode(reason: JoinSpaceRejectionReason): UnifiedSpaceUserErrorCode {
  switch (reason) {
    case 'authenticationRejected':
      return 'passphraseMismatch';
    case 'peerUpgradeRequired':
    case 'baseHistoryChanged':
    case 'joinerHistoryAhead':
    case 'historyConflict':
      return 'serviceUnavailable';
    case 'invitationUnavailable':
    case 'identityConflict':
    case 'cancelled':
    case 'removedBeforeActivation':
      return 'invitationRejected';
  }
}

function requireActiveJoinedSpace(status: JoinSpaceStatus): JoinedSpace {
  switch (status.type) {
    case 'active':
      return status.joinedSpace;
    case 'pending':
      throw new UnifiedSpaceJoinResultError('serviceUnavailable');
    case 'rejected':
      throw new UnifiedSpaceJoinResultError(rejectedJoinErrorCode(status.reason));
  }
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

function spaceOperationFailureDetails(
  cause: unknown,
  operation: SpaceOperationFailureDetails['operation']
): SpaceOperationFailureDetails {
  return {
    operation,
    errorName: cause instanceof Error ? 'Error' : typeof cause,
    errorCode: engineErrorCode(cause),
  };
}

function structuredDeviceTrustFailure(cause: unknown): DeviceTrustFailure {
  const source = cause && typeof cause === 'object' ? cause : null;
  const code = source && 'code' in source && typeof source.code === 'number' ? source.code : null;
  const category =
    source && 'category' in source && typeof source.category === 'string' ? source.category : null;
  const retryable =
    source && 'retryable' in source && typeof source.retryable === 'boolean'
      ? source.retryable
      : false;
  return { operation: 'queryDeviceTrust', code, category, retryable };
}

function failedDeviceTrustQuery(cause: unknown): DeviceTrustQueryState {
  const failure = structuredDeviceTrustFailure(cause);
  if (failure.code === 1392) return { kind: 'unavailable', failure };
  if (failure.code === 1394) return { kind: 'corrupt', failure };
  return { kind: 'failed', failure };
}

function deviceTrustSnapshot(query: DeviceTrustQueryState): DeviceTrustSnapshot | null {
  if (query.kind === 'ready') return query.snapshot;
  if (query.kind === 'loading') return query.previous;
  return null;
}

function newestReadyDeviceTrustQuery(
  current: DeviceTrustQueryState,
  fallback: DeviceTrustQueryState
): DeviceTrustQueryState {
  if (
    current.kind === 'ready' &&
    fallback.kind === 'ready' &&
    fallback.snapshot.revision > current.snapshot.revision
  ) {
    return fallback;
  }
  return current;
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

  refresh(options: UnifiedSpaceRefreshOptions = {}): Promise<UnifiedSpaceSnapshot> {
    if (this.fullRefreshInFlight) {
      if (!options.afterInvalidation) return this.fullRefreshInFlight;
      this.refreshRevision += 1;
      const current = this.fullRefreshInFlight;
      return current.then(
        () => this.refresh(),
        () => this.refresh()
      );
    }

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
        deviceTrustQuery: {
          kind: 'loading',
          previous: deviceTrustSnapshot(this.snapshot.deviceTrustQuery),
        },
      });
    }
    try {
      const state = await this.runRefreshStep('querySpaceState', () => this.api.querySpaceState());
      await this.completion.resolveFromCore(
        Boolean(state.hasCompleted && !state.rePairingRequired && state.spaceId)
      );
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      if (!state.hasCompleted || state.rePairingRequired || !state.spaceId) {
        return this.publishNoCurrentSpace();
      }
      const [devicesResult, deviceTrustQuery] = await Promise.all([
        this.runRefreshStep('listDevices', () => this.api.listDevices()).then(
          (devices) => ({ kind: 'ready' as const, devices }),
          (error: unknown) => ({ kind: 'failed' as const, error })
        ),
        this.queryDeviceTrustState(),
      ]);
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      if (
        deviceTrustQuery.kind === 'ready' &&
        deviceTrustQuery.snapshot.localMembership === 'removed'
      ) {
        return this.publishNoCurrentSpace();
      }
      const sameSpace = state.spaceId === this.snapshot.spaceId;
      const devices =
        devicesResult.kind === 'ready'
          ? devicesResult.devices
          : sameSpace
          ? this.snapshot.devices
          : [];
      this.snapshot = {
        status: 'ready',
        spaceId: state.spaceId,
        deviceName: state.deviceName,
        invitation: state.currentInvitation,
        devices,
        workspaceConvergence: sameSpace ? this.snapshot.workspaceConvergence : null,
        deviceTrustQuery,
        deviceTrustDecisionStatus: 'idle',
        deviceTrustDecisionError: null,
        deviceTrustDecisionOutcome: null,
        operationState:
          state.spaceId === this.snapshot.spaceId ? this.snapshot.operationState : { kind: 'idle' },
        lastError:
          devicesResult.kind === 'failed'
            ? devicesResult.error instanceof Error
              ? devicesResult.error.message
              : String(devicesResult.error)
            : null,
        hasResolvedDeviceList:
          devicesResult.kind === 'ready'
            ? true
            : sameSpace
            ? this.snapshot.hasResolvedDeviceList
            : false,
        deviceListRefreshStatus: devicesResult.kind === 'ready' ? 'idle' : 'failed',
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
          deviceTrustQuery: { kind: 'idle' },
          deviceTrustDecisionStatus: 'idle',
          deviceTrustDecisionError: null,
          deviceTrustDecisionOutcome: null,
          operationState: { kind: 'idle' },
          lastError: null,
          hasResolvedDeviceList: true,
          deviceListRefreshStatus: 'idle',
        };
        this.publishSnapshot();
        return { ...space, invitation };
      });
    } catch (error) {
      if (
        !(error instanceof SpaceOperationInProgressError) &&
        (revision === null || this.isCurrentMutation(revision))
      ) {
        this.fail(error);
      }
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
      this.updateSnapshot({
        lastError: null,
        deviceListRefreshStatus: 'refreshing',
        deviceTrustQuery: {
          kind: 'loading',
          previous: deviceTrustSnapshot(this.snapshot.deviceTrustQuery),
        },
      });
    }
    try {
      const [devicesResult, deviceTrustQuery] = await Promise.all([
        this.runRefreshStep('listDevices', () => this.api.listDevices()).then(
          (devices) => ({ kind: 'ready' as const, devices }),
          (error: unknown) => ({ kind: 'failed' as const, error })
        ),
        this.queryDeviceTrustState(),
      ]);
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      if (
        deviceTrustQuery.kind === 'ready' &&
        deviceTrustQuery.snapshot.localMembership === 'removed'
      ) {
        return this.publishNoCurrentSpace();
      }
      const devices =
        devicesResult.kind === 'ready' ? devicesResult.devices : this.snapshot.devices;
      this.updateSnapshot({
        status: this.snapshot.status === 'failed' ? 'ready' : this.snapshot.status,
        devices,
        deviceTrustQuery,
        deviceTrustDecisionError: null,
        lastError:
          devicesResult.kind === 'failed'
            ? devicesResult.error instanceof Error
              ? devicesResult.error.message
              : String(devicesResult.error)
            : null,
        hasResolvedDeviceList:
          devicesResult.kind === 'ready' ? true : this.snapshot.hasResolvedDeviceList,
        deviceListRefreshStatus: devicesResult.kind === 'ready' ? 'idle' : 'failed',
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
  ): Promise<JoinedSpace> {
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
        const joinStatus = await this.api.joinSpace(
          normalizedInvitation,
          normalizedName,
          normalizedPassphrase,
          preserveUnreadableHistory
        );
        const joined = requireActiveJoinedSpace(joinStatus);
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
          deviceTrustQuery: { kind: 'idle' },
          deviceTrustDecisionStatus: 'idle',
          deviceTrustDecisionError: null,
          deviceTrustDecisionOutcome: null,
          operationState: { kind: 'idle' },
          lastError: null,
          hasResolvedDeviceList: true,
          deviceListRefreshStatus: 'idle',
        };
        this.publishSnapshot();
        return joined;
      });
    } catch (error) {
      log.error('Join space failed', joinSpaceFailureDetails(error, stage, hadExistingSpace));
      if (
        !(error instanceof SpaceOperationInProgressError) &&
        (revision === null || this.isCurrentMutation(revision))
      ) {
        this.fail(error);
      }
      throw error;
    } finally {
      if (revision !== null) this.endMutation(revision);
    }
  }

  async removeMember(deviceId: string): Promise<WorkspaceConvergence> {
    const targetDeviceId = required(deviceId, 'deviceNameRequired');
    const spaceId = this.snapshot.spaceId;
    const operation = buildSpaceOperationContext(
      'removeMember',
      spaceId,
      this.snapshot.deviceTrustQuery,
      this.snapshot.devices,
      targetDeviceId
    );
    let revision: number;
    try {
      revision = this.beginMutation();
    } catch (error) {
      return Promise.reject(error);
    }
    this.updateSnapshot({ operationState: { kind: 'submitting', operation } });
    try {
      const result = await this.api.removeMember(targetDeviceId);
      await this.completeAcceptedOperation(revision, operation, {
        fallbackDeviceTrustQuery: this.snapshot.deviceTrustQuery,
        fallbackDevices: this.snapshot.devices,
        workspaceConvergence: result,
        decisionOutcome: null,
      });
      return result;
    } catch (error) {
      if (this.isCurrentMutation(revision)) {
        this.updateSnapshot({ operationState: { kind: 'idle' } });
      }
      log.error(
        'Failed to remove a space member',
        spaceOperationFailureDetails(error, 'removeMember')
      );
      throw error;
    } finally {
      this.endMutation(revision);
    }
  }

  refreshDeviceTrust(): Promise<UnifiedSpaceSnapshot> {
    if (this.deviceTrustRefreshInFlight) return this.deviceTrustRefreshInFlight;
    if (!this.snapshot.spaceId) return Promise.resolve(this.snapshot);
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
      const deviceTrustQuery = await this.queryDeviceTrustState();
      if (!this.canPublishRefresh(revision)) return this.snapshot;
      if (
        deviceTrustQuery.kind === 'ready' &&
        deviceTrustQuery.snapshot.localMembership === 'removed'
      ) {
        return this.publishNoCurrentSpace();
      }
      this.updateSnapshot({
        deviceTrustQuery,
        deviceTrustDecisionError: null,
      });
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

    const change = deviceTrustSnapshot(this.snapshot.deviceTrustQuery)?.currentChange;
    if (!change) return Promise.reject(new DeviceTrustDecisionInputError('noCurrentChange'));
    if (!change.allowedChoices.includes(choice)) {
      return Promise.reject(new DeviceTrustDecisionInputError('choiceNotAllowed'));
    }
    const spaceId = this.snapshot.spaceId;
    if (!spaceId) return Promise.reject(new DeviceTrustDecisionInputError('noCurrentChange'));
    const operation = buildSpaceOperationContext(
      choice === 'applyChange' ? 'applyChange' : 'keepCurrentSpace',
      spaceId,
      this.snapshot.deviceTrustQuery,
      this.snapshot.devices
    );

    let revision: number;
    try {
      revision = this.beginMutation();
    } catch (error) {
      return Promise.reject(error);
    }
    this.updateSnapshot({
      deviceTrustDecisionStatus: 'submitting',
      deviceTrustDecisionError: null,
      deviceTrustDecisionOutcome: null,
      operationState: { kind: 'submitting', operation },
    });
    const decision = this.performDeviceTrustDecision(
      revision,
      change.changeId,
      choice,
      confirmLocalRemoval,
      operation
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
    confirmLocalRemoval: boolean,
    operation: ReturnType<typeof buildSpaceOperationContext>
  ): Promise<DeviceTrustDecision> {
    try {
      const result = await this.api.decideDeviceTrustChange(changeId, choice, confirmLocalRemoval);
      if (this.isCurrentMutation(revision)) {
        if (result.kind === 'localDeviceConfirmationRequired') {
          this.updateSnapshot({
            deviceTrustQuery: { kind: 'ready', snapshot: result.snapshot },
            deviceTrustDecisionStatus: 'idle',
            deviceTrustDecisionError: 'localDeviceConfirmationRequired',
            deviceTrustDecisionOutcome: result.kind,
            operationState: { kind: 'idle' },
          });
          return result;
        }
        const completedChoice =
          result.kind === 'applied'
            ? 'applyChange'
            : result.kind === 'keptCurrentDeviceGroup'
            ? 'keepCurrentDeviceGroup'
            : result.kind === 'alreadyCompleted'
            ? result.completedChoice
            : choice;
        const completedOperation = {
          ...operation,
          kind:
            completedChoice === 'applyChange'
              ? ('applyChange' as const)
              : ('keepCurrentSpace' as const),
        };
        const fallbackDevices = this.snapshot.devices;
        const fallbackDeviceTrustQuery = { kind: 'ready', snapshot: result.snapshot } as const;
        const operationResult = buildSpaceOperationResult(
          completedOperation,
          fallbackDeviceTrustQuery,
          fallbackDevices,
          'verified',
          result.kind
        );
        if (result.snapshot.localMembership === 'removed') {
          this.snapshot = {
            ...createInitialUnifiedSpaceSnapshot('empty'),
            deviceTrustDecisionOutcome: result.kind,
            operationState: { kind: 'result', result: operationResult },
          };
          this.publishSnapshot();
        } else {
          this.updateSnapshot({
            deviceTrustQuery: fallbackDeviceTrustQuery,
            deviceTrustDecisionStatus: 'idle',
            deviceTrustDecisionError: null,
            deviceTrustDecisionOutcome: result.kind,
            operationState: {
              kind: 'result',
              result: operationResult,
            },
          });
        }
        await this.completeAcceptedOperation(revision, completedOperation, {
          fallbackDeviceTrustQuery,
          fallbackDevices,
          workspaceConvergence: this.snapshot.workspaceConvergence,
          decisionOutcome: result.kind,
        });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const deviceTrustQuery = await this.queryDeviceTrustState();
      if (this.isCurrentMutation(revision)) {
        if (
          deviceTrustQuery.kind === 'ready' &&
          deviceTrustQuery.snapshot.localMembership === 'removed'
        ) {
          this.snapshot = {
            ...createInitialUnifiedSpaceSnapshot('empty'),
            deviceTrustDecisionError: message,
          };
          this.publishSnapshot();
        } else {
          this.updateSnapshot({
            deviceTrustQuery,
            deviceTrustDecisionStatus: 'idle',
            deviceTrustDecisionError: message,
            deviceTrustDecisionOutcome: null,
            operationState: { kind: 'idle' },
          });
        }
      }
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
    const spaceId = this.snapshot.spaceId;
    const operation = buildSpaceOperationContext(
      'leaveSpace',
      spaceId,
      this.snapshot.deviceTrustQuery,
      this.snapshot.devices
    );
    const revision = this.beginMutation();
    this.updateSnapshot({ operationState: { kind: 'submitting', operation } });
    try {
      await this.api.leaveSpace();
      if (!this.isCurrentMutation(revision)) return;
      const fallbackDevices = this.snapshot.devices;
      this.snapshot = {
        ...createInitialUnifiedSpaceSnapshot('empty'),
        operationState: {
          kind: 'result',
          result: buildSpaceOperationResult(operation, { kind: 'notApplicable' }, [], 'verified'),
        },
      };
      this.publishSnapshot();
      await this.completeAcceptedOperation(revision, operation, {
        fallbackDeviceTrustQuery: { kind: 'notApplicable' },
        fallbackDevices,
        workspaceConvergence: null,
        decisionOutcome: null,
      });
    } catch (error) {
      if (this.isCurrentMutation(revision)) {
        this.updateSnapshot({ operationState: { kind: 'idle' } });
      }
      throw error;
    } finally {
      this.endMutation(revision);
    }
  }

  clearOperationResult(): void {
    if (this.snapshot.operationState.kind !== 'result') return;
    this.updateSnapshot({ operationState: { kind: 'idle' } });
  }

  private async completeAcceptedOperation(
    revision: number,
    operation: ReturnType<typeof buildSpaceOperationContext>,
    fallback: {
      fallbackDeviceTrustQuery: DeviceTrustQueryState;
      fallbackDevices: UnifiedSpaceDevice[];
      workspaceConvergence: WorkspaceConvergence | null;
      decisionOutcome: DeviceTrustDecision['kind'] | null;
    }
  ): Promise<void> {
    const read = await this.readPostOperationSpace();
    if (!this.isCurrentMutation(revision)) return;

    if (read.kind === 'failed') {
      const operationResult = buildSpaceOperationResult(
        operation,
        fallback.fallbackDeviceTrustQuery,
        fallback.fallbackDevices,
        'unverified',
        fallback.decisionOutcome
      );
      if (
        operation.kind === 'leaveSpace' ||
        (fallback.fallbackDeviceTrustQuery.kind === 'ready' &&
          fallback.fallbackDeviceTrustQuery.snapshot.localMembership === 'removed')
      ) {
        this.snapshot = {
          ...createInitialUnifiedSpaceSnapshot('empty'),
          operationState: { kind: 'result', result: operationResult },
          deviceListRefreshStatus: 'failed',
        };
        this.publishSnapshot();
        return;
      }
      this.updateSnapshot({
        deviceTrustQuery: fallback.fallbackDeviceTrustQuery,
        deviceTrustDecisionStatus: 'idle',
        deviceTrustDecisionError: null,
        deviceTrustDecisionOutcome: fallback.decisionOutcome,
        deviceListRefreshStatus: 'failed',
        operationState: { kind: 'result', result: operationResult },
      });
      return;
    }

    const sameSpace = read.kind === 'ready' && read.state.spaceId === operation.spaceId;
    const deviceTrustQuery = sameSpace
      ? newestReadyDeviceTrustQuery(read.deviceTrustQuery, fallback.fallbackDeviceTrustQuery)
      : read.deviceTrustQuery;
    const devices = read.devices.kind === 'ready' ? read.devices.devices : fallback.fallbackDevices;
    const verification =
      read.devices.kind === 'ready' && deviceTrustQuery.kind === 'ready'
        ? 'verified'
        : 'unverified';
    const operationResult = buildSpaceOperationResult(
      operation,
      deviceTrustQuery,
      devices,
      read.kind === 'empty'
        ? 'verified'
        : operation.kind === 'leaveSpace'
        ? 'unverified'
        : verification,
      fallback.decisionOutcome
    );

    if (
      read.kind === 'empty' ||
      (deviceTrustQuery.kind === 'ready' &&
        deviceTrustQuery.snapshot.localMembership === 'removed') ||
      (operation.kind === 'leaveSpace' && sameSpace)
    ) {
      this.snapshot = {
        ...createInitialUnifiedSpaceSnapshot('empty'),
        operationState: { kind: 'result', result: operationResult },
        deviceListRefreshStatus: read.devices.kind === 'ready' ? 'idle' : 'failed',
      };
      this.publishSnapshot();
      return;
    }

    this.snapshot = {
      status: 'ready',
      spaceId: read.state.spaceId,
      deviceName: read.state.deviceName,
      invitation: read.state.currentInvitation,
      devices: read.devices.kind === 'ready' ? read.devices.devices : sameSpace ? devices : [],
      workspaceConvergence: sameSpace ? fallback.workspaceConvergence : null,
      deviceTrustQuery,
      deviceTrustDecisionStatus: 'idle',
      deviceTrustDecisionError: null,
      deviceTrustDecisionOutcome: sameSpace ? fallback.decisionOutcome : null,
      operationState: sameSpace ? { kind: 'result', result: operationResult } : { kind: 'idle' },
      lastError: null,
      hasResolvedDeviceList:
        read.devices.kind === 'ready'
          ? true
          : sameSpace
          ? this.snapshot.hasResolvedDeviceList
          : false,
      deviceListRefreshStatus: read.devices.kind === 'ready' ? 'idle' : 'failed',
    };
    this.publishSnapshot();
  }

  private async readPostOperationSpace(): Promise<PostOperationSpaceRead> {
    try {
      const state = await this.runRefreshStep('querySpaceState', () => this.api.querySpaceState());
      await this.completion.resolveFromCore(
        Boolean(state.hasCompleted && !state.rePairingRequired && state.spaceId)
      );
      if (!state.hasCompleted || state.rePairingRequired || !state.spaceId) {
        return {
          kind: 'empty',
          devices: { kind: 'ready', devices: [] },
          deviceTrustQuery: { kind: 'notApplicable' },
        };
      }
      const [devices, deviceTrustQuery] = await Promise.all([
        this.runRefreshStep('listDevices', () => this.api.listDevices()).then(
          (entries) => ({ kind: 'ready' as const, devices: entries }),
          () => ({ kind: 'failed' as const })
        ),
        this.queryDeviceTrustState(),
      ]);
      return {
        kind: 'ready',
        state: { ...state, spaceId: state.spaceId },
        devices,
        deviceTrustQuery,
      };
    } catch {
      return { kind: 'failed' };
    }
  }

  private beginMutation(): number {
    if (this.activeMutationRevision !== null) {
      throw new SpaceOperationInProgressError();
    }
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

  private publishNoCurrentSpace(): UnifiedSpaceSnapshot {
    const operationState =
      this.snapshot.operationState.kind === 'result'
        ? this.snapshot.operationState
        : ({ kind: 'idle' } as const);
    this.snapshot = {
      ...createInitialUnifiedSpaceSnapshot('empty'),
      operationState,
    };
    this.publishSnapshot();
    return this.snapshot;
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

  private async queryDeviceTrustState(): Promise<DeviceTrustQueryState> {
    try {
      const snapshot = await this.runRefreshStep('queryDeviceTrust', () =>
        this.api.queryDeviceTrust()
      );
      return { kind: 'ready', snapshot };
    } catch (error) {
      return failedDeviceTrustQuery(error);
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
