/**
 * SyncEngine — Rust `MobileSyncEngine` 的薄协调器（P3 迁移后）。
 *
 * 去重 / 防回环 / watermark 持久化 / 冲突解析 / 退避全部收进 Rust 引擎，本层只负责：
 *   - 触发 push / pull / applyStaged，并把 `SyncOutcome` 翻译成历史行 / 剪贴板写回 / UI 状态；
 *   - 维护 SSE 连接状态机（重连退避 / feature-detect 降级 / epoch 过滤——**决策全在 TS**，
 *     引擎只在 pull(trigger) 里吃 SSE 语义，故仅回调体改成 enginePull）；
 *   - 周期兜底 tick 定时器（现驱动 enginePull(Routine)）；
 *   - device_hash 代理（activate 寄存器，经注入的 getDeviceClipboard 回调）。
 *
 * URL 路由（引擎只持单 baseUrl，app 有 LAN/WAN 多候选）：事件驱动重解析——start /
 * 服务器切换 / 网络路由变化时用 selectServerUrl 的排序解析出 live URL 喂给引擎；离线时
 * 轮换候选做故障转移（离线期清 watermark 无害，服务端本就不可达）。
 */

import {
  engineInit,
  engineDispose,
  enginePush,
  enginePull,
  putClipboard,
  engineApplyStaged,
  engineSetServer,
  engineHandleNetworkRouteChanged,
  engineSetSettings,
  engineAcknowledgeLoopDetected,
  hasEngine,
  defaultSyncConfig,
  hasSse,
  startSseSubscription,
  cancelSseSubscription,
  addSseListener,
} from 'uc-core';
import type {
  SyncConfig,
  ClipboardMeta,
  LocalContent,
  SyncOutcome,
  SyncedMeta,
  StagedPreview,
  PullTrigger,
  ServerConfig as UcServerConfig,
} from 'uc-core';
import type { EventSubscription } from 'expo-modules-core';
import { getCurrentNetworkContext } from './networkContext';
import { loadServerRouteLiveUrl, saveServerRouteLiveUrl } from './serverRouteRecordStore';
import {
  selectServerUrl,
  orderServerUrls,
  getServerRouteKey,
  type ServerRoute as SelectedServerRoute,
} from './serverRouteSelector';
import type { ServerConfig as AppServerConfig } from '@/types/api';
import { HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardItem } from '@/types/clipboard';
import { sanitizeDataName } from '@/utils/fileName';
import { log } from './Logger';

// SSE 在线时下行推送接管即时性，周期 tick 降为低频兜底（设计 §5.2：SSE 在线也保留
// ~30s 兜底 tick）；SSE 断开/回退时恢复 normalCadence（1Hz）轮询。
const SSE_FALLBACK_CADENCE_SECS = 30;
// 断线退避重连：1s 起指数翻倍，封顶 30s。
const SSE_BACKOFF_BASE_MS = 1000;
const SSE_BACKOFF_MAX_MS = 30000;
// 连续失败达到阈值 → feature-detect 判定服务端不支持 SSE（或持续不可用），
// 停止退避、回到 1Hz 轮询，改为低频重试探测。
const SSE_MAX_CONSECUTIVE_FAILURES = 5;
const SSE_FEATURE_RETRY_MS = 5 * 60 * 1000;

// 连续 N 次离线 tick 后开始轮换候选 URL 做故障转移（Option A：引擎只持单 URL，
// 靠协调器在离线时切换候选；离线期没有成功的 pull，清 watermark 不会 clobber）。
const OFFLINE_URL_ROTATE_AFTER = 2;

export type SyncEngineState =
  | 'Idle'
  | 'Succeeded'
  | 'HasNewUnwritten'
  | 'OfflineRetrying'
  | 'AuthFailed'
  | 'LoopDetected';

export interface SyncEngineStatus {
  state: SyncEngineState;
  lastSyncedAt: number | null;
  lastError: string | null;
  isExplicitlyRefreshing: boolean;
  stagedEntry: ClipboardMeta | null;
}

export type SyncEngineListener = (status: SyncEngineStatus) => void;

export interface ActiveServerInfo {
  baseUrl: string;
  urls?: string[];
  username: string;
  password: string;
  trustInsecureCert: boolean;
}

export interface DeviceClipboard {
  hash: string | null;
  meta: ClipboardMeta;
  payload?: ArrayBuffer;
  /** 本地文件 URI；push 时若 payload 缺失则从此读取字节上传 */
  fileUri?: string;
}

export interface SyncSettings {
  autoApplyRemote: boolean;
  autoPushLocal: boolean;
  /** 是否尝试 SSE 推送通道（RN 本地设置 + feature-detect 双重门控，设计 F-6）。 */
  enableSse: boolean;
}

type ErrorKind =
  | 'AuthFailed'
  | 'Cancelled'
  | 'NetworkUnreachable'
  | 'ConnectTimeout'
  | 'ReceiveTimeout'
  | 'OtherSyncError';

