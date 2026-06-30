/**
 * SyncEngine — Rust reducer-driven clipboard sync state machine.
 *
 * Mirrors iOS SyncEngine.swift: 1Hz foreground tick that converges device
 * and server clipboards automatically. All sync decisions route through the
 * Rust reducer (planPreamble / planAfterServerGet / commit*); this TypeScript
 * shell owns the I/O (network, clipboard, persistence) and UI state.
 *
 * Conflict resolution is server-wins: when both sides change inside the same
 * tick the server is processed first; the next tick's hash dedup prevents
 * echoing the applied content back.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLastSyncedHash, getLastSyncedContentId } from 'app-group-store';
import {
  type SyncRuntimeState,
  type SyncConfig,
  type SyncState,
  type ClipboardMeta,
  type PreambleStep,
  type ServerRoute,
  type CommitStep,
  type TickFailureStep,
  type TickErrorKind,
  defaultSyncConfig,
  defaultSyncRuntimeState,
  planPreamble,
  planAfterServerGet,
  commitConverged,
  commitApply,
  commitApplyFailed,
  commitStage,
  commitPush,
  commitPushSkipped,
  commitConsentPush,
  commitTickFailure,
  commitHistorySyncDone,
  markStagedApplied,
  acknowledgeLoopDetection,
  resetRuntimeState,
  handleActiveServerChanged,
  handleNetworkRouteChanged,
  isHistorySyncDue,
  isColdStart,
  advanceWatermark,
  getLatest,
  putClipboard,
  getFile,
  queryHistory,
  cancelInFlight,
  hashesEqual,
} from 'uc-core';
import type { ServerConfig as UcServerConfig, HistoryRecord } from 'uc-core';
import { getCurrentNetworkContext } from './networkContext';
import { loadServerRouteLiveUrl, saveServerRouteLiveUrl } from './serverRouteRecordStore';
import { selectServerUrl, type ServerRoute as SelectedServerRoute } from './serverRouteSelector';
import type { ServerConfig as AppServerConfig } from '@/types/api';
import { HistorySyncStatus } from '@/types/clipboard';

const LAST_SYNCED_HASH_KEY = '@syncengine:last_synced_hash';
const LAST_SYNCED_CONTENT_ID_KEY = '@syncengine:last_synced_content_id';
const LAST_HISTORY_SYNC_KEY = '@syncengine:last_history_sync_ms';

export type SyncEngineState = SyncState;

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
}

export class SyncEngine {
  private runtimeState: SyncRuntimeState;
  private syncConfig: SyncConfig;

  private state: SyncEngineState = 'Idle';
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private isExplicitlyRefreshing = false;
  private stagedEntry: ClipboardMeta | null = null;

  private lastAppliedContentHash: string | null = null;
  private lastWrittenContentHash: string | null = null;

  // 内容指纹幂等守卫：最近一次实际成功 PUT 的内容 hash。即便 reducer 因
  // commitPush 清空 contentId、跨进程 resync 或网络重置导致 lastSyncedHash
  // 漂移而重新判定 DoPush，只要内容指纹未变（且服务端尚未确认 → 未 Converged、
  // 也未被服务端新内容覆盖）就跳过 PUT，根治「同一未变内容被周期性重复回写」。
  // Converged / apply 新内容 / 换服务器时清空，保证 A→B→A 这类「复制回旧内容」
  // 仍能正常重推。纯内存态：进程不会每分钟重启，足以拦住稳态重复。
  private lastPushedContentHash: string | null = null;

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private isTicking = false;
  private isSceneInactive = false;
  private isHistorySyncing = false;
  private lastHistorySyncAt: number | null = null;

  private listeners = new Set<SyncEngineListener>();

  private getActiveServer: () => ActiveServerInfo | null;
  private getDeviceClipboard: () => DeviceClipboard | null;
  private getSettings: () => SyncSettings;
  private applyToDevice: (meta: ClipboardMeta, payload?: ArrayBuffer) => Promise<void>;
  private onHistoryRecord: ((record: HistoryRecord) => void) | null = null;
  // hash 与 contentId 作为同一水位线快照：原子同写同清（doc §4 / §契约 3）。
  private getPersistedSynced: () => Promise<{ hash: string | null; contentId: string | null }>;
  private persistSynced: (hash: string | null, contentId: string | null) => Promise<void>;

  constructor(opts: {
    getActiveServer: () => ActiveServerInfo | null;
    getDeviceClipboard: () => DeviceClipboard | null;
    getSettings: () => SyncSettings;
    applyToDevice: (meta: ClipboardMeta, payload?: ArrayBuffer) => Promise<void>;
    onHistoryRecord?: (record: HistoryRecord) => void;
  }) {
    this.getActiveServer = opts.getActiveServer;
    this.getDeviceClipboard = opts.getDeviceClipboard;
    this.getSettings = opts.getSettings;
    this.applyToDevice = opts.applyToDevice;
    this.onHistoryRecord = opts.onHistoryRecord ?? null;
    this.syncConfig = defaultSyncConfig();
    this.runtimeState = defaultSyncRuntimeState();

    this.getPersistedSynced = async () => {
      const pairs = await AsyncStorage.multiGet([LAST_SYNCED_HASH_KEY, LAST_SYNCED_CONTENT_ID_KEY]);
      const map = new Map(pairs);
      const hash = map.get(LAST_SYNCED_HASH_KEY) ?? null;
      const contentId = map.get(LAST_SYNCED_CONTENT_ID_KEY) ?? null;
      let appGroupHash: string | null = null;
      let appGroupContentId: string | null = null;
      try {
        [appGroupHash, appGroupContentId] = await Promise.all([
          getLastSyncedHash(),
          getLastSyncedContentId(),
        ]);
      } catch {
        appGroupHash = null;
        appGroupContentId = null;
      }
      const adoptAppGroup = !!(appGroupHash && !hashesEqual(appGroupHash, hash));
      if (adoptAppGroup) {
        // An extension (keyboard / share) advanced the cross-process
        // watermark. Adopt ITS contentId snapshot, not null: the keyboard
        // learns the server identity post-push and writes the pair, so the
        // re-encoded GET dedups here too. It's null for legacy servers or a
        // bare push not yet re-learned — falling back to hash compare, which
        // is correct.
        return {
          hash: appGroupHash,
          contentId: appGroupContentId,
        };
      }
      return {
        hash,
        contentId,
      };
    };
    this.persistSynced = async (hash, contentId) => {
      // hash 与 contentId 一起落盘 / 一起清空，二者保持一致（reducer 已保证
      // SyncRuntimeState 内两键同步，此处只负责一起读写）。
      const sets: [string, string][] = [];
      const removes: string[] = [];
      if (hash) sets.push([LAST_SYNCED_HASH_KEY, hash]);
      else removes.push(LAST_SYNCED_HASH_KEY);
      if (contentId) sets.push([LAST_SYNCED_CONTENT_ID_KEY, contentId]);
      else removes.push(LAST_SYNCED_CONTENT_ID_KEY);
      if (sets.length) await AsyncStorage.multiSet(sets);
      if (removes.length) await AsyncStorage.multiRemove(removes);
    };
  }

  async init(): Promise<void> {
    const [saved, savedHistoryMs] = await Promise.all([
      this.getPersistedSynced(),
      AsyncStorage.getItem(LAST_HISTORY_SYNC_KEY),
    ]);
    if (saved.hash || saved.contentId) {
      this.runtimeState = {
        ...this.runtimeState,
        lastSyncedHash: saved.hash,
        lastSyncedContentId: saved.contentId,
      };
    }
    this.lastHistorySyncAt = savedHistoryMs ? parseInt(savedHistoryMs, 10) : null;
  }

  // -- Lifecycle --

  start(): void {
    if (this.tickTimer !== null) return;
    if (this.state === 'AuthFailed') this.setState('Idle');
    if (this.state === 'LoopDetected') return;
    console.log('[SyncEngine] start: scheduling tick loop');
    this.scheduleNextTick();
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setSceneInactive(inactive: boolean): void {
    this.isSceneInactive = inactive;
  }

  async forceTickNow(): Promise<void> {
    await this.tick(true);
  }

  async explicitRefresh(): Promise<void> {
    this.isExplicitlyRefreshing = true;
    this.notifyListeners();
    try {
      await this.tick(true);
    } finally {
      this.isExplicitlyRefreshing = false;
      this.notifyListeners();
    }
  }

  // -- State accessors --

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

  noteReapplyWritten(deviceHash: string | null): void {
    if (!deviceHash) return;
    this.lastAppliedContentHash = deviceHash.toUpperCase();
  }

  noteDeviceWrite(hash: string | null): void {
    if (!hash) return;
    this.lastWrittenContentHash = hash.toUpperCase();
  }

  notifyDeviceChanged(hash: string | null): void {
    this.noteDeviceWrite(hash);
    if (this.state === 'AuthFailed' || this.state === 'LoopDetected') return;
    void this.forceTickNow();
  }

  async applyStagedEntry(): Promise<void> {
    const step = markStagedApplied(this.runtimeState);
    if (!step.wasStaged) return;
    this.runtimeState = step.state;
    this.stagedEntry = null;
    this.setState('Succeeded');
    this.lastSyncedAt = Date.now();
    this.lastError = null;
    await this.persistRuntimeHash();
    this.notifyListeners();
  }

  async acknowledgeLoop(): Promise<void> {
    this.runtimeState = acknowledgeLoopDetection(this.runtimeState);
    this.setState('Idle');
    this.lastError = null;
    this.notifyListeners();
    this.start();
  }

  async handleServerChanged(): Promise<void> {
    this.runtimeState = handleActiveServerChanged(this.runtimeState);
    this.stagedEntry = null;
    this.lastPushedContentHash = null;
    this.setState('Idle');
    this.lastError = null;
    await this.persistSynced(null, null);
    this.lastHistorySyncAt = null;
    await AsyncStorage.removeItem(LAST_HISTORY_SYNC_KEY);
    this.notifyListeners();
    this.start();
    this.forceTickNow();
  }

  handleNetworkChanged(): void {
    cancelInFlight();
    this.runtimeState = handleNetworkRouteChanged(this.runtimeState);
  }

  handleEndpointChanged(): void {
    cancelInFlight();
    this.runtimeState = handleNetworkRouteChanged(this.runtimeState);
    this.forceTickNow();
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  // -- Core tick --

  private async tick(explicit = false): Promise<void> {
    if (!explicit && this.isTicking) return;
    if (explicit) {
      while (this.isTicking) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    this.isTicking = true;
    try {
      await this.doTick(explicit);
    } finally {
      this.isTicking = false;
      this.scheduleNextTick();
    }
  }

  private async doTick(explicit: boolean): Promise<void> {
    const server = this.getActiveServer();
    const device = this.getDeviceClipboard();
    const settings = this.getSettings();
    console.log(
      '[SyncEngine] doTick: explicit=' +
        explicit +
        ' server=' +
        (server ? server.baseUrl : 'null') +
        ' device=' +
        (device?.hash?.slice(0, 8) ?? 'null') +
        ' autoApply=' +
        settings.autoApplyRemote +
        ' autoPush=' +
        settings.autoPushLocal
    );

    const persisted = await this.getPersistedSynced();
    // 纯本地（AsyncStorage）基线快照，供 server GET 后的"并集校正"判定：preamble
    // 可能用陈旧的 App Group 水位线把它顶掉，需要原样留底以便对比。
    const localSynced = await this.readLocalSynced();

    let step: PreambleStep;
    try {
      step = planPreamble(this.runtimeState, {
        explicit,
        autoPush: settings.autoPushLocal,
        hasActiveServer: server !== null,
        deviceHash: device?.hash ?? null,
        historyHeadHash: null,
        persistedSyncedHash: persisted.hash,
        persistedSyncedContentId: persisted.contentId,
        nowMs: Date.now(),
      });
    } catch (e: any) {
      console.error('[SyncEngine] planPreamble FFI error:', e?.message ?? e);
      return;
    }

    this.runtimeState = step.state;

    if (step.preamble.proceed.type === 'Stop') {
      console.log('[SyncEngine] preamble: Stop(' + step.preamble.proceed.reason + ')');
      if (step.preamble.proceed.reason === 'NoActiveServer') {
        this.setState('Idle');
        this.notifyListeners();
      }
      return;
    }

    if (!server) {
      this.setState('Idle');
      this.notifyListeners();
      return;
    }

    try {
      await this.withActiveRoute(server, async (route) => {
        const ucServer = this.toUcServer(route);
        let serverEntry: ClipboardMeta | null = null;
        try {
          serverEntry = await getLatest(ucServer, server.trustInsecureCert);
        } catch (e: any) {
          if (e?.message?.includes('404') || e?.message?.includes('Not Found')) {
            serverEntry = null;
          } else {
            throw e;
          }
        }

        // 服务端无内容时为兼容官方 SyncClipboard 协议会返回 200 + 空占位 entry
        // （type=Text, text="", hash=None, contentId=None），而非 404（见
        // uniclipboard 仓库 uc-webserver .../sync_doc.rs empty_text）。这种
        // hashless entry 会被 reducer 判成 ServerNew 但 will_apply=false（无 hash
        // 无法自动应用）→ stage → 卡死 HasNewUnwritten，永久阻塞 autoPush。既无
        // hash 又无 contentId 的 entry 没有任何可同步身份，归一化为「无内容」(null)
        // 让 reducer 走 Push 分支。真实内容服务端必填 hash（响应侧保证），不会误伤。
        if (serverEntry && !serverEntry.hash && !serverEntry.contentId) {
          console.log(
            '[SyncEngine] serverEntry is empty placeholder (no hash/contentId) — treating as no content'
          );
          serverEntry = null;
        }

        // 跨进程水位线"并集"校正（iOS）：preamble 可能用陈旧的 App Group 水位线
        // 顶掉本地已收敛基线（getPersistedSynced 的 ADOPT-APPGROUP 分支）。若服务端
        // 当前内容其实匹配本地基线（cid 优先 / hash 回退），说明 App Group 水位线更
        // 旧、应以本地为准——否则没变的服务端内容会被误判为 ServerNew，把设备上用户
        // 刚复制的新内容覆盖掉，且本地内容永远推不上去。App Group 确实更新的场景
        // （server 匹配 App Group 而非本地）不满足下面条件，照常走 apply，跨进程
        // contentId 去重能力不受影响。
        if (
          serverEntry &&
          !this.matchesBaseline(
            serverEntry.hash,
            serverEntry.contentId,
            this.runtimeState.lastSyncedHash,
            this.runtimeState.lastSyncedContentId
          ) &&
          this.matchesBaseline(
            serverEntry.hash,
            serverEntry.contentId,
            localSynced.hash,
            localSynced.contentId
          )
        ) {
          console.log(
            '[SyncEngine] baseline reconcile: server matches LOCAL baseline, dropping stale app-group watermark (' +
              (this.runtimeState.lastSyncedHash?.slice(0, 8) ?? 'null') +
              ' -> ' +
              (localSynced.hash?.slice(0, 8) ?? 'null') +
              ')'
          );
          this.runtimeState = {
            ...this.runtimeState,
            lastSyncedHash: localSynced.hash,
            lastSyncedContentId: localSynced.contentId,
          };
        }

        let plannedRoute: ServerRoute;
        try {
          plannedRoute = planAfterServerGet(this.runtimeState, {
            autoApply: settings.autoApplyRemote,
            autoPush: settings.autoPushLocal,
            serverEntry,
            devicePresent: device !== null,
            deviceHash: device?.hash ?? null,
          });
        } catch (e: any) {
          console.error('[SyncEngine] planAfterServerGet FFI error:', e?.message ?? e);
          return;
        }

        console.log(
          '[SyncEngine] tick: route=' +
            plannedRoute.type +
            (plannedRoute.type === 'Push' ? '(' + plannedRoute.decision + ')' : '') +
            ' server=' +
            (serverEntry?.hash?.slice(0, 8) ?? 'null') +
            ' device=' +
            (device?.hash?.slice(0, 8) ?? 'null')
        );

        switch (plannedRoute.type) {
          case 'Converged':
            // 学到 contentId 的主路径：push 后第一次 GET、设备剪贴板仍是刚 push 的
            // 内容时走这里，传 server entry 的 contentId（doc §3 步骤 2）。
            this.runtimeState = commitConverged(
              this.runtimeState,
              plannedRoute.serverHash,
              serverEntry?.contentId ?? null
            );
            this.stagedEntry = null;
            // 服务端已确认收到当前内容，释放幂等守卫：将来即便剪贴板内容变回这份旧
            // 内容（A→B→A），也应允许重新 push。
            this.lastPushedContentHash = null;
            this.setState('Succeeded');
            this.lastSyncedAt = Date.now();
            this.lastError = null;
            break;

          case 'ServerNew':
            console.log(
              '[SyncEngine] ServerNew: willApply=' +
                plannedRoute.plan.willApply +
                ' alreadyStaged=' +
                plannedRoute.plan.alreadyStaged
            );
            await this.processServerNew(
              serverEntry!,
              plannedRoute.plan,
              ucServer,
              server.trustInsecureCert
            );
            break;

          case 'Push':
            await this.maybePush(
              plannedRoute.decision,
              device,
              ucServer,
              server.trustInsecureCert
            );
            break;
        }

        this.runHistorySyncIfDue(ucServer, server.trustInsecureCert).catch(() => {});
      });

      await this.persistRuntimeHash();
      this.notifyListeners();
    } catch (e: any) {
      console.error('[SyncEngine] tick error:', e?.message ?? e);
      const kind = this.classifyError(e);

      if (kind === 'AuthFailed') {
        this.setState('AuthFailed');
        this.lastError = e?.message ?? 'Authentication failed';
        this.stop();
        this.notifyListeners();
        return;
      }

      if (kind === 'Cancelled') {
        return;
      }

      let failStep: TickFailureStep;
      try {
        failStep = commitTickFailure(
          this.runtimeState,
          kind,
          Math.random() * 0.4 + 0.8,
          Date.now(),
          this.syncConfig
        );
      } catch (ffiErr: any) {
        console.error('[SyncEngine] commitTickFailure FFI error:', ffiErr?.message ?? ffiErr);
        this.setState('OfflineRetrying');
        this.lastError = e?.message ?? 'Network error';
        this.notifyListeners();
        return;
      }
      this.runtimeState = failStep.state;
      this.setState('OfflineRetrying');
      this.lastError = e?.message ?? 'Network error';
      this.notifyListeners();
    }
  }

  private async processServerNew(
    entry: ClipboardMeta,
    plan: { willApply: boolean; alreadyStaged: boolean },
    server: UcServerConfig,
    trustInsecureCert: boolean
  ): Promise<void> {
    if (plan.willApply) {
      try {
        console.log(
          '[SyncEngine] applying server→device: kind=' +
            entry.kind +
            ' hash=' +
            (entry.hash?.slice(0, 8) ?? 'null') +
            ' hasData=' +
            entry.hasData
        );
        let payload: ArrayBuffer | undefined;
        if (entry.hasData && entry.dataName) {
          payload = await getFile(server, entry.dataName, trustInsecureCert);
        }
        await this.applyToDevice(entry, payload);
        this.noteDeviceWrite(entry.hash);
        console.log('[SyncEngine] apply success');
      } catch (e: any) {
        this.runtimeState = commitApplyFailed(this.runtimeState, entry);
        this.stagedEntry = entry;
        throw e;
      }

      const step: CommitStep = commitApply(
        this.runtimeState,
        entry.hash,
        entry.contentId,
        Date.now(),
        this.syncConfig
      );
      this.runtimeState = step.state;
      this.stagedEntry = null;
      // 本地已被服务端新内容覆盖，旧的 push 指纹失效。
      this.lastPushedContentHash = null;
      this.setState('Succeeded');
      this.lastSyncedAt = Date.now();
      this.lastError = null;

      if (step.outcome.tripped) {
        this.tripLoopBreaker();
      }
    } else if (!plan.alreadyStaged) {
      this.runtimeState = commitStage(this.runtimeState, entry);
      this.stagedEntry = entry;
      this.setState('HasNewUnwritten');
      this.lastSyncedAt = Date.now();
      this.lastError = null;
    }
  }

  private async maybePush(
    decision: string,
    device: DeviceClipboard | null,
    server: UcServerConfig,
    trustInsecureCert: boolean
  ): Promise<void> {
    switch (decision) {
      case 'SkipConsentMode':
      case 'SkipNoDevice':
        this.runtimeState = commitPushSkipped(this.runtimeState);
        this.setState('Succeeded');
        this.lastError = null;
        break;

      case 'SkipAlreadySynced':
      case 'SkipSelfWritten':
        this.runtimeState = commitPushSkipped(this.runtimeState);
        this.setState('Succeeded');
        this.lastSyncedAt = Date.now();
        this.lastError = null;
        break;

      case 'DoPush':
        if (!device) {
          this.runtimeState = commitPushSkipped(this.runtimeState);
          this.setState('Succeeded');
          this.lastError = null;
          return;
        }

        // 内容指纹幂等守卫（治本）：reducer 因 lastSyncedHash 漂移（contentId 清空 /
        // 跨进程 resync / 网络重置）而重新判定 DoPush 时，若内容指纹与最近一次成功
        // PUT 相同——即服务端尚未确认（未 Converged）、本地也未被新内容覆盖——说明
        // 这是同一份没变的内容被周期性回写，直接跳过，避免 mac 端反复弹「正在接收」。
        const pushFingerprint = device.meta.hash?.toUpperCase() ?? null;
        if (pushFingerprint && pushFingerprint === this.lastPushedContentHash) {
          console.log(
            '[SyncEngine] DoPush skipped by content-fingerprint guard: ' +
              pushFingerprint.slice(0, 8)
          );
          this.runtimeState = commitPushSkipped(this.runtimeState);
          this.setState('Succeeded');
          this.lastSyncedAt = Date.now();
          this.lastError = null;
          return;
        }

        let payload: ArrayBuffer | undefined = device.payload;
        // 截图等本地内容只有 fileUri 没有 fileData，push 前按需读取字节。
        // fileUri 可能指向已被移入历史目录的临时文件，回退用 profileHash 定位。
        if (device.meta.hasData && device.meta.dataName && !payload) {
          const { File } = await import('expo-file-system');
          let uri = device.fileUri;
          if (!uri || !new File(uri).exists) {
            const { getHistoryFileUri } = await import('@/utils/fileStorage');
            uri =
              (await getHistoryFileUri(
                device.meta.kind,
                device.meta.hash ?? '',
                device.meta.dataName
              )) ?? undefined;
          }
          if (uri && new File(uri).exists) {
            payload = await new File(uri).arrayBuffer();
          }
        }
        // putClipboard 内部按 spec §3.5 先 PUT /file 再 PUT 元数据，无需单独 putFile。
        // payload 转 Uint8Array 以匹配 native Data 参数的编组要求（裸 ArrayBuffer 会失败）。
        const payloadBytes = payload ? new Uint8Array(payload) : undefined;
        try {
          await putClipboard(server, device.meta, payloadBytes, trustInsecureCert);
        } catch (e: any) {
          console.error(
            '[SyncEngine] putClipboard failed: kind=' +
              device.meta.kind +
              ' dataName=' +
              device.meta.dataName +
              ' bytes=' +
              (payloadBytes?.byteLength ?? 0) +
              ' err=' +
              (e?.message ?? e)
          );
          throw e;
        }

        const step: CommitStep = commitPush(
          this.runtimeState,
          device.meta.hash,
          Date.now(),
          this.syncConfig
        );
        this.runtimeState = step.state;
        // 记录本次实际发出的内容指纹，供后续 tick 的幂等守卫比对。
        this.lastPushedContentHash = device.meta.hash?.toUpperCase() ?? null;

        this.setState('Succeeded');
        if (step.outcome.tripped) {
          this.tripLoopBreaker();
          return;
        }
        await this.markHistoryPushed(device.meta.hash);
        this.lastSyncedAt = Date.now();
        this.lastError = null;
        break;
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
      console.error('[SyncEngine] Failed to mark pushed history item:', e);
    }
  }

  // -- History sync --

  private async runHistorySyncIfDue(
    server: UcServerConfig,
    trustInsecureCert: boolean
  ): Promise<void> {
    if (
      !isHistorySyncDue(this.lastHistorySyncAt, Date.now(), this.syncConfig.historySyncIntervalSecs)
    ) {
      return;
    }
    if (this.isHistorySyncing) return;
    this.isHistorySyncing = true;
    try {
      const watermarkMs = this.lastHistorySyncAt;
      const cold = isColdStart(watermarkMs);
      let maxModifiedMs = watermarkMs ?? 0;
      let page = 1;
      const maxPages = 50;

      while (page <= maxPages) {
        const records = await queryHistory(
          server,
          {
            page,
            modifiedAfterMs: watermarkMs ?? undefined,
          },
          trustInsecureCert
        );

        if (records.length === 0) break;

        for (const record of records) {
          this.onHistoryRecord?.(record);
          if (record.lastModifiedMs && record.lastModifiedMs > maxModifiedMs) {
            maxModifiedMs = record.lastModifiedMs;
          }
        }

        if (cold) break;
        page++;
      }

      const advanced = advanceWatermark(watermarkMs, maxModifiedMs);
      if (advanced !== null) {
        this.lastHistorySyncAt = advanced;
      }
    } finally {
      this.isHistorySyncing = false;
      this.runtimeState = commitHistorySyncDone(this.runtimeState, Date.now());
      if (this.lastHistorySyncAt) {
        await AsyncStorage.setItem(LAST_HISTORY_SYNC_KEY, String(this.lastHistorySyncAt));
      }
    }
  }

  // -- Helpers --

  private async withActiveRoute<T>(
    server: ActiveServerInfo,
    operation: (route: SelectedServerRoute) => Promise<T>
  ): Promise<T> {
    return (
      await selectServerUrl(this.toAppServerConfig(server), {
        network: getCurrentNetworkContext(),
        loadLiveUrl: loadServerRouteLiveUrl,
        saveLiveUrl: saveServerRouteLiveUrl,
      }, operation)
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

  private scheduleNextTick(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
    }
    if (this.state === 'AuthFailed' || this.state === 'LoopDetected') {
      this.tickTimer = null;
      return;
    }
    const interval = this.isSceneInactive
      ? this.syncConfig.inactiveCadenceSecs * 1000
      : this.syncConfig.normalCadenceSecs * 1000;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick(false);
    }, interval);
  }

  private setState(s: SyncEngineState): void {
    this.state = s;
  }

  private tripLoopBreaker(): void {
    if (this.state === 'LoopDetected') return;
    this.setState('LoopDetected');
    this.lastError = 'Sync loop detected — same content alternated too many times';
    this.stop();
    this.notifyListeners();
  }

  private classifyError(e: any): TickErrorKind {
    const msg = (e?.message ?? '').toLowerCase();
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('auth')) {
      return 'AuthFailed';
    }
    if (msg.includes('cancel') || msg.includes('abort')) {
      return 'Cancelled';
    }
    if (msg.includes('timeout')) {
      return msg.includes('connect') ? 'ConnectTimeout' : 'ReceiveTimeout';
    }
    if (msg.includes('network') || msg.includes('unreachable') || msg.includes('econnrefused')) {
      return 'NetworkUnreachable';
    }
    return 'OtherSyncError';
  }

  /** 只读本地 AsyncStorage 的同步水位线，不掺入 App Group（getPersistedSynced 会掺）。 */
  private async readLocalSynced(): Promise<{ hash: string | null; contentId: string | null }> {
    const pairs = await AsyncStorage.multiGet([LAST_SYNCED_HASH_KEY, LAST_SYNCED_CONTENT_ID_KEY]);
    const map = new Map(pairs);
    return {
      hash: map.get(LAST_SYNCED_HASH_KEY) ?? null,
      contentId: map.get(LAST_SYNCED_CONTENT_ID_KEY) ?? null,
    };
  }

  /**
   * 服务端 entry 是否匹配给定基线，镜像 reducer 的 is_already_synced：两侧都有
   * contentId 时只比 contentId（不透明、verbatim，跨重编码稳定），否则回退 hash 大写比较。
   */
  private matchesBaseline(
    serverHash: string | null,
    serverCid: string | null,
    baseHash: string | null,
    baseCid: string | null
  ): boolean {
    if (serverCid != null && baseCid != null) return serverCid === baseCid;
    if (serverHash == null && baseHash == null) return true;
    if (serverHash == null || baseHash == null) return false;
    return serverHash.toUpperCase() === baseHash.toUpperCase();
  }

  private async persistRuntimeHash(): Promise<void> {
    await this.persistSynced(
      this.runtimeState.lastSyncedHash,
      this.runtimeState.lastSyncedContentId
    );
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
