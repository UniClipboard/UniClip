import { requireNativeModule } from 'expo-modules-core';

const NativeModule = requireNativeModule('UcCore');

// --- Types ---

export interface ServerConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface ClipboardMeta {
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string;
  dataName: string | null;
  hasData: boolean;
  size: number;
  hash: string | null;
}

export interface ConnectPayload {
  v: number;
  url: string;
  urls: string[];
  user: string;
  pwd: string;
  other: Record<string, string>;
}

export interface HistoryQuery {
  page?: number;
  beforeMs?: number;
  afterMs?: number;
  modifiedAfterMs?: number;
  types?: number;
  searchText?: string;
  starred?: boolean;
  sortByLastAccessed?: boolean;
}

export interface HistoryRecord {
  hash: string;
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string | null;
  hasData: boolean;
  size: number | null;
  createTimeMs: number | null;
  lastModifiedMs: number | null;
  lastAccessedMs: number | null;
  starred: boolean;
  pinned: boolean;
  version: number | null;
  isDeleted: boolean;
}

export type ProbeResult = 'Success' | 'AuthFailed' | 'Unreachable' | 'MissingFields';

export interface ProbeReport {
  networkEpoch: number;
  results: Record<string, ProbeResult>;
}

// --- Functions ---

export function parseConnectUri(uri: string): ConnectPayload {
  return NativeModule.parseConnectUri(uri);
}

