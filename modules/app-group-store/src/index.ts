import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppGroupStoreNativeModule {
  saveSettings(json: string): Promise<void>;
  getSettings(): Promise<string>;
  getLegacyLanConfiguration?(): Promise<string | null>;
  getContainerUrl(): Promise<string | null>;
  getLegacyHistory(): Promise<string | null>;
  getShareDiagnostics(): Promise<string | null>;
  getEngineLogFileUris(): string[];
  getPayloadFileUri(profileId: string): Promise<string | null>;
  writePayload(profileId: string, bytes: Uint8Array): Promise<string | null>;
  deletePayload(profileId: string): Promise<void>;
  clearPayloads(): Promise<void>;
  getPayloadStats(): Promise<PayloadStats>;
  migrateLegacyContainer(): Promise<LegacyMigrationResult>;
  clearLegacyLanConfiguration(): Promise<void>;
  getKeyboardStatus(): Promise<NativeKeyboardStatus>;
  getPasteboardChangeCount(): number;
  setPasteboardImageFromFile(fileUri: string): Promise<void>;
  claimOutboundShareJobs(): Promise<OutboundShareJobDTO[]>;
  completeOutboundShareJob(id: string): Promise<void>;
  releaseOutboundShareJob(id: string): Promise<void>;
  recordShareDiagnosticStage?(
    attemptId: string,
    stage: string,
    errorCode: string | null
  ): Promise<void>;
  importPayloadFile(profileId: string, sourceUri: string): Promise<string | null>;
  getLanServerPassword(serverId: string): Promise<string | null>;
  setLanServerPassword(serverId: string, password: string): Promise<void>;
  deleteLanServerPassword(serverId: string): Promise<void>;
}

interface NativeKeyboardStatus {
  enabledInSystem?: boolean;
  lastKnownFullAccess: boolean;
  lastHeartbeatAtMs?: number;
}

const NativeModule = requireOptionalNativeModule<AppGroupStoreNativeModule>('AppGroupStore');

export interface AppSettingsDTO {
  syncChannel?: 'lan' | 'p2p';
  lanServers?: LanServerProfileDTO[];
  autoApplyRemoteChanges?: boolean;
  /** Accepted while importing settings written by older app versions. */
  autoApplyServerChanges?: boolean;
  autoPushDeviceChanges?: boolean;
  prefetchAttachments?: boolean;
  prefetchOnCellular?: boolean;
  payloadCacheMaxBytes?: number;
  appearance?: 'system' | 'light' | 'dark';
  language?: string;
  autoCheckUpdate?: boolean;
  ignoredVersion?: string | null;
  downloadRelativePath?: string;
  logViewLevelFilter?: string;
  keyboardSoundFeedback?: boolean;
  keyboardHapticFeedback?: boolean;
}

export interface LanServerProfileDTO {
  id: string;
  name: string;
  urls: string[];
  username: string;
  allowInsecureTls: boolean;
}

export interface LegacyMigrationResult {
  migrated: boolean;
  keys: number;
}

export interface LegacyLanServerDTO {
  id?: string;
  name?: string;
  url?: string;
  urls?: string[];
  username?: string;
  password?: string;
}

export interface LegacyLanConfigurationDTO {
  servers: LegacyLanServerDTO[];
  activeServerIndex: number;
  trustInsecureCert: boolean;
}

export interface KeyboardStatusDTO {
  /**
   * Whether the keyboard extension appears in the system keyboard list right
   * now. `null` when the OS does not expose the list.
   */
  enabledInSystem: boolean | null;
  /**
   * When the keyboard last appeared and reached the App Group, in epoch ms;
   * `null` if it never has. iOS denies a keyboard without Full Access write
   * access to the App Group, so a heartbeat only lands with Full Access on and
   * an "off" never lands: this is evidence of Full Access at that moment only,
   * never of its current state.
   */
  lastHeartbeatAtMs: number | null;
  /** Full Access as reported by that heartbeat; meaningless without one. */
  lastKnownFullAccess: boolean;
}

export interface PayloadStats {
  count: number;
  totalSize: number;
}

export interface ShareDiagnosticNetworkDTO {
  wifi: boolean;
  cellular: boolean;
  tailscale: boolean;
}

export interface ShareDiagnosticRouteDTO {
  candidateCount: number;
  hadRememberedLiveRoute: boolean;
}

