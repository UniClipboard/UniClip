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
  /**
   * 服务端分配的跨重编码稳定身份（`blake3v1:<hex>`）。GET 响应有；上传 / legacy
   * 服务端为 null。不透明整体——verbatim 透传，不解析 / 不规范化 / 不大小写折叠。
   */
  contentId: string | null;
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
  payload?: ArrayBuffer | Uint8Array,
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
  /** 与 lastSyncedHash 并列的稳定身份水位线，原子同写同清。 */
  lastSyncedContentId: string | null;
  lastAppliedHash: string | null;
  loopEvents: LoopGuardEvent[];
  stagedServerHash: string | null;
  stagedContentId: string | null;
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
  /**
   * 跨进程 resync 用：从持久化存储读出的 lastSyncedContentId。Share Extension /
   * 后台 push 路径不知道 contentId，必须写 null（不要沿用旧值）。
   */
  persistedSyncedContentId: string | null;
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
  lastSyncedContentId: null,
  lastAppliedHash: null,
  loopEvents: [],
  stagedServerHash: null,
  stagedContentId: null,
  stagedEntry: null,
  consecutiveFailures: 0,
  nextAttemptMs: null,
  lastHistorySyncMs: null,
};

function hasReducer(): boolean {
  return typeof NativeModule.planPreamble === 'function';
}

/**
 * 过 FFI 边界前深度剔除对象里的 null/undefined 字段。
 *
 * Expo 的 Android 编组器（`Map<String, Any?>` 参数 → AnyTypeConverter →
 * RN `toHashMap`）在转换「Map 里嵌套的对象」时，遇到对象内的 null 字段会抛
 * `Cannot convert '[object Object]' to a Kotlin type. Value is null, expected an
 * Object`。受影响的是嵌套 ClipboardMeta（`ServerGetSnapshot.serverEntry`、
 * `SyncRuntimeState.stagedEntry`，它们的 hash/dataName/contentId 常为 null）。
 *
 * Kotlin 侧一律用 `as? T` 读取，key 缺失与值为 null 等价，所以剥掉 null 字段
 * 语义完全不变。顶层 Map 参数的 null 值本就会被 Expo 跳过，只有嵌套对象需要处理；
 * 这里对所有过界对象统一深度清理（iOS 的 Swift 编组器不受影响，统一处理无副作用）。
 */
function stripNullsDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripNullsDeep(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNullsDeep(v);
    }
    return out as unknown as T;
  }
  return value;
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
  return NativeModule.planPreamble(stripNullsDeep(state), stripNullsDeep(snap));
}

export function planAfterServerGet(
  state: SyncRuntimeState,
  snap: ServerGetSnapshot
): ServerRoute {
  if (!hasReducer()) return tsFallback.planAfterServerGet(state, snap);
  return NativeModule.planAfterServerGet(stripNullsDeep(state), stripNullsDeep(snap));
}

export function commitConverged(
  state: SyncRuntimeState,
  serverHash: string,
  serverContentId: string | null
): SyncRuntimeState {
  if (!hasReducer()) {
    return {
      ...state,
      lastSyncedHash: serverHash,
      lastSyncedContentId: serverContentId,
      stagedContentId: null,
    };
  }
  return NativeModule.commitConverged(stripNullsDeep(state), serverHash, serverContentId ?? null);
}

export function commitApply(
  state: SyncRuntimeState,
  hash: string | null,
  contentId: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  if (!hasReducer()) {
    return {
      state: {
        ...state,
        lastSyncedHash: hash,
        lastSyncedContentId: contentId,
        lastAppliedHash: hash,
        stagedContentId: null,
      },
      outcome: { tripped: false },
    };
  }
  return NativeModule.commitApply(stripNullsDeep(state), hash, contentId ?? null, nowMs, cfg);
}

export function commitApplyFailed(
  state: SyncRuntimeState,
  entry: ClipboardMeta
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, stagedServerHash: entry.hash, stagedContentId: entry.contentId };
  return NativeModule.commitApplyFailed(stripNullsDeep(state), stripNullsDeep(entry));
}

export function commitStage(
  state: SyncRuntimeState,
  entry: ClipboardMeta
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, stagedServerHash: entry.hash, stagedContentId: entry.contentId };
  return NativeModule.commitStage(stripNullsDeep(state), stripNullsDeep(entry));
}

export function commitPush(
  state: SyncRuntimeState,
  pushedHash: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  // push 换了内容但还不知道其服务端身份 → contentId 清空，等下次 GET 重新学到。
  if (!hasReducer()) return { state: { ...state, lastSyncedHash: pushedHash, lastSyncedContentId: null }, outcome: { tripped: false } };
  return NativeModule.commitPush(stripNullsDeep(state), pushedHash, nowMs, cfg);
}

export function commitPushSkipped(state: SyncRuntimeState): SyncRuntimeState {
  if (!hasReducer()) return state;
  return NativeModule.commitPushSkipped(stripNullsDeep(state));
}

export function commitConsentPush(
  state: SyncRuntimeState,
  pushedHash: string | null,
  nowMs: number,
  cfg: SyncConfig
): CommitStep {
  if (!hasReducer()) return { state: { ...state, lastSyncedHash: pushedHash, lastSyncedContentId: null, lastAppliedHash: pushedHash }, outcome: { tripped: false } };
  return NativeModule.commitConsentPush(stripNullsDeep(state), pushedHash, nowMs, cfg);
}

