import { requireOptionalNativeModule } from 'expo-modules-core';

interface AppGroupStoreNativeModule {
  saveSettings(json: string): Promise<void>;
  getSettings(): Promise<string>;
  getContainerUrl(): Promise<string | null>;
  getLegacyHistory(): Promise<string | null>;
  getShareDiagnostics(): Promise<string | null>;
  getPayloadFileUri(profileId: string): Promise<string | null>;
  writePayload(profileId: string, bytes: Uint8Array): Promise<string | null>;
  deletePayload(profileId: string): Promise<void>;
  clearPayloads(): Promise<void>;
  getPayloadStats(): Promise<PayloadStats>;
  migrateLegacyContainer(): Promise<LegacyMigrationResult>;
  clearLegacyLanConfiguration(): Promise<void>;
  getKeyboardStatus(): Promise<NativeKeyboardStatus>;
  getPasteboardChangeCount(): number;
  claimOutboundShareJobs(): Promise<OutboundShareJobDTO[]>;
  completeOutboundShareJob(id: string): Promise<void>;
  releaseOutboundShareJob(id: string): Promise<void>;
  importPayloadFile(profileId: string, sourceUri: string): Promise<string | null>;
}

interface NativeKeyboardStatus {
  enabledInSystem?: boolean;
  everUsed: boolean;
  lastKnownFullAccess: boolean;
}

const NativeModule = requireOptionalNativeModule<AppGroupStoreNativeModule>('AppGroupStore');

export interface AppSettingsDTO {
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

export interface LegacyMigrationResult {
  migrated: boolean;
  keys: number;
}

export interface KeyboardStatusDTO {
  /**
   * Whether the keyboard extension appears in the system keyboard list right
   * now. `null` when the OS does not expose the list (fall back to
   * {@link KeyboardStatusDTO.everUsed}).
   */
  enabledInSystem: boolean | null;
  /** The keyboard extension has appeared on screen at least once. */
  everUsed: boolean;
  /**
   * Full Access as of the keyboard's last appearance — a heartbeat, not a live
   * read; stale until the user opens the keyboard again.
   */
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

export async function getSettings(): Promise<AppSettingsDTO> {
  const json = await NativeModule?.getSettings();
  return parseNativeJson(json, {});
}

/**
 * iOS UIPasteboard.changeCount — increments on every clipboard change and is
 * free to read (never triggers the system paste permission prompt). Returns
 * `null` when the native module is unavailable (Android / Expo Go).
 */
export function getPasteboardChangeCount(): number | null {
  return NativeModule?.getPasteboardChangeCount() ?? null;
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

export function claimOutboundShareJobs(): Promise<OutboundShareJobDTO[]> {
  if (typeof NativeModule?.claimOutboundShareJobs !== 'function') return Promise.resolve([]);
  return NativeModule.claimOutboundShareJobs();
}

export function completeOutboundShareJob(id: string): Promise<void> {
  if (typeof NativeModule?.completeOutboundShareJob !== 'function') return Promise.resolve();
  return NativeModule.completeOutboundShareJob(id);
}

export function releaseOutboundShareJob(id: string): Promise<void> {
  if (typeof NativeModule?.releaseOutboundShareJob !== 'function') return Promise.resolve();
  return NativeModule.releaseOutboundShareJob(id);
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
  everUsed: false,
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
    everUsed: status.everUsed ?? false,
    lastKnownFullAccess: status.lastKnownFullAccess ?? false,
  };
}
