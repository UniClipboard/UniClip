import { requireNativeModule } from 'expo-modules-core';

export interface EngineConfig {
  appVersion: string;
  profileId: string;
}

export type EngineState =
  | 'running'
  | 'quiescing'
  | 'quiesced'
  | 'suspended'
  | 'shuttingDown'
  | 'stopped';

export interface SpaceCreated {
  spaceId: string;
  selfDeviceId: string;
  identityFingerprint: string;
}

export interface InvitationIssued {
  invitationCode: string;
  expiresAtMs: number;
  availability: 'crossNetwork' | 'sameLocalNetwork';
}

export interface SpaceJoined {
  sponsorDeviceId: string;
  sponsorIdentityFingerprint: string;
  spaceId: string;
  selfDeviceId: string;
  selfIdentityFingerprint: string;
  migratedRecords: number;
}

export interface SendReport {
  entryId: string;
  atMs: number;
  totalAccepted: number;
  totalDuplicate: number;
  totalOffline: number;
  totalErrored: number;
  totalPending: number;
}

export interface PeerConnectionRefresh {
  total: number;
  online: number;
  offline: number;
  errors: number;
}

export interface SpaceInvitation {
  invitationCode: string;
  expiresAtMs: number;
}

export interface SpaceState {
  hasCompleted: boolean;
  spaceId: string | null;
  currentInvitation: SpaceInvitation | null;
  deviceName: string | null;
}