/** pull 触发强弱排序（穿透优先），供单飞合并时选更强的 pending。 */
function triggerRank(t: PullTrigger): number {
  switch (t.tag) {
    case 'Explicit':
      return 4;
    case 'SseResync':
      return 3;
    case 'SseHello':
      return 2;
    case 'SseUpdate':
      return 1;
    case 'Routine':
      return 0;
  }
}

export class SyncEngine {
  private syncConfig: SyncConfig;

  private state: SyncEngineState = 'Idle';
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private isExplicitlyRefreshing = false;
  private stagedEntry: ClipboardMeta | null = null;

  // -- 引擎实例（native 长期持有；这里只记录构造状态与当前喂给引擎的 URL）--
  private engineConstructed = false;
  private currentEngineUrl: string | null = null;
  private offlineTicks = 0;
  private offlineUrlRotation = 0;

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  // BackingOff{retryAfterMs} 覆盖下一次 tick 间隔（一次性）。
  private nextTickOverrideMs: number | null = null;

  // pull 单飞合并：一个在跑 + 至多一个 pending（取更强触发），吸收 SSE 突发。
  private pullInFlight = false;
  private pendingPullTrigger: PullTrigger | null = null;
  // push 单飞合并：本地写突发合并成一次（每次重跑读最新 device）。
  private pushInFlight = false;
  private pushPending = false;

  // -- SSE push channel state（策略全在 TS 侧，Rust 只管单次会话）--
  private sseEpoch = 0;
  private sseSubscriptionId: string | null = null;
  private sseConnected = false;
  private sseConsecutiveFailures = 0;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private sseSubscriptions: EventSubscription[] = [];

  /**
   * 服务器不可达离线态。服务器离线是预期状态而非错误：兜底 tick 会持续失败，
   * 这里只在「在线↔离线」跳变时各记一条 info，避免刷屏（也压掉 Logger IO 抖动）。
   */
  private isOffline = false;
  private isSceneInactive = false;

  private listeners = new Set<SyncEngineListener>();

  private getActiveServer: () => ActiveServerInfo | null;
  private getDeviceClipboard: () => DeviceClipboard | null | Promise<DeviceClipboard | null>;
  private getSettings: () => SyncSettings;
  private applyToDevice: (meta: ClipboardMeta, payload?: ArrayBuffer) => Promise<void>;

  constructor(opts: {
    getActiveServer: () => ActiveServerInfo | null;
    getDeviceClipboard: () => DeviceClipboard | null | Promise<DeviceClipboard | null>;
    getSettings: () => SyncSettings;
    applyToDevice: (meta: ClipboardMeta, payload?: ArrayBuffer) => Promise<void>;
  }) {
    this.getActiveServer = opts.getActiveServer;
    this.getDeviceClipboard = opts.getDeviceClipboard;
    this.getSettings = opts.getSettings;
    this.applyToDevice = opts.applyToDevice;
    this.syncConfig = defaultSyncConfig();

    this.setupSseListeners();
  }

  // -- Lifecycle --

  start(): void {
    if (this.state === 'LoopDetected') return;
    if (this.state === 'AuthFailed') this.setState('Idle');
    log.info('[SyncEngine] start');
    // 先确保引擎按当前 live URL 构造/对齐，再起 tick + SSE + 立即收敛一次。
    void (async () => {
      const ok = await this.ensureEngine();
      if (!ok) {
        this.setState('Idle');
        this.notifyListeners();
        return;
      }
      if (this.tickTimer === null) this.scheduleNextTick();
      void this.startSse();
      // 首次立即收敛：有本地内容且允许自动推送就 push（内部含 get_latest，双向都覆盖），
      // 否则显式 pull 一次拉服务端最新。
      void this.reconverge();
    })();
  }

  stop(): void {
    // 停 tick + SSE，但保留 native 引擎实例（设计：长生命周期单实例，退后台不销毁）。
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.stopSse();
  }

  setSceneInactive(inactive: boolean): void {
    this.isSceneInactive = inactive;
  }

  destroy(): void {
    this.stop();
    for (const sub of this.sseSubscriptions) sub.remove();
    this.sseSubscriptions = [];
    this.listeners.clear();
    if (this.engineConstructed) {
      try {
        engineDispose();
      } catch {
        // native 已释放时静默
      }
      this.engineConstructed = false;
      this.currentEngineUrl = null;
    }
  }

  // -- 引擎构造 / URL 对齐（Option A：事件驱动重解析）--

  /** 引擎的 auto_apply 快照来自 app 设置的 autoApplyRemote。 */
  private engineSettings() {
    return { autoApply: this.getSettings().autoApplyRemote };
  }