export function commitTickSuccess(state: SyncRuntimeState): SyncRuntimeState {
  if (!hasReducer()) return { ...state, consecutiveFailures: 0 };
  return NativeModule.commitTickSuccess(stripNullsDeep(state));
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
  return NativeModule.commitTickFailure(stripNullsDeep(state), kind, jitter, nowMs, cfg);
}

export function commitHistorySyncDone(
  state: SyncRuntimeState,
  nowMs: number
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, lastHistorySyncMs: nowMs };
  return NativeModule.commitHistorySyncDone(stripNullsDeep(state), nowMs);
}

export function markStagedApplied(state: SyncRuntimeState): MarkStagedStep {
  if (!hasReducer()) {
    const wasStaged = state.stagedServerHash !== null;
    return {
      state: {
        ...state,
        lastSyncedHash: state.stagedServerHash,
        lastSyncedContentId: state.stagedContentId,
        stagedServerHash: null,
        stagedContentId: null,
      },
      wasStaged,
    };
  }
  return NativeModule.markStagedApplied(stripNullsDeep(state));
}

export function acknowledgeLoopDetection(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, state: 'Idle', loopEvents: [] };
  return NativeModule.acknowledgeLoopDetection(stripNullsDeep(state));
}

export function resetRuntimeState(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...FALLBACK_RUNTIME_STATE };
  return NativeModule.resetRuntimeState(stripNullsDeep(state));
}

export function handleActiveServerChanged(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...FALLBACK_RUNTIME_STATE };
  return NativeModule.handleActiveServerChanged(stripNullsDeep(state));
}

export function handleNetworkRouteChanged(
  state: SyncRuntimeState
): SyncRuntimeState {
  if (!hasReducer()) return { ...state, consecutiveFailures: 0, nextAttemptMs: null };
  return NativeModule.handleNetworkRouteChanged(stripNullsDeep(state));
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

/**
 * 服务端 entry 是否就是已记录为「已同步」的内容（镜像 Rust `is_already_synced`）。
 * 两侧都有 contentId 时只比 contentId（不透明、verbatim）——这正是跨重编码稳定的
 * 关键；任一侧缺 contentId 时回退到既有 hash 大写比较（legacy / 未学到）。
 */
function isAlreadySynced(entry: ClipboardMeta, state: SyncRuntimeState): boolean {
  const cid = entry.contentId;
  const sid = state.lastSyncedContentId;
  if (cid != null && sid != null) return cid === sid;
  const h = entry.hash;
  const s = state.lastSyncedHash;
  if (h == null && s == null) return true;
  if (h == null || s == null) return false;
  return h.toUpperCase() === s.toUpperCase();
}

/** staged 去重，同样 contentId 优先、hash 回退（镜像 Rust `plan_server_new`）。 */
function isAlreadyStaged(entry: ClipboardMeta, state: SyncRuntimeState): boolean {
  const cid = entry.contentId;
  const sid = state.stagedContentId;
  if (cid != null && sid != null) return cid === sid;
  if (entry.hash != null) {
    return state.stagedServerHash != null && state.stagedServerHash.toUpperCase() === entry.hash.toUpperCase();
  }
  return false;
}

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
    // Cross-process resync：hash 与 contentId 作为同一快照一起比较、一起写入。
    // contentId 单独漂移（hash 不变）也要触发 fold，否则陈旧的跨进程 contentId 会
    // 滞留。contentId 不透明——verbatim 比较，不走 hash 的大写折叠。
    let newState = state;
    const hashDiffers =
      (snap.persistedSyncedHash?.toUpperCase() ?? null) !== (state.lastSyncedHash?.toUpperCase() ?? null);
    const contentIdDiffers = (snap.persistedSyncedContentId ?? null) !== (state.lastSyncedContentId ?? null);
    if (hashDiffers || contentIdDiffers) {
      newState = {
        ...newState,
        lastSyncedHash: snap.persistedSyncedHash ? snap.persistedSyncedHash.toUpperCase() : null,
        lastSyncedContentId: snap.persistedSyncedContentId ?? null,
      };
    }
    return { state: newState, preamble: { recordLocal: false, proceed: { type: 'ToNetwork' } } };
  },

  planAfterServerGet(state: SyncRuntimeState, snap: ServerGetSnapshot): ServerRoute {
    const entry = snap.serverEntry;
    const serverHash = entry?.hash ?? null;
    const deviceHash = snap.deviceHash ?? null;
    const synced = state.lastSyncedHash;

    // Truth-gate（对齐 Rust reducer）：server latest == device clipboard 才算
    // Converged。旧实现误用 server == lastSynced，会在「服务端未变但设备有新内容
    // 待推送」时直接 Converged，导致 autoPush 永不触发。
    if (serverHash && deviceHash && serverHash.toUpperCase() === deviceHash.toUpperCase()) {
      return { type: 'Converged', serverHash: serverHash.toUpperCase() };
    }

    // 服务端有新内容——identity-aware：重编码（JPEG→PNG）会改 hash 但 contentId
    // 不变；两侧都有 contentId 时只比 contentId（忽略 hash），否则回退 hash 比较。
    if (entry && serverHash && !isAlreadySynced(entry, state)) {
      const alreadyStaged = isAlreadyStaged(entry, state);
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
