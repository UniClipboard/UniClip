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
  sendText(text: string, targetDevices: string[]): Promise<SendReport>;
  sendImage(bytes: Uint8Array, mimeType: string, targetDevices: string[]): Promise<SendReport>;
  registerInputFile(uri: string): string;
  registerOutputFile(uri: string): string;
  releaseFileHandle(handle: string): void;
  sendFiles(fileHandles: string[], targetDevices: string[]): Promise<SendReport>;
  captureCurrentClipboard(): Promise<string | null>;
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

export function restoreClipboard(
  entryId: string,
  mode: ClipboardRestoreMode = 'standard'
): Promise<ClipboardRestoreOutcome> {
  return NativeModule.restoreClipboard(entryId, mode);
}

export function exportEntry(entryId: string, destinationHandle: string): Promise<void> {
  return NativeModule.exportEntry(entryId, destinationHandle);
}