  /**
   * 解析当前 active server 的 live URL，构造（首次）或对齐（URL 变了）引擎。
   * @param rotate 离线故障转移：先失效缓存的 live URL 并轮换候选顺序。
   * @returns 是否有可用 active server（引擎已就绪）。
   */
  private async ensureEngine(rotate = false): Promise<boolean> {
    if (!hasEngine()) return false;
    const server = this.getActiveServer();
    if (!server) return false;

    const ucServer = await this.resolveLiveUcServer(server, rotate);

    if (!this.engineConstructed) {
      try {
        engineInit(ucServer, this.syncConfig, this.engineSettings(), server.trustInsecureCert);
        this.engineConstructed = true;
        this.currentEngineUrl = ucServer.baseUrl;
        log.info('[SyncEngine] engineInit @ ' + ucServer.baseUrl);
      } catch (e: any) {
        log.error('[SyncEngine] engineInit failed:', e?.message ?? e);
        return false;
      }
      return true;
    }

    if (ucServer.baseUrl !== this.currentEngineUrl) {
      try {
        // 注意：换 baseUrl 会清 watermark（same_server 精确比对）。仅在事件驱动
        // 重解析 / 离线轮换时发生；调用方（handleNetworkChanged / 离线 tick）随后
        // 会立即 reconverge，用 push/truth-gate 重新收敛。
        await engineSetServer(ucServer);
        this.currentEngineUrl = ucServer.baseUrl;
        log.info('[SyncEngine] engineSetServer @ ' + ucServer.baseUrl);
      } catch (e: any) {
        log.error('[SyncEngine] engineSetServer failed:', e?.message ?? e);
      }
    }
    return true;
  }

  /**
   * 不打网络地解析出最优 live URL：按网络偏好排序候选 + 缓存的 live URL 提升。
   * rotate=true 时失效缓存并按轮换序号偏移选另一候选（离线故障转移）。
   */
  private async resolveLiveUcServer(
    server: ActiveServerInfo,
    rotate: boolean
  ): Promise<UcServerConfig> {
    const appServer = this.toAppServerConfig(server);
    const key = getServerRouteKey(appServer);
    let liveUrl: string | null = null;
    if (rotate) {
      await saveServerRouteLiveUrl(key, null);
    } else {
      liveUrl = await loadServerRouteLiveUrl(key);
    }
    const ordered = orderServerUrls(appServer, getCurrentNetworkContext(), { liveUrl });
    let url = ordered[0] ?? server.baseUrl;
    if (rotate && ordered.length > 1) {
      this.offlineUrlRotation = (this.offlineUrlRotation + 1) % ordered.length;
      url = ordered[this.offlineUrlRotation] ?? url;
    }
    return {
      baseUrl: url.replace(/\/+$/, ''),
      username: server.username,
      password: server.password,
    };
  }

  // -- SSE push channel（连接生命周期全在 TS，回调体改成 enginePull）--

  private setupSseListeners(): void {
    if (!hasSse()) return;
    // 监听只注册一次，回调内按 subscriptionId 过滤：不是当前订阅（旧 epoch
    // 或已取消）的在途回调一律丢弃。
    this.sseSubscriptions = [
      addSseListener('onSseHello', (e) => {
        if (e.subscriptionId !== this.sseSubscriptionId) return;
        log.info('[SyncEngine] SSE hello (serverTime=' + e.serverTimeMs + ')');
        this.sseConnected = true;
        this.sseConsecutiveFailures = 0;
        // 无重放承诺：连上后无条件拉一次，覆盖建连窗口竞态（设计 §4.3）。
        void this.runPull({ tag: 'SseHello' });
      }),
      addSseListener('onSseUpdate', (e) => {
        if (e.subscriptionId !== this.sseSubscriptionId) return;
        // contentId 短路已下沉进引擎：SseUpdate 若命中已同步 watermark，enginePull
        // 直接返回 UpToDate{SseShortCircuit}，连 get_latest 都省，无需 TS 侧预判。
        log.info('[SyncEngine] SSE update -> pull');
        void this.runPull({ tag: 'SseUpdate', contentId: e.contentId });
      }),
      addSseListener('onSseResync', (e) => {
        if (e.subscriptionId !== this.sseSubscriptionId) return;
        log.info('[SyncEngine] SSE resync -> unconditional pull');
        void this.runPull({ tag: 'SseResync' });
      }),
      addSseListener('onSseDisconnected', (e) => {
        if (e.subscriptionId !== this.sseSubscriptionId) return;
        this.handleSseDisconnected(e.reason);
      }),
    ];
  }