export interface ShareDiagnosticPeerRefreshDTO {
  total: number;
  online: number;
  offline: number;
  errors: number;
}

export interface ShareDiagnosticDeliveryDTO {
  accepted: number;
  duplicate: number;
  offline: number;
  errored: number;
  pending: number;
}

export interface ShareDiagnosticErrorDTO {
  code: string;
  engineCode?: number;
  engineCategory?: string;
  retryable?: boolean;
}

export interface ShareDiagnosticEventDTO {
  timestampMs: number;
  elapsedMs: number;
  stage: string;
  network?: ShareDiagnosticNetworkDTO;
  route?: ShareDiagnosticRouteDTO;
  peerRefresh?: ShareDiagnosticPeerRefreshDTO;
  delivery?: ShareDiagnosticDeliveryDTO;
  error?: ShareDiagnosticErrorDTO;
}

export interface ShareDiagnosticAttemptDTO {
  id: string;
  startedAtMs: number;
  itemKind: 'text' | 'image' | 'file';
  byteCount: number;
  events: ShareDiagnosticEventDTO[];
}

export interface ShareDiagnosticsArchiveDTO {
  schemaVersion: 1;
  attempts: ShareDiagnosticAttemptDTO[];
}

export interface OutboundShareJobDTO {
  id: string;
  /**
   * Content kind carried by the payload file. Records written by older app
   * versions carry no key and decode as `'file'` (kept claimable).
   */
  kind: 'text' | 'image' | 'file';
  fileUri: string;
  displayName: string;
  byteCount: number;
  mimeType: string | null;
  targetDeviceIds: string[];
  createdAtMs: number;
}

const EMPTY_MIGRATION: LegacyMigrationResult = { migrated: false, keys: 0 };
const EMPTY_PAYLOAD_STATS: PayloadStats = { count: 0, totalSize: 0 };

function parseNativeJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: AppSettingsDTO): Promise<void> {
  return NativeModule?.saveSettings(JSON.stringify(settings)) ?? Promise.resolve();
}

export function getLanServerPassword(serverId: string): Promise<string | null> {
  return NativeModule?.getLanServerPassword(serverId) ?? Promise.resolve(null);
}

export function setLanServerPassword(serverId: string, password: string): Promise<void> {
  return NativeModule?.setLanServerPassword(serverId, password) ?? Promise.resolve();
}

export function deleteLanServerPassword(serverId: string): Promise<void> {
  return NativeModule?.deleteLanServerPassword(serverId) ?? Promise.resolve();
}

export async function getSettings(): Promise<AppSettingsDTO> {
  const json = await NativeModule?.getSettings();
  return parseNativeJson(json, {});
}

export async function getLegacyLanConfiguration(): Promise<LegacyLanConfigurationDTO | null> {
  if (typeof NativeModule?.getLegacyLanConfiguration !== 'function') return null;
  const json = await NativeModule.getLegacyLanConfiguration();
  return parseNativeJson<LegacyLanConfigurationDTO | null>(json ?? undefined, null);
}

/**
 * iOS UIPasteboard.changeCount — increments on every clipboard change and is
 * free to read (never triggers the system paste permission prompt). Returns
 * `null` when the native module is unavailable (Android / Expo Go).
 */
export function getPasteboardChangeCount(): number | null {
  return NativeModule?.getPasteboardChangeCount() ?? null;
}

export function setPasteboardImageFromFile(fileUri: string): Promise<void> {
  if (typeof NativeModule?.setPasteboardImageFromFile !== 'function') {
    return Promise.reject(new Error('Native image clipboard writing is unavailable'));
  }
  return NativeModule.setPasteboardImageFromFile(fileUri);
}

export function getContainerUrl(): Promise<string | null> {
  return NativeModule?.getContainerUrl() ?? Promise.resolve(null);
}

export function getLegacyHistory(): Promise<string | null> {
  return NativeModule?.getLegacyHistory() ?? Promise.resolve(null);
}

export async function getShareDiagnostics(): Promise<ShareDiagnosticsArchiveDTO | null> {
  if (typeof NativeModule?.getShareDiagnostics !== 'function') return null;
  const json = await NativeModule.getShareDiagnostics();
  return parseNativeJson<ShareDiagnosticsArchiveDTO | null>(json ?? undefined, null);
}

