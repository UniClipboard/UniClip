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
  putFile,
  getFile,
  queryHistory,
  cancelInFlight,
  hashesEqual,
} from 'uc-core';
import type { ServerConfig as UcServerConfig, HistoryRecord } from 'uc-core';

const LAST_SYNCED_HASH_KEY = '@syncengine:last_synced_hash';
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
  username: string;
  password: string;
  trustInsecureCert: boolean;
}

export interface DeviceClipboard {
  hash: string | null;
  meta: ClipboardMeta;
  payload?: ArrayBuffer;
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
  private getPersistedSyncedHash: () => Promise<string | null>;
  private persistSyncedHash: (hash: string | null) => Promise<void>;

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

    this.getPersistedSyncedHash = () => AsyncStorage.getItem(LAST_SYNCED_HASH_KEY);
    this.persistSyncedHash = async (hash) => {
      if (hash) {
        await AsyncStorage.setItem(LAST_SYNCED_HASH_KEY, hash);
      } else {
        await AsyncStorage.removeItem(LAST_SYNCED_HASH_KEY);
      }
    };
  }

  async init(): Promise<void> {
    const [savedHash, savedHistoryMs] = await Promise.all([
      this.getPersistedSyncedHash(),
      AsyncStorage.getItem(LAST_HISTORY_SYNC_KEY),
    ]);
    if (savedHash) {
      this.runtimeState = { ...this.runtimeState, lastSyncedHash: savedHash };
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
    this.setState('Idle');
    this.lastError = null;
    await this.persistSyncedHash(null);
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
    console.log('[SyncEngine] doTick: explicit=' + explicit + ' server=' + (server ? server.baseUrl : 'null') + ' device=' + (device?.hash?.slice(0, 8) ?? 'null') + ' autoApply=' + settings.autoApplyRemote + ' autoPush=' + settings.autoPushLocal);

    const persistedHash = await this.getPersistedSyncedHash();

    let step: PreambleStep;
    try {
      step = planPreamble(this.runtimeState, {
        explicit,
        autoPush: settings.autoPushLocal,
        hasActiveServer: server !== null,
        deviceHash: device?.hash ?? null,
        historyHeadHash: null,
        persistedSyncedHash: persistedHash,
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

    const ucServer: UcServerConfig = {
      baseUrl: server.baseUrl,
      username: server.username,
      password: server.password,
    };

    try {
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

      let route: ServerRoute;
      try {
        route = planAfterServerGet(this.runtimeState, {
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

      console.log('[SyncEngine] tick: route=' + route.type +
        (route.type === 'Push' ? '(' + route.decision + ')' : '') +
        ' server=' + (serverEntry?.hash?.slice(0, 8) ?? 'null') +
        ' device=' + (device?.hash?.slice(0, 8) ?? 'null'));

      switch (route.type) {
        case 'Converged':
          this.runtimeState = commitConverged(this.runtimeState, route.serverHash);
          this.stagedEntry = null;
          this.setState('Succeeded');
          this.lastSyncedAt = Date.now();
          this.lastError = null;
          break;

        case 'ServerNew':
          console.log('[SyncEngine] ServerNew: willApply=' + route.plan.willApply + ' alreadyStaged=' + route.plan.alreadyStaged);
          await this.processServerNew(serverEntry!, route.plan, ucServer, server.trustInsecureCert);
          break;

        case 'Push':
          await this.maybePush(route.decision, device, ucServer, server.trustInsecureCert);
          break;
      }

      this.runHistorySyncIfDue(ucServer, server.trustInsecureCert).catch(() => {});

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
        console.log('[SyncEngine] applying server→device: kind=' + entry.kind + ' hash=' + (entry.hash?.slice(0, 8) ?? 'null') + ' hasData=' + entry.hasData);
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
        Date.now(),
        this.syncConfig
      );
      this.runtimeState = step.state;
      this.stagedEntry = null;
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

        if (device.meta.hasData && device.meta.dataName && device.payload) {
          await putFile(server, device.meta.dataName, device.payload, trustInsecureCert);
        }
        await putClipboard(server, device.meta, device.payload, trustInsecureCert);

        const step: CommitStep = commitPush(
          this.runtimeState,
          device.meta.hash,
          Date.now(),
          this.syncConfig
        );
        this.runtimeState = step.state;

        this.setState('Succeeded');
        if (step.outcome.tripped) {
          this.tripLoopBreaker();
          return;
        }
        this.lastSyncedAt = Date.now();
        this.lastError = null;
        break;
    }
  }

  // -- History sync --

  private async runHistorySyncIfDue(
    server: UcServerConfig,
    trustInsecureCert: boolean
  ): Promise<void> {
    if (!isHistorySyncDue(this.lastHistorySyncAt, Date.now(), this.syncConfig.historySyncIntervalSecs)) {
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

  private async persistRuntimeHash(): Promise<void> {
    const hash = this.runtimeState.lastSyncedHash;
    await this.persistSyncedHash(hash);
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