  /**
   * 建立 SSE 订阅（新 epoch）。设置关 / native 不支持 / 无 active server 时
   * 静默返回——下行保持现状轮询，天然 feature-gate。
   */
  async startSse(): Promise<void> {
    if (!hasSse()) return;
    if (!this.getSettings().enableSse) return;
    const server = this.getActiveServer();
    if (!server) return;

    this.cancelSseSubscriptionInternal();
    this.sseEpoch += 1;
    const epoch = this.sseEpoch;
    const subscriptionId = 'sse-' + epoch;

    let ucServer: UcServerConfig;
    try {
      ucServer = await this.withActiveRoute(server, async (route) => this.toUcServer(route));
    } catch (e: any) {
      log.info('[SyncEngine] SSE route resolve failed: ' + (e?.message ?? e));
      this.handleSseDisconnected('route resolve failed');
      return;
    }
    // await 期间 epoch 可能已被 bump（切服务器/退后台），旧请求作废。
    if (epoch !== this.sseEpoch) return;

    this.sseSubscriptionId = subscriptionId;
    try {
      startSseSubscription(subscriptionId, ucServer, server.trustInsecureCert);
      log.info('[SyncEngine] SSE subscribing (' + subscriptionId + ') to ' + ucServer.baseUrl);
    } catch (e: any) {
      log.warn('[SyncEngine] SSE subscribe threw: ' + (e?.message ?? e));
      this.sseSubscriptionId = null;
      this.handleSseDisconnected('subscribe failed');
    }
  }

  /** 断开 SSE 并丢弃在途回调（bump epoch）。退后台 / stop / destroy 时调用。 */
  stopSse(): void {
    this.cancelSseSubscriptionInternal();
    this.sseEpoch += 1;
    if (this.sseReconnectTimer !== null) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
    if (this.sseRetryTimer !== null) {
      clearTimeout(this.sseRetryTimer);
      this.sseRetryTimer = null;
    }
  }

  /** 切服务器 / 网络路由变化 / 设置开关翻转：清退避计数，立即按新 config 重连。 */
  restartSse(): void {
    this.stopSse();
    this.sseConsecutiveFailures = 0;
    void this.startSse();
  }

  private cancelSseSubscriptionInternal(): void {
    if (this.sseSubscriptionId !== null) {
      try {
        cancelSseSubscription(this.sseSubscriptionId);
      } catch {
        // native 侧已不存在该订阅时静默
      }
      this.sseSubscriptionId = null;
    }
    this.sseConnected = false;
  }

  private handleSseDisconnected(reason: string): void {
    this.sseSubscriptionId = null;
    const wasConnected = this.sseConnected;
    this.sseConnected = false;
    this.sseConsecutiveFailures += 1;

    // SSE 掉线后周期 tick 可能还挂在 30s 兜底档上，立即重排回 1Hz 轮询，不留下行盲区。
    if (this.tickTimer !== null) this.scheduleNextTick();

    if (this.sseConsecutiveFailures >= SSE_MAX_CONSECUTIVE_FAILURES) {
      // feature-detect 回退：服务端大概率不支持 SSE（旧版本 / 反代剥流），
      // 停止退避重连，低频重试探测。
      if (this.sseConsecutiveFailures === SSE_MAX_CONSECUTIVE_FAILURES) {
        log.info(
          '[SyncEngine] SSE unavailable after ' +
            this.sseConsecutiveFailures +
            ' failures (' +
            reason +
            ') — falling back to polling, will re-probe every ' +
            SSE_FEATURE_RETRY_MS / 60000 +
            'min'
        );
      }
      if (this.sseRetryTimer !== null) clearTimeout(this.sseRetryTimer);
      this.sseRetryTimer = setTimeout(() => {
        this.sseRetryTimer = null;
        void this.startSse();
      }, SSE_FEATURE_RETRY_MS);
      return;
    }

    const delayMs = Math.min(
      SSE_BACKOFF_BASE_MS * Math.pow(2, this.sseConsecutiveFailures - 1),
      SSE_BACKOFF_MAX_MS
    );
    if (wasConnected) {
      log.info('[SyncEngine] SSE disconnected (' + reason + '), reconnect in ' + delayMs + 'ms');
    }
    if (this.sseReconnectTimer !== null) clearTimeout(this.sseReconnectTimer);
    this.sseReconnectTimer = setTimeout(() => {
      this.sseReconnectTimer = null;
      void this.startSse();
    }, delayMs);
  }

  // -- 外部触发入口 --

  /** 本地剪贴板变化（复制/粘贴/选图/拍照 / monitor 回调）：push 当前 device 内容。 */
  notifyLocalChanged(): void {
    if (this.state === 'AuthFailed' || this.state === 'LoopDetected') return;
    void this.runPush();
  }

  /** 用户下拉刷新：显式 pull 穿透退避。 */
  async explicitRefresh(): Promise<void> {
    this.isExplicitlyRefreshing = true;
    this.notifyListeners();
    try {
      await this.pullServer({ tag: 'Explicit' });
    } finally {
      this.isExplicitlyRefreshing = false;
      this.notifyListeners();
    }
  }

  /** 用户在 staged banner 点「应用」：下载字节 + 推进 watermark，返回 Applied。 */
  async applyStagedEntry(): Promise<void> {
    if (!this.engineConstructed) return;
    let outcome: SyncOutcome;
    try {
      outcome = await engineApplyStaged();
    } catch (e: any) {
      log.error('[SyncEngine] engineApplyStaged threw:', e?.message ?? e);
      return;
    }
    await this.applyOutcome(outcome, false);
  }