/**
 * Absolute paths of the engine trace files in the shared P2P cache
 * (`p2p/cache/logs/engine.*.txt`). Empty when the native module is
 * unavailable (Android / Expo Go) — Android hosts the engine logs under the
 * app cache directory instead.
 */
export function getEngineLogFileUris(): string[] {
  if (typeof NativeModule?.getEngineLogFileUris !== 'function') return [];
  return NativeModule.getEngineLogFileUris();
}

export function getPayloadFileUri(profileId: string): Promise<string | null> {
  return NativeModule?.getPayloadFileUri(profileId) ?? Promise.resolve(null);
}

export function writePayload(profileId: string, bytes: Uint8Array): Promise<string | null> {
  return NativeModule?.writePayload(profileId, bytes) ?? Promise.resolve(null);
}

export function deletePayload(profileId: string): Promise<void> {
  return NativeModule?.deletePayload(profileId) ?? Promise.resolve();
}

export function clearPayloads(): Promise<void> {
  return NativeModule?.clearPayloads() ?? Promise.resolve();
}

export function getPayloadStats(): Promise<PayloadStats> {
  return NativeModule?.getPayloadStats() ?? Promise.resolve(EMPTY_PAYLOAD_STATS);
}

export async function claimOutboundShareJobs(): Promise<OutboundShareJobDTO[]> {
  if (typeof NativeModule?.claimOutboundShareJobs !== 'function') return [];
  const jobs = await NativeModule.claimOutboundShareJobs();
  // 旧版扩展入队的 job 无 kind 字段:按 §3.1 兼容契约默认 'file'。
  return jobs.map((job) => ({ ...job, kind: job.kind ?? ('file' as const) }));
}

export function completeOutboundShareJob(id: string): Promise<void> {
  if (typeof NativeModule?.completeOutboundShareJob !== 'function') return Promise.resolve();
  return NativeModule.completeOutboundShareJob(id);
}

export function releaseOutboundShareJob(id: string): Promise<void> {
  if (typeof NativeModule?.releaseOutboundShareJob !== 'function') return Promise.resolve();
  return NativeModule.releaseOutboundShareJob(id);
}

/**
 * Appends one diagnostic event to an existing share attempt (started by the
 * share extension with the same attempt id as the job id). No-op when the
 * native module is unavailable or the attempt id is unknown.
 */
export function recordShareDiagnosticStage(
  attemptId: string,
  stage: string,
  errorCode?: string
): Promise<void> {
  if (typeof NativeModule?.recordShareDiagnosticStage !== 'function') return Promise.resolve();
  return NativeModule.recordShareDiagnosticStage(attemptId, stage, errorCode ?? null);
}

export function importPayloadFile(profileId: string, sourceUri: string): Promise<string | null> {
  if (typeof NativeModule?.importPayloadFile !== 'function') return Promise.resolve(null);
  return NativeModule.importPayloadFile(profileId, sourceUri);
}

export function migrateLegacyContainer(): Promise<LegacyMigrationResult> {
  return NativeModule?.migrateLegacyContainer() ?? Promise.resolve(EMPTY_MIGRATION);
}

export function clearLegacyLanConfiguration(): Promise<void> {
  if (typeof NativeModule?.clearLegacyLanConfiguration !== 'function') return Promise.resolve();
  return NativeModule.clearLegacyLanConfiguration();
}

const EMPTY_KEYBOARD_STATUS: KeyboardStatusDTO = {
  enabledInSystem: null,
  lastHeartbeatAtMs: null,
  lastKnownFullAccess: false,
};

export async function getKeyboardStatus(): Promise<KeyboardStatusDTO> {
  // typeof guard: dev clients built before this function shipped expose the
  // module without it, and a plain optional call would throw.
  if (typeof NativeModule?.getKeyboardStatus !== 'function') return EMPTY_KEYBOARD_STATUS;
  const status = await NativeModule.getKeyboardStatus();
  if (!status) return EMPTY_KEYBOARD_STATUS;
  return {
    enabledInSystem: status.enabledInSystem ?? null,
    // Heartbeats written before the timestamp existed carry no time and may
    // predate a Full Access that has since been turned off: ignore them.
    lastHeartbeatAtMs: status.lastHeartbeatAtMs ?? null,
    lastKnownFullAccess: status.lastKnownFullAccess ?? false,
  };
}