export interface Device {
  deviceId: string;
  displayName: string;
  online: boolean;
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
  | { kind: 'entryNotResendable'; entryId: string; reason: 'remoteOrigin' | 'payloadLost' }
  | { kind: 'targetNotTrusted'; deviceId: string }
  | { kind: 'noEligibleTargets' };

export type EngineEvent =
  | { type: 'stateChanged'; state: EngineState }
  | {
      type: 'operationFinished';
      operationId: string;
      terminal: string;
      failure: { code: number; category: string; retryable: boolean } | null;
    }
  | {
      type: 'lifecycleFailed';
      action: 'suspend' | 'resume';
      failure: { code: number; category: string; retryable: boolean };
    }
  | { type: 'refreshRequired'; reason: string }
  | { type: 'fatal'; failure: { code: number; category: string; retryable: boolean } }
  | {
      type: 'incomingEntry';
      entryId: string;
      attemptId: string | null;
      preview: string;
      origin: 'local' | 'remote';
    }
  | {
      type: 'incomingPending';
      entryId: string;
      attemptId: string | null;
      fromDevice: string;
      totalBytes: number | null;
      filenames: string[];
    }
  | {
      type: 'receiveAttemptStateChanged';
      entryId: string;
      attemptId: string;
      state: string;
    }
  | { type: 'deliveryStatusChanged'; entryId: string; targetDeviceId: string }
  | { type: 'peerPresenceChanged'; deviceId: string; state: string; atMs: number }
  | {
      type: 'transferProgress';
      transferId: string;
      entryId: string | null;
      attemptId: string | null;
      peerId: string;
      direction: 'sending' | 'receiving';
      completedBytes: number;
      totalBytes: number | null;
    }
  | {
      type: 'transferStatusChanged';
      transferId: string;
      entryId: string;
      attemptId: string | null;
      status: string;
      reason: string | null;
    }
  | {
      type: 'activeClipboardChanged';
      snapshotHash: string;
      entryId: string;
      activatedAtMs: number;
      activatedBy: string;
    }
  | { type: 'changed'; kind: string };

export type ClipboardRestoreMode = 'standard' | 'plainText' | 'filePaths';
export type ClipboardRestoreOutcome = 'restored' | 'payloadUnavailable' | 'notApplicable';

interface UcEngineNativeModule {
  coreVersion(): string;
  start(config: EngineConfig): Promise<void>;
  shutdown(deadlineMs: number): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  createSpace(deviceName: string | null, passphrase: string): Promise<SpaceCreated>;
  issueInvitation(): Promise<InvitationIssued>;
  joinSpace(
    invitationCode: string,
    deviceName: string | null,
    passphrase: string
  ): Promise<SpaceJoined>;
  nextEvent(timeoutMs: number): Promise<EngineEvent | null>;
  refreshPeerConnections(): Promise<PeerConnectionRefresh>;
  querySpaceState(): Promise<SpaceState>;
  listDevices(): Promise<Device[]>;
  removeMember(deviceId: string): Promise<void>;
  resendEntry(entryId: string, targetDevices: string[]): Promise<ResendEntryOutcome>;
  leaveSpace(): Promise<void>;
  sendText(text: string, targetDevices: string[]): Promise<SendReport>;
  sendImage(bytes: Uint8Array, mimeType: string, targetDevices: string[]): Promise<SendReport>;
  registerInputFile(uri: string): string;
  registerOutputFile(uri: string): string;
  releaseFileHandle(handle: string): void;
  sendFiles(fileHandles: string[], targetDevices: string[]): Promise<SendReport>;
  captureCurrentClipboard(): Promise<string | null>;
  observeClipboardChange(dispatch: boolean): Promise<SendReport | null>;
  restoreClipboard(entryId: string, mode: ClipboardRestoreMode): Promise<ClipboardRestoreOutcome>;
  exportEntry(entryId: string, destinationHandle: string): Promise<void>;
}

const NativeModule = requireNativeModule<UcEngineNativeModule>('UcEngine');

export function coreVersion(): string {
  return NativeModule.coreVersion();
}

export function start(config: EngineConfig): Promise<void> {
  return NativeModule.start(config);
}

export function shutdown(deadlineMs = 5_000): Promise<void> {
  return NativeModule.shutdown(deadlineMs);
}

export function suspend(): Promise<void> {
  return NativeModule.suspend();
}

export function resume(): Promise<void> {
  return NativeModule.resume();
}

export function createSpace(deviceName: string | null, passphrase: string): Promise<SpaceCreated> {
  return NativeModule.createSpace(deviceName, passphrase);
}

export function issueInvitation(): Promise<InvitationIssued> {
  return NativeModule.issueInvitation();
}

export function joinSpace(
  invitationCode: string,
  deviceName: string | null,
  passphrase: string
): Promise<SpaceJoined> {
  return NativeModule.joinSpace(invitationCode, deviceName, passphrase);
}

export function nextEvent(timeoutMs = 1_000): Promise<EngineEvent | null> {
  return NativeModule.nextEvent(timeoutMs);
}

export function refreshPeerConnections(): Promise<PeerConnectionRefresh> {
  return NativeModule.refreshPeerConnections();
}

export function querySpaceState(): Promise<SpaceState> {
  return NativeModule.querySpaceState();
}

export function listDevices(): Promise<Device[]> {
  return NativeModule.listDevices();
}

export function removeMember(deviceId: string): Promise<void> {
  return NativeModule.removeMember(deviceId);
}

export function resendEntry(
  entryId: string,
  targetDevices: string[] = []
): Promise<ResendEntryOutcome> {
  return NativeModule.resendEntry(entryId, targetDevices);
}

export function leaveSpace(): Promise<void> {
  return NativeModule.leaveSpace();
}

export function sendText(text: string, targetDevices: string[] = []): Promise<SendReport> {
  return NativeModule.sendText(text, targetDevices);
}

export function sendImage(
  bytes: Uint8Array,
  mimeType: string,
  targetDevices: string[] = []
): Promise<SendReport> {
  return NativeModule.sendImage(bytes, mimeType, targetDevices);
}

export function registerInputFile(uri: string): string {
  return NativeModule.registerInputFile(uri);
}

export function registerOutputFile(uri: string): string {
  return NativeModule.registerOutputFile(uri);
}

export function releaseFileHandle(handle: string): void {
  NativeModule.releaseFileHandle(handle);
}

export function sendFiles(
  fileHandles: string[],
  targetDevices: string[] = []
): Promise<SendReport> {
  return NativeModule.sendFiles(fileHandles, targetDevices);
}

export function captureCurrentClipboard(): Promise<string | null> {
  return NativeModule.captureCurrentClipboard();
}

export function observeClipboardChange(dispatch: boolean): Promise<SendReport | null> {
  return NativeModule.observeClipboardChange(dispatch);
}

export function restoreClipboard(
  entryId: string,
  mode: ClipboardRestoreMode = 'standard'
): Promise<ClipboardRestoreOutcome> {
  return NativeModule.restoreClipboard(entryId, mode);
}

export function exportEntry(entryId: string, destinationHandle: string): Promise<void> {
  return NativeModule.exportEntry(entryId, destinationHandle);
}