  /** 用户消 LoopDetected banner：清 loop 缓冲，恢复同步。 */
  async acknowledgeLoop(): Promise<void> {
    if (this.engineConstructed) {
      try {
        await engineAcknowledgeLoopDetected();
      } catch (e: any) {
        log.error('[SyncEngine] engineAcknowledgeLoopDetected threw:', e?.message ?? e);
      }
    }
    this.setState('Idle');
    this.lastError = null;
    this.notifyListeners();
    this.start();
  }

  /** app 设置变更（autoApplyRemote 翻转）：把最新 auto_apply 推给引擎。 */
  async applySettings(): Promise<void> {
    if (!this.engineConstructed) return;
    try {
      await engineSetSettings(this.engineSettings());
    } catch (e: any) {
      log.error('[SyncEngine] engineSetSettings threw:', e?.message ?? e);
    }
  }

  /**
   * 显式推送一条已落库的历史记录（FAB 选文件/图片/拍照、分享接收、前台文本）。
   *
   * 与自动 push（pushLocal）不同：这是用户明确的「上传」意图，**绕过 autoPushLocal 门控**
   * 一律推送——consent 模式下被动激活仍留本地，但显式上传照推。
   *
   * **不走 enginePush**：enginePush 带 reducer 去重 / watermark / 自写 guard，app 前后台
   * 反复重启后引擎状态错乱时会静默跳过 PUT、假报成功（服务端零收到）。显式上传必须真正
   * 发出，故直接用底层 {@link putClipboard}——内部先 `PUT /file/{dataName}` 传字节、再
   * `PUT /SyncClipboard.json` 传 meta，无去重；iOS 也真发字节（Rust 实现，不依赖 android-util）。
   *
   * - 记录不存在 / 无 server / 文件字节缺失：抛错。
   * - 记录已 Synced：幂等直接返回。
   * - putClipboard 成功：内容已在服务端，标记该行 Synced（不依赖引擎 outcome）。
   * - putClipboard 抛错（离线 / 服务端 5xx 等）：向上抛，交调用方（BackgroundUploadManager）退避重试。
   */
  async pushRecordExplicit(profileHash: string): Promise<void> {
    if (!(await this.ensureEngine())) {
      throw new Error('SyncEngine unavailable (no engine or active server)');
    }
    const server = this.getActiveServer();
    if (!server) throw new Error('SyncEngine: no active server');

    const { historyStorage } = require('@/services');
    const item: ClipboardItem | null = await historyStorage.getItem(profileHash);
    if (!item) throw new Error('history record not found: ' + profileHash);
    if (item.syncStatus === HistorySyncStatus.Synced) return; // 幂等

    // 用原始 dataName 读本地字节（与本地存储文件名一致），上传 meta 再用清洗后的名——
    // 纵深防御：import 已清洗过新数据，这里兜底历史里可能残留的坏名（带 `?t=` 等），
    // 否则服务端 begin_stage 会 500。ClipboardContentType 与 ClipboardKind 同域。
    const payload = await this.readRecordPayload(item);
    const meta: ClipboardMeta = {
      kind: item.type,
      text: item.text ?? '',
      dataName: item.dataName ? sanitizeDataName(item.dataName) : null,
      hasData: payload != null,
      size: item.size ?? payload?.byteLength ?? item.text?.length ?? 0,
      hash: item.profileHash,
      contentId: item.contentId ?? null,
    };

    const ucServer = await this.resolveLiveUcServer(server, false);
    await putClipboard(ucServer, meta, payload ?? undefined, server.trustInsecureCert);

    await this.markHistoryPushed(profileHash);
  }

  /** 服务器切换：引擎按新 server 清 watermark + reset，重启 tick / SSE 并立即收敛。 */
  async handleServerChanged(): Promise<void> {
    this.stagedEntry = null;
    this.isOffline = false;
    this.offlineTicks = 0;
    this.setState('Idle');
    this.lastError = null;

    // 强制按新 server 重解析并对齐引擎（新 URL → engineSetServer 清 watermark）。
    this.currentEngineUrl = null;
    await this.ensureEngine();

    this.notifyListeners();
    if (this.tickTimer === null) this.scheduleNextTick();
    this.restartSse();
    void this.reconverge();
  }

  /** 网络路由变化：清引擎退避 + 重解析 live URL + 重连 SSE + 立即收敛。 */
  handleNetworkChanged(): void {
    void (async () => {
      if (this.engineConstructed) {
        try {
          await engineHandleNetworkRouteChanged();
        } catch (e: any) {
          log.error('[SyncEngine] engineHandleNetworkRouteChanged threw:', e?.message ?? e);
        }
      }
      // 路由切换后网络偏好可能翻转 → 重解析可能选中另一候选 URL。
      await this.ensureEngine();
      this.restartSse();
      void this.reconverge();
    })();
  }

  // -- 状态访问 --

  getStatus(): SyncEngineStatus {
    return {
      state: this.state,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      isExplicitlyRefreshing: this.isExplicitlyRefreshing,
      stagedEntry: this.stagedEntry,
    };
  }