export async function getLatest(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ClipboardMeta> {
  return NativeModule.getLatest(server, trustInsecureCert);
}

export async function putClipboard(
  server: ServerConfig,
  meta: ClipboardMeta,
  payload?: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putClipboard(server, meta, payload ?? null, trustInsecureCert);
}

export async function testConnection(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ProbeResult> {
  return NativeModule.testConnection(server, trustInsecureCert);
}

export async function queryHistory(
  server: ServerConfig,
  query: HistoryQuery,
  trustInsecureCert = false
): Promise<HistoryRecord[]> {
  return NativeModule.queryHistory(server, query, trustInsecureCert);
}

export async function getFile(
  server: ServerConfig,
  name: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getFile(server, name, trustInsecureCert);
}

export async function putFile(
  server: ServerConfig,
  name: string,
  body: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putFile(server, name, body, trustInsecureCert);
}

export async function getHistoryPayload(
  server: ServerConfig,
  profileId: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getHistoryPayload(server, profileId, trustInsecureCert);
}

export async function probe(
  urls: string[],
  username: string,
  password: string,
  trustInsecureCert = false,
  timeoutMs = 3000,
  networkEpoch = 0
): Promise<ProbeReport> {
  return NativeModule.probe(
    urls,
    username,
    password,
    trustInsecureCert,
    timeoutMs,
    networkEpoch
  );
}

export function cancelInFlight(): void {
  NativeModule.cancelInFlight();
}

// --- Sync Reducer Types ---

export type SyncState =
  | 'Idle'
  | 'Succeeded'
  | 'HasNewUnwritten'
  | 'OfflineRetrying'
  | 'AuthFailed'
  | 'LoopDetected';

export type LoopDirection = 'Pulled' | 'Pushed';

export interface LoopGuardEvent {
  hash: string;
  direction: LoopDirection;
  atMillis: number;
}

export interface SyncRuntimeState {
  state: SyncState;
  lastSyncedHash: string | null;
  lastAppliedHash: string | null;
  loopEvents: LoopGuardEvent[];
  stagedServerHash: string | null;
  stagedEntry: ClipboardMeta | null;
  consecutiveFailures: number;
  nextAttemptMs: number | null;
  lastHistorySyncMs: number | null;
}

export interface SyncConfig {
  normalCadenceSecs: number;
  inactiveCadenceSecs: number;
  offlineBackoffSecs: number;
  offlineBackoffMaxSecs: number;
  historySyncIntervalSecs: number;
  loopWindowSecs: number;
  loopFlipThreshold: number;
}

export interface PreambleSnapshot {
  explicit: boolean;
  autoPush: boolean;
  hasActiveServer: boolean;
  deviceHash: string | null;
  historyHeadHash: string | null;
  persistedSyncedHash: string | null;
  nowMs: number;
}

export type StopReason = 'NoActiveServer' | 'Paused' | 'BackoffGated';

export type PreambleProceed =
  | { type: 'Stop'; reason: StopReason }
  | { type: 'ToNetwork' };

export interface Preamble {
  recordLocal: boolean;
  proceed: PreambleProceed;
}

export interface PreambleStep {
  state: SyncRuntimeState;
  preamble: Preamble;
}

export interface ServerGetSnapshot {
  autoApply: boolean;
  autoPush: boolean;
  serverEntry: ClipboardMeta | null;
  devicePresent: boolean;
  deviceHash: string | null;
}

export interface ServerNewPlan {
  willApply: boolean;
  alreadyStaged: boolean;
}

export type PushDecision =
  | 'SkipConsentMode'
  | 'SkipNoDevice'
  | 'SkipAlreadySynced'
  | 'SkipSelfWritten'
  | 'DoPush';

export type ServerRoute =
  | { type: 'Converged'; serverHash: string }
  | { type: 'ServerNew'; plan: ServerNewPlan }
  | { type: 'Push'; decision: PushDecision };

export interface CommitOutcome {
  tripped: boolean;
}

export interface CommitStep {
  state: SyncRuntimeState;
  outcome: CommitOutcome;
}

export type TickErrorKind =
  | 'AuthFailed'
  | 'Cancelled'
  | 'NetworkUnreachable'
  | 'ConnectTimeout'
  | 'ReceiveTimeout'
  | 'OtherSyncError'
  | 'Unexpected';

export interface TickFailureOutcome {
  kickProbe: boolean;
  firstOffline: boolean;
}

export interface TickFailureStep {
  state: SyncRuntimeState;
  outcome: TickFailureOutcome;
}

export interface MarkStagedStep {
  state: SyncRuntimeState;
  wasStaged: boolean;
}

// --- Sync Reducer Functions ---

const FALLBACK_SYNC_CONFIG: SyncConfig = {
  normalCadenceSecs: 1.0,
  inactiveCadenceSecs: 5.0,
  offlineBackoffSecs: 5.0,
  offlineBackoffMaxSecs: 60.0,
  historySyncIntervalSecs: 30.0,
  loopWindowSecs: 30.0,
  loopFlipThreshold: 3,
};

const FALLBACK_RUNTIME_STATE: SyncRuntimeState = {
  state: 'Idle',
  lastSyncedHash: null,
  lastAppliedHash: null,
  loopEvents: [],
  stagedServerHash: null,
  stagedEntry: null,
  consecutiveFailures: 0,
  nextAttemptMs: null,
  lastHistorySyncMs: null,
};

function hasReducer(): boolean {
  return typeof NativeModule.planPreamble === 'function';
}

export function defaultSyncConfig(): SyncConfig {
  if (!hasReducer()) return { ...FALLBACK_SYNC_CONFIG };
  return NativeModule.defaultSyncConfig();
}

export function defaultSyncRuntimeState(): SyncRuntimeState {
  if (!hasReducer()) return { ...FALLBACK_RUNTIME_STATE };
  return NativeModule.defaultSyncRuntimeState();
}

export function planPreamble(
  state: SyncRuntimeState,
  snap: PreambleSnapshot
): PreambleStep {
  if (!hasReducer()) return tsFallback.planPreamble(state, snap);
  return NativeModule.planPreamble(state, snap);
}

export function planAfterServerGet(
  state: SyncRuntimeState,
  snap: ServerGetSnapshot
): ServerRoute {
  if (!hasReducer()) return tsFallback.planAfterServerGet(state, snap);
  return NativeModule.planAfterServerGet(state, snap);
}

export function commitConverged(
  state: SyncRuntimeState,
  serverHash: string
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, lastSyncedHash: serverHash };
  return NativeModule.commitConverged(state, serverHash);
}

export function commitApply(
  state: SyncRuntimeState,
  hash: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  if (!hasReducer()) return { state: { ...state, lastSyncedHash: hash, lastAppliedHash: hash }, outcome: { tripped: false } };
  return NativeModule.commitApply(state, hash, nowMs, cfg);
}

export function commitApplyFailed(
  state: SyncRuntimeState,
  entry: ClipboardMeta
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, stagedServerHash: entry.hash };
  return NativeModule.commitApplyFailed(state, entry);
}

