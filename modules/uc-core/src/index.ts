import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

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
  return NativeModule.probe(urls, username, password, trustInsecureCert, timeoutMs, networkEpoch);
}

export function cancelInFlight(): void {
  NativeModule.cancelInFlight();
}

// --- SSE push channel (notify-then-pull) ---
//
// Rust 只管单次会话（断即 onSseDisconnected，不自动重连）；退避重连、
// feature-detect 回退轮询、生命周期与并发协调全部在 TS 侧（SyncEngine）。
// 每个事件都回传 subscriptionId，调用方据此丢弃已取消订阅（旧 epoch）的
// 在途回调。

export interface SseHelloEvent {
  subscriptionId: string;
  /** 服务端建连时刻的时钟（ms）。收到即无条件拉一次，覆盖建连窗口竞态。 */
  serverTimeMs: number;
}

export interface SseUpdateEvent {
  subscriptionId: string;
  /** 新内容的 `blake3v1:<hex>` contentId——与 lastSyncedContentId 比对短路，不是内容本身。 */
  contentId: string;
}

export interface SseResyncEvent {
  subscriptionId: string;
}

export interface SseDisconnectedEvent {
  subscriptionId: string;
  /** 人类可读诊断信息，非稳定机器码。调用方自己 cancel 时不触发。 */
  reason: string;
}

export interface SseEvents {
  onSseHello: (event: SseHelloEvent) => void;
  onSseUpdate: (event: SseUpdateEvent) => void;
  onSseResync: (event: SseResyncEvent) => void;
  onSseDisconnected: (event: SseDisconnectedEvent) => void;
}

/** iOS 绑定尚未包含 SSE 时返回 false（对齐 hasSyncHelpers 的 feature-detect 模式）。 */
export function hasSse(): boolean {
  return typeof NativeModule.startSseSubscription === 'function';
}

export function startSseSubscription(
  subscriptionId: string,
  server: ServerConfig,
  trustInsecureCert = false
): void {
  NativeModule.startSseSubscription(subscriptionId, server, trustInsecureCert);
}

export function cancelSseSubscription(subscriptionId: string): void {
  NativeModule.cancelSseSubscription(subscriptionId);
}

export function addSseListener<K extends keyof SseEvents>(
  eventName: K,
  listener: SseEvents[K]
): EventSubscription {
  return NativeModule.addListener(eventName, listener);
}

// --- MobileSyncEngine (push/pull 同步 SDK) ---
//
// 取代旧的「TS 逐函数驱动 reducer」编排:去重 / 防回环 / watermark / 冲突解析
// 全部收进 Rust `MobileSyncEngine`,RN 侧只调 push / pull / applyStaged + 几个
// 生命周期方法。引擎实例由 native 桥长期持有(单实例,像 SSE handle 一样),
// TS 经这些模块函数驱动。
//
// 设计 / 契约:上游 `.planning/2026-07-05-mobile-push-pull-sdk-*.md`。
// 注意:SSE 连接生命周期仍在 TS(上面那段)——引擎只在 pull(trigger) 里吃 SSE 语义。

export type ClipboardKind = 'Text' | 'Image' | 'File' | 'Group';

/** 客户端从剪贴板读到的本地内容。File/Image 带 payload 字节 + dataName;纯文本走 text。 */
export interface LocalContent {
  kind: ClipboardKind;
  /** Text 内容;Image/File 为空串。 */
  text: string;
  /** Image/File 的文件名提示(扩展名驱动 Image 上传名);Text 为 null。 */
  dataName: string | null;
  /** Image/File 的字节;Text 为 null。push 入参接受 ArrayBuffer/Uint8Array;
   *  Applied 回传时是 ArrayBuffer。 */
  payload?: ArrayBuffer | Uint8Array | null;
}

/** 引擎设置。`autoApply` 关时服务端新内容走 staged 流(见 applyStaged)。
 *  `autoPush`(何时调 push)归客户端,不在此。 */
export interface SyncSettings {
  autoApply: boolean;
}

/** push / pull / applyStaged 流动内容的元数据,供 native 往 HistoryStorage 追加历史行。 */
export interface SyncedMeta {
  kind: ClipboardKind;
  hash: string | null;
  contentId: string | null;
  text: string | null;
  size: number | null;
}

/** 渲染「有新内容可用」banner 的最小信息(不含字节)。 */
export interface StagedPreview {
  kind: ClipboardKind;
  text: string;
  size: number | null;
}

/** UpToDate 的原因,供遥测。 */
export type UpToDateReason =
  | 'AlreadySynced'
  | 'SelfWritten'
  | 'Converged'
  | 'NoLocalChange'
  | 'SseShortCircuit'
  | 'ConsentMode';