  addListener(listener: SyncEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -- 核心：push / pull / reconverge --

  /**
   * 立即收敛一次：有本地内容且允许自动推送就 push（内部含 get_latest，双向覆盖），
   * 否则显式 pull 拉服务端最新。用于 start / 服务器切换 / 网络变化后重建 watermark。
   */
  private async reconverge(): Promise<void> {
    const device = await this.safeGetDevice();
    if (device && this.getSettings().autoPushLocal) {
      await this.runPush();
    } else {
      await this.runPull({ tag: 'Explicit' });
    }
  }

  /** push 单飞合并入口。 */
  private async runPush(): Promise<void> {
    if (this.pushInFlight) {
      this.pushPending = true;
      return;
    }
    this.pushInFlight = true;
    try {
      do {
        this.pushPending = false;
        await this.pushLocal();
      } while (this.pushPending);
    } finally {
      this.pushInFlight = false;
    }
  }

  /** pull 单飞合并入口（pending 取更强触发）。 */
  private async runPull(trigger: PullTrigger): Promise<void> {
    if (this.pullInFlight) {
      if (
        this.pendingPullTrigger === null ||
        triggerRank(trigger) > triggerRank(this.pendingPullTrigger)
      ) {
        this.pendingPullTrigger = trigger;
      }
      return;
    }
    this.pullInFlight = true;
    try {
      let t: PullTrigger | null = trigger;
      while (t) {
        await this.pullServer(t);
        t = this.pendingPullTrigger;
        this.pendingPullTrigger = null;
      }
    } finally {
      this.pullInFlight = false;
      this.pendingPullTrigger = null;
    }
  }

  private async pushLocal(): Promise<void> {
    // 自动推送关（consent 模式）：本地内容留在本地，不自动上传。
    if (!this.getSettings().autoPushLocal) return;
    if (!(await this.ensureEngine())) return;
    const device = await this.safeGetDevice();
    if (!device) return;

    let content: LocalContent;
    try {
      content = await this.buildLocalContent(device);
    } catch (e: any) {
      log.error('[SyncEngine] buildLocalContent failed:', e?.message ?? e);
      return;
    }

    let outcome: SyncOutcome;
    try {
      outcome = await enginePush(content);
    } catch (e: any) {
      this.handleOpThrow(e);
      return;
    }
    await this.applyOutcome(outcome, false);
  }

  private async pullServer(trigger: PullTrigger): Promise<void> {
    const server = this.getActiveServer();
    if (!server) {
      this.setState('Idle');
      this.notifyListeners();
      return;
    }
    if (!(await this.ensureEngine())) return;
    const device = await this.safeGetDevice();
    const deviceHash = device?.hash ?? null;

    let outcome: SyncOutcome;
    try {
      outcome = await enginePull(trigger, deviceHash);
    } catch (e: any) {
      this.handleOpThrow(e);
      return;
    }
    await this.applyOutcome(outcome, trigger.tag !== 'Routine');
  }

  /**
   * 翻译 SyncOutcome 到历史行 / 剪贴板写回 / UI 状态。
   * @param explicit 触发是否为显式（Explicit/SSE/push）——仅影响遥测日志措辞。
   */
  private async applyOutcome(outcome: SyncOutcome, _explicit: boolean): Promise<void> {
    switch (outcome.tag) {
      case 'Uploaded':
        await this.markHistoryPushed(outcome.meta.hash);
        this.onSyncSuccess();
        break;

      case 'Applied':
        await this.applyAppliedOutcome(outcome.content, outcome.meta);
        this.onSyncSuccess();
        break;

      case 'Staged':
        this.stagedEntry = this.previewToMeta(outcome.preview);
        this.clearOffline();
        this.setState('HasNewUnwritten');
        this.lastSyncedAt = Date.now();
        this.lastError = null;
        break;

      case 'UpToDate':
        this.onSyncSuccess();
        break;

      case 'BackingOff':
        // 例行 tick 被同步操作退避挡下：按 retryAfterMs 排下次 Routine，不重试。
        this.nextTickOverrideMs = Math.max(0, outcome.retryAfterMs);
        log.debug('[SyncEngine] BackingOff ' + outcome.retryAfterMs + 'ms');
        break;

      case 'LoopDetected':
        this.tripLoopBreaker();
        break;

      case 'Failed':
        this.handleFailed(outcome.error);
        break;
    }
    this.notifyListeners();
  }

  private async applyAppliedOutcome(content: LocalContent, meta: SyncedMeta): Promise<void> {
    const payload = coercePayload(content.payload);
    const clipMeta: ClipboardMeta = {
      kind: meta.kind,
      text: content.text ?? meta.text ?? '',
      dataName: content.dataName ?? null,
      hasData: payload != null,
      size: meta.size ?? payload?.byteLength ?? content.text?.length ?? 0,
      hash: meta.hash,
      contentId: meta.contentId,
    };
    try {
      await this.applyToDevice(clipMeta, payload ?? undefined);
      log.info('[SyncEngine] applied server->device: kind=' + clipMeta.kind);
    } catch (e: any) {
      // 写回失败按错误处理；引擎已乐观置 last_applied，下次 pull 会重试应用。
      log.error('[SyncEngine] applyToDevice failed:', e?.message ?? e);
      this.handleFailed(e?.message ?? 'apply failed');
    }
  }

  private onSyncSuccess(): void {
    this.stagedEntry = null;
    this.clearOffline();
    this.setState('Succeeded');
    this.lastSyncedAt = Date.now();
    this.lastError = null;
  }

  private clearOffline(): void {
    this.offlineTicks = 0;
    if (this.isOffline) {
      this.isOffline = false;
      log.info('[SyncEngine] server reachable again — back online');
    }
  }

  private handleOpThrow(e: any): void {
    // FFI 边界抛出（native 异常）——按普通失败翻译。
    this.handleFailed(e?.message ?? String(e));
    this.notifyListeners();
  }

  private handleFailed(error: string): void {
    const kind = this.classifyError(error);

    // 取消（切服务器 / 网络路由变更主动 abort）属预期，不记日志、不改状态。
    if (kind === 'Cancelled') return;

    if (kind === 'AuthFailed') {
      log.error('[SyncEngine] op error (auth):', error);
      this.setState('AuthFailed');
      this.lastError = error || 'Authentication failed';
      this.stop();
      return;
    }

    if (this.isOfflineKind(kind)) {
      if (!this.isOffline) {
        this.isOffline = true;
        log.info('[SyncEngine] server unreachable — offline, will keep retrying:', error);
      }
      this.offlineTicks += 1;
      this.setState('OfflineRetrying');
      this.lastError = error || 'Network error';
      // 连续离线 → 轮换候选 URL 做故障转移（离线期清 watermark 无害）。
      if (this.offlineTicks >= OFFLINE_URL_ROTATE_AFTER) {
        void this.ensureEngine(true);
      }
    } else {
      log.error('[SyncEngine] op error:', error);
      this.setState('OfflineRetrying');
      this.lastError = error || 'Sync error';
    }
  }

  private async markHistoryPushed(hash: string | null): Promise<void> {
    if (!hash) return;
    try {
      const { useHistoryStore } = require('@/stores/historyStore');
      await useHistoryStore.getState().updateItem(hash, {
        syncStatus: HistorySyncStatus.Synced,
        hasRemoteData: false,
      });
    } catch (e) {
      log.error('[SyncEngine] Failed to mark pushed history item:', e);
    }
  }

  // -- 内容构建 helpers --

  private async buildLocalContent(device: DeviceClipboard): Promise<LocalContent> {
    const meta = device.meta;
    let payload: ArrayBuffer | undefined = device.payload;
    // 截图等本地内容只有 fileUri 没有 fileData，push 前按需读取字节。
    // fileUri 可能指向已被移入历史目录的临时文件，回退用 hash 定位。
    if (meta.hasData && meta.dataName && !payload) {
      const { File } = await import('expo-file-system');
      let uri = device.fileUri;
      if (!uri || !new File(uri).exists) {
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        uri = (await getHistoryFileUri(meta.kind, meta.hash ?? '', meta.dataName)) ?? undefined;
      }
      if (uri && new File(uri).exists) {
        payload = await new File(uri).arrayBuffer();
      }
    }
    return {
      kind: meta.kind,
      text: meta.text ?? '',
      dataName: meta.dataName ?? null,
      // Uint8Array 匹配 native Data/ByteArray 编组（裸 ArrayBuffer 会失败）。
      payload: payload ? new Uint8Array(payload) : null,
    };
  }

  /**
   * 读一条历史记录的文件字节（供 pushRecordExplicit）。Text（无 data）返回 null。
   * File/Image 按 fileUri 读，fileUri 失效时回退用 hash + 原始 dataName 定位历史目录文件；
   * 字节确实缺失则抛错（交调用方重试）。
   */
  private async readRecordPayload(item: ClipboardItem): Promise<Uint8Array | null> {
    if (!(item.hasData && item.dataName)) return null;
    const { File } = await import('expo-file-system');
    let uri = item.fileUri;
    if (!uri || !new File(uri).exists) {
      const { getHistoryFileUri } = await import('@/utils/fileStorage');
      // ClipboardContentType 与 ClipboardKind 同域（Text/Image/File/Group），直接透传。
      uri =
        (await getHistoryFileUri(item.type, item.profileHash ?? '', item.dataName)) ?? undefined;
    }
    if (uri && new File(uri).exists) {
      // Uint8Array 匹配 native Data/ByteArray 编组（裸 ArrayBuffer 会失败）。
      return new Uint8Array(await new File(uri).arrayBuffer());
    }
    throw new Error('file bytes missing for record: ' + item.profileHash);
  }

  private previewToMeta(preview: StagedPreview): ClipboardMeta {
    return {
      kind: preview.kind,
      text: preview.text,
      dataName: null,
      hasData: preview.kind !== 'Text',
      size: preview.size ?? preview.text.length,
      hash: null,
      contentId: null,
    };
  }

  private async safeGetDevice(): Promise<DeviceClipboard | null> {
    try {
      return await this.getDeviceClipboard();
    } catch (e: any) {
      log.error('[SyncEngine] getDeviceClipboard failed:', e?.message ?? e);
      return null;
    }
  }

  // -- 路由 helpers（SSE 走 RN 侧多 URL 选择）--

  private async withActiveRoute<T>(
    server: ActiveServerInfo,
    operation: (route: SelectedServerRoute) => Promise<T>
  ): Promise<T> {
    return (
      await selectServerUrl(
        this.toAppServerConfig(server),
        {
          network: getCurrentNetworkContext(),
          loadLiveUrl: loadServerRouteLiveUrl,
          saveLiveUrl: saveServerRouteLiveUrl,
        },
        operation
      )
    ).result;
  }

  private toAppServerConfig(server: ActiveServerInfo): AppServerConfig {
    const urls = server.urls && server.urls.length > 0 ? server.urls : [server.baseUrl];
    return {
      type: 'syncclipboard',
      url: server.baseUrl,
      urls,
      username: server.username,
      password: server.password,
    };
  }

  private toUcServer(route: SelectedServerRoute): UcServerConfig {
    return {
      baseUrl: route.url,
      username: route.server.username ?? '',
      password: route.server.password ?? '',
    };
  }

  // -- tick 调度 --

  private scheduleNextTick(): void {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    if (this.state === 'AuthFailed' || this.state === 'LoopDetected') {
      this.tickTimer = null;
      return;
    }
    // SSE 在线时下行由推送接管，周期 tick 降为 30s 兜底；断开/回退时恢复 1Hz。
    const activeCadenceSecs = this.sseConnected
      ? SSE_FALLBACK_CADENCE_SECS
      : this.syncConfig.normalCadenceSecs;
    const cadenceMs = this.isSceneInactive
      ? this.syncConfig.inactiveCadenceSecs * 1000
      : activeCadenceSecs * 1000;
    // BackingOff 覆盖（一次性）：按引擎给的 retryAfterMs 排下一次 Routine。
    const interval =
      this.nextTickOverrideMs !== null ? Math.max(this.nextTickOverrideMs, cadenceMs) : cadenceMs;
    this.nextTickOverrideMs = null;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      void this.onRoutineTick();
    }, interval);
  }

  private async onRoutineTick(): Promise<void> {
    try {
      await this.runPull({ tag: 'Routine' });
    } finally {
      this.scheduleNextTick();
    }
  }

  private setState(s: SyncEngineState): void {
    this.state = s;
  }

  private tripLoopBreaker(): void {
    if (this.state === 'LoopDetected') return;
    this.setState('LoopDetected');
    this.lastError = 'Sync loop detected — same content alternated too many times';
    this.stop();
  }

  private classifyError(error: string): ErrorKind {
    const msg = (error ?? '').toLowerCase();
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('auth')) {
      return 'AuthFailed';
    }
    if (msg.includes('cancel') || (msg.includes('abort') && !msg.includes('connection abort'))) {
      return 'Cancelled';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return msg.includes('connect') ? 'ConnectTimeout' : 'ReceiveTimeout';
    }
    if (
      msg.includes('network') ||
      msg.includes('unreachable') ||
      msg.includes('offline') ||
      msg.includes('econnrefused') ||
      msg.includes('connection refused') ||
      msg.includes('connection reset') ||
      msg.includes('connection abort') ||
      msg.includes('connection closed') ||
      msg.includes('connection lost') ||
      msg.includes('could not connect') ||
      msg.includes('cannot connect') ||
      msg.includes('failed to connect') ||
      msg.includes('trying to connect') ||
      msg.includes('tcp connect') ||
      msg.includes('error sending request') ||
      msg.includes('no route to host') ||
      msg.includes('could not be found') ||
      msg.includes('enotfound') ||
      msg.includes('dns') ||
      msg.includes('socket')
    ) {
      return 'NetworkUnreachable';
    }
    return 'OtherSyncError';
  }

  /** 该错误类型是否属于"服务器不可达/离线"——预期状态，日志上不当作 error。 */
  private isOfflineKind(kind: ErrorKind): boolean {
    return kind === 'NetworkUnreachable' || kind === 'ConnectTimeout' || kind === 'ReceiveTimeout';
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // swallow listener errors
      }
    }
  }
}

/** 引擎 Applied 回传的 payload（ArrayBuffer/Uint8Array/null）归一成 ArrayBuffer。 */
function coercePayload(payload: ArrayBuffer | Uint8Array | null | undefined): ArrayBuffer | null {
  if (!payload) return null;
  if (payload instanceof ArrayBuffer) return payload;
  // Uint8Array → 取其底层 buffer 的精确切片。
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength
  ) as ArrayBuffer;
}