export function commitStage(
  state: SyncRuntimeState,
  entry: ClipboardMeta
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, stagedServerHash: entry.hash };
  return NativeModule.commitStage(state, entry);
}

export function commitPush(
  state: SyncRuntimeState,
  pushedHash: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  if (!hasReducer()) return { state: { ...state, lastSyncedHash: pushedHash }, outcome: { tripped: false } };
  return NativeModule.commitPush(state, pushedHash, nowMs, cfg);
}

export function commitPushSkipped(state: SyncRuntimeState): SyncRuntimeState {
  if (!hasReducer()) return state;
  return NativeModule.commitPushSkipped(state);
}

export function commitConsentPush(
  state: SyncRuntimeState,
  pushedHash: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  if (!hasReducer()) return { state: { ...state, lastSyncedHash: pushedHash, lastAppliedHash: pushedHash }, outcome: { tripped: false } };
  return NativeModule.commitConsentPush(state, pushedHash, nowMs, cfg);
}

export function commitTickSuccess(state: SyncRuntimeState): SyncRuntimeState {
  if (!hasReducer()) return { ...state, consecutiveFailures: 0 };
  return NativeModule.commitTickSuccess(state);
}

export function commitTickFailure(
  state: SyncRuntimeState,
  kind: TickErrorKind,
  jitter: number,
  nowMs: number,
  cfg: SyncConfig
): TickFailureStep {
  if (!hasReducer()) {
    const failures = state.consecutiveFailures + 1;
    return {
      state: { ...state, consecutiveFailures: failures },
      outcome: { kickProbe: kind === 'NetworkUnreachable' || kind === 'ConnectTimeout', firstOffline: failures === 1 },
    };
  }
  return NativeModule.commitTickFailure(state, kind, jitter, nowMs, cfg);
}

export function commitHistorySyncDone(
  state: SyncRuntimeState,
  nowMs: number
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, lastHistorySyncMs: nowMs };
  return NativeModule.commitHistorySyncDone(state, nowMs);
}

export function markStagedApplied(state: SyncRuntimeState): MarkStagedStep {
  if (!hasReducer()) {
    const wasStaged = state.stagedServerHash !== null;
    return { state: { ...state, lastSyncedHash: state.stagedServerHash, stagedServerHash: null }, wasStaged };
  }
  return NativeModule.markStagedApplied(state);
}

export function acknowledgeLoopDetection(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, state: 'Idle', loopEvents: [] };
  return NativeModule.acknowledgeLoopDetection(state);
}

export function resetRuntimeState(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...FALLBACK_RUNTIME_STATE };
  return NativeModule.resetRuntimeState(state);
}

export function handleActiveServerChanged(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...FALLBACK_RUNTIME_STATE };
  return NativeModule.handleActiveServerChanged(state);
}

export function handleNetworkRouteChanged(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, consecutiveFailures: 0, nextAttemptMs: null };
  return NativeModule.handleNetworkRouteChanged(state);
}

// --- Sync Helper Functions ---

export function hashesEqual(a: string | null, b: string | null): boolean {
  if (!hasReducer()) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.toUpperCase() === b.toUpperCase();
  }
  return NativeModule.hashesEqual(a ?? null, b ?? null);
}

export function backoffSecs(
  consecutiveFailures: number,
  base: number,
  max: number,
  jitter: number
): number {
  if (!hasReducer()) {
    const exp = Math.min(consecutiveFailures - 1, 6);
    return Math.min(base * Math.pow(2, Math.max(0, exp)), max) * jitter;
  }
  return NativeModule.backoffSecs(consecutiveFailures, base, max, jitter);
}