/** pull 的触发源:决定退避门控与 SSE contentId 短路。push 无触发概念。 */
export type PullTrigger =
  | { tag: 'Routine' } // 兜底 tick:受同步操作退避门控
  | { tag: 'Explicit' } // 用户下拉刷新:穿透退避
  | { tag: 'SseHello' } // 连接刚活:无条件 pull(穿透)
  | { tag: 'SseResync' } // 服务端 lagged:无条件 pull(穿透)
  | { tag: 'SseUpdate'; contentId: string }; // contentId 命中已同步水位线则短路 UpToDate

/**
 * push / pull / applyStaged 的统一结果(tagged union,用 `tag` 判别)。
 */
export type SyncOutcome =
  /** 完整 put_clipboard 成功(推进 active register)。meta 供追加 .local 历史行。 */
  | { tag: 'Uploaded'; meta: SyncedMeta }
  /** 服务端有更新内容,字节已下载:native 写入剪贴板/Files,追加 .pulled 历史行。
   *  本地那次写入让位(未上传,Q10 stale-clobber 保护)。 */
  | { tag: 'Applied'; content: LocalContent; meta: SyncedMeta }
  /** 服务端有新内容但 autoApply 关:已暂存(会话内),native 出 banner。 */
  | { tag: 'Staged'; preview: StagedPreview }
  /** 什么都没流动(已同步/自写/已收敛/无本地变化/SSE 短路/consent)。 */
  | { tag: 'UpToDate'; reason: UpToDateReason }
  /** 例行 tick 被同步操作退避挡下:按 retryAfterMs 排下次 Routine,不要重试。 */
  | { tag: 'BackingOff'; retryAfterMs: number }
  /** 防回环跳闸,已暂停:出 banner,用户 ack 后调 engineAcknowledgeLoopDetected。 */
  | { tag: 'LoopDetected' }
  /** 失败:error 为人类可读诊断串。 */
  | { tag: 'Failed'; error: string };

/** 引擎绑定是否可用(feature-detect,对齐 hasSse/hasSyncHelpers)。 */
export function hasEngine(): boolean {
  return typeof NativeModule.engineInit === 'function';
}

/**
 * 构造并让 native 桥长期持有 `MobileSyncEngine` 单实例。一次性调用(切服务器走
 * engineSetServer,不要重建)。内部复用桥已持有的 `MobileSyncClient` + native 的
 * `KeyValueStore`(App Group / app 私有文件)。构造失败会抛。
 */
export function engineInit(
  server: ServerConfig,
  config: SyncConfig,
  settings: SyncSettings,
  trustInsecureCert = false
): void {
  NativeModule.engineInit(server, config, settings, trustInsecureCert);
}

/** 释放引擎实例(切服务器 reset / 停止同步时)。 */
export function engineDispose(): void {
  NativeModule.engineDispose();
}

function toSyncedMeta(m: any): SyncedMeta {
  return {
    kind: m.kind,
    hash: m.hash ?? null,
    contentId: m.contentId ?? null,
    text: m.text ?? null,
    size: m.size ?? null,
  };
}

/**
 * 把 native 桥返回的 outcome map 规范成干净的 tagged union。桥为规避 Android 嵌套字节
 * 编组,把 Applied 的 payload 放在顶层——这里归位到 content.payload,并把缺省字段
 * coalesce 成 null。
 */
function normalizeOutcome(raw: any): SyncOutcome {
  switch (raw?.tag) {
    case 'Uploaded':
      return { tag: 'Uploaded', meta: toSyncedMeta(raw.meta) };
    case 'Applied':
      return {
        tag: 'Applied',
        content: {
          kind: raw.content.kind,
          text: raw.content.text,
          dataName: raw.content.dataName ?? null,
          payload: raw.payload ?? null,
        },
        meta: toSyncedMeta(raw.meta),
      };
    case 'Staged':
      return {
        tag: 'Staged',
        preview: {
          kind: raw.preview.kind,
          text: raw.preview.text,
          size: raw.preview.size ?? null,
        },
      };
    case 'UpToDate':
      return { tag: 'UpToDate', reason: raw.reason };
    case 'BackingOff':
      return { tag: 'BackingOff', retryAfterMs: raw.retryAfterMs };
    case 'LoopDetected':
      return { tag: 'LoopDetected' };
    case 'Failed':
      return { tag: 'Failed', error: raw.error ?? 'unknown error' };
    default:
      return { tag: 'Failed', error: `unknown outcome tag: ${String(raw?.tag)}` };
  }
}

/** 本地剪贴板变化后调用。引擎内部先 get_latest(server-new 优先 apply 防 stale-clobber),
 *  否则按 watermark/自写 guard 去重,真需要才完整 put_clipboard。 */
export async function enginePush(content: LocalContent): Promise<SyncOutcome> {
  // payload 拆成独立参数(照 putClipboard 惯例;避免嵌套字节过 Android 编组器)。
  const { payload, ...rest } = content;
  const raw = await NativeModule.enginePush(rest, payload ?? null);
  return normalizeOutcome(raw);
}

/** 探测并(按 autoApply)应用服务端新内容。currentDeviceHash 供 truth-gate 收敛检测。 */
export async function enginePull(
  trigger: PullTrigger,
  currentDeviceHash: string | null
): Promise<SyncOutcome> {
  const raw = await NativeModule.enginePull(trigger, currentDeviceHash);
  return normalizeOutcome(raw);
}

/** 用户在 staged banner 点「应用」时调:此刻下载字节并推进水位线,返回 Applied。 */
export async function engineApplyStaged(): Promise<SyncOutcome> {
  const raw = await NativeModule.engineApplyStaged();
  return normalizeOutcome(raw);
}

/** 切服务器:与当前不同即清 watermark + reset runtime(新服务器有自己的内容时间线)。 */
export async function engineSetServer(server: ServerConfig): Promise<void> {
  return NativeModule.engineSetServer(server);
}

/** 网络路由变化:清同步操作退避,让下一次触发立即打网络。 */
export async function engineHandleNetworkRouteChanged(): Promise<void> {
  return NativeModule.engineHandleNetworkRouteChanged();
}

/** 设置变更(autoApply 翻转)。 */
export async function engineSetSettings(settings: SyncSettings): Promise<void> {
  return NativeModule.engineSetSettings(settings);
}

/** 用户消 LoopDetected banner 后调:清 loop 缓冲,恢复同步。 */
export async function engineAcknowledgeLoopDetected(): Promise<void> {
  return NativeModule.engineAcknowledgeLoopDetected();
}

// --- Sync config + cadence helpers ---
//
// 这几个纯函数是 reducer 时代唯一活下来的部分——去重/防回环/watermark/冲突解析
// 都已收进上面的 MobileSyncEngine,但 RN 侧的 history 列表同步节流(SyncEngine.ts
// runHistorySyncIfDue)和冷启动/watermark 判断仍需要它们,故保留。

export interface SyncConfig {
  normalCadenceSecs: number;
  inactiveCadenceSecs: number;
  offlineBackoffSecs: number;
  offlineBackoffMaxSecs: number;
  historySyncIntervalSecs: number;
  loopWindowSecs: number;
  loopFlipThreshold: number;
}

const FALLBACK_SYNC_CONFIG: SyncConfig = {
  normalCadenceSecs: 1.0,
  inactiveCadenceSecs: 5.0,
  offlineBackoffSecs: 5.0,
  offlineBackoffMaxSecs: 60.0,
  historySyncIntervalSecs: 30.0,
  loopWindowSecs: 30.0,
  loopFlipThreshold: 3,
};

/** 绑定是否带这批 sync 辅助函数(老绑定可能缺,回退纯 TS 实现)。 */
function hasSyncHelpers(): boolean {
  return typeof NativeModule.defaultSyncConfig === 'function';
}

export function defaultSyncConfig(): SyncConfig {
  if (!hasSyncHelpers()) return { ...FALLBACK_SYNC_CONFIG };
  return NativeModule.defaultSyncConfig();
}

export function isHistorySyncDue(
  lastSyncMs: number | null,
  nowMs: number,
  intervalSecs: number
): boolean {
  if (!hasSyncHelpers()) {
    if (lastSyncMs == null) return true;
    return nowMs - lastSyncMs >= intervalSecs * 1000;
  }
  return NativeModule.isHistorySyncDue(lastSyncMs ?? null, nowMs, intervalSecs);
}

export function isColdStart(watermarkMs: number | null): boolean {
  if (!hasSyncHelpers()) return watermarkMs == null;
  return NativeModule.isColdStart(watermarkMs ?? null);
}

export function advanceWatermark(
  currentMs: number | null,
  maxLastModifiedMs: number
): number | null {
  if (!hasSyncHelpers()) {
    if (currentMs == null || maxLastModifiedMs > currentMs) return maxLastModifiedMs;
    return null;
  }
  return NativeModule.advanceWatermark(currentMs ?? null, maxLastModifiedMs);
}