export function cadenceSecs(
  state: SyncState,
  isSceneInactive: boolean,
  cfg: SyncConfig
): number {
  if (!hasReducer()) {
    if (state === 'AuthFailed' || state === 'LoopDetected') return Infinity;
    return isSceneInactive ? cfg.inactiveCadenceSecs : cfg.normalCadenceSecs;
  }
  return NativeModule.cadenceSecs(state, isSceneInactive, cfg);
}

export function isHistorySyncDue(
  lastSyncMs: number | null,
  nowMs: number,
  intervalSecs: number
): boolean {
  if (!hasReducer()) {
    if (lastSyncMs == null) return true;
    return (nowMs - lastSyncMs) >= intervalSecs * 1000;
  }
  return NativeModule.isHistorySyncDue(lastSyncMs ?? null, nowMs, intervalSecs);
}

export function isColdStart(watermarkMs: number | null): boolean {
  if (!hasReducer()) return watermarkMs == null;
  return NativeModule.isColdStart(watermarkMs ?? null);
}

export function advanceWatermark(
  currentMs: number | null,
  maxLastModifiedMs: number
): number | null {
  if (!hasReducer()) {
    if (currentMs == null || maxLastModifiedMs > currentMs) return maxLastModifiedMs;
    return null;
  }
  return NativeModule.advanceWatermark(currentMs ?? null, maxLastModifiedMs);
}

export function isProbeConclusionValid(
  reportEpoch: number,
  currentEpoch: number
): boolean {
  if (!hasReducer()) return reportEpoch === currentEpoch;
  return NativeModule.isProbeConclusionValid(reportEpoch, currentEpoch);
}

// --- TypeScript fallback implementations (used when Rust FFI unavailable) ---

const tsFallback = {
  planPreamble(state: SyncRuntimeState, snap: PreambleSnapshot): PreambleStep {
    if (!snap.hasActiveServer) {
      return { state, preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'NoActiveServer' } } };
    }
    if (state.state === 'AuthFailed' || state.state === 'LoopDetected') {
      return { state, preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'Paused' } } };
    }
    if (!snap.explicit && state.nextAttemptMs !== null && snap.nowMs < state.nextAttemptMs) {
      return { state, preamble: { recordLocal: false, proceed: { type: 'Stop', reason: 'BackoffGated' } } };
    }
    // Cross-process hash resync
    let newState = state;
    if (snap.persistedSyncedHash && snap.persistedSyncedHash !== state.lastSyncedHash) {
      newState = { ...newState, lastSyncedHash: snap.persistedSyncedHash };
    }
    return { state: newState, preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } } };
  },

  planAfterServerGet(state: SyncRuntimeState, snap: ServerGetSnapshot): ServerRoute {
    const serverHash = snap.serverEntry?.hash ?? null;
    const synced = state.lastSyncedHash;

    if (serverHash && synced && serverHash.toUpperCase() === synced.toUpperCase()) {
      return { type: 'Converged', serverHash };
    }

    if (snap.serverEntry && serverHash && (!synced || serverHash.toUpperCase() !== synced.toUpperCase())) {
      const alreadyStaged = state.stagedServerHash !== null && state.stagedServerHash.toUpperCase() === serverHash.toUpperCase();
      const willApply = snap.autoApply && !alreadyStaged;
      return { type: 'ServerNew', plan: { willApply, alreadyStaged } };
    }

    if (!snap.autoPush) {
      return { type: 'Push', decision: 'SkipConsentMode' };
    }
    if (!snap.devicePresent) {
      return { type: 'Push', decision: 'SkipNoDevice' };
    }
    const dh = snap.deviceHash?.toUpperCase() ?? null;
    if (dh && synced && dh === synced.toUpperCase()) {
      return { type: 'Push', decision: 'SkipAlreadySynced' };
    }
    if (dh && state.lastAppliedHash && dh === state.lastAppliedHash.toUpperCase()) {
      return { type: 'Push', decision: 'SkipSelfWritten' };
    }
    return { type: 'Push', decision: 'DoPush' };
  },
};
