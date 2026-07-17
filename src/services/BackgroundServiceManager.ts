/**
 * BackgroundServiceManager
 * 统一管理所有 JS 侧后台服务的生命周期。
 *
 * 负责管理：
 * - ClipboardSyncService（远程内容显示、WebDAV/S3 轮询、SyncManager、自动上传/下载）
 * - 前台服务（常驻通知）
 * - 短信验证码服务
 * - 剪贴板监控（startMonitoring）
 * - 统计心跳
 * - 通知栏停止/临时停止监听
 *
 * 被 ServiceRestartApp、QuickActionApp、App（main）调用。
 * HomeScreen 不负责后台服务的启动与停止。
 */

import { AppState, Platform } from 'react-native';
import { log } from './Logger';
import { canAutoPushInBackground, shouldRunBackgroundSync } from '@/utils/syncDirectionPolicy';

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager | null = null;

  private running = false;
  private heartbeatTag: string | null = null;
  private stopSub: { remove(): void } | null = null;
  private tempStopSub: { remove(): void } | null = null;
  /** 取消对 settingsStore 的订阅 */
  private settingsUnsub: (() => void) | null = null;

  private constructor() {}

  static getInstance(): BackgroundServiceManager {
    if (!BackgroundServiceManager.instance) {
      BackgroundServiceManager.instance = new BackgroundServiceManager();
    }
    return BackgroundServiceManager.instance;
  }

  // ─── 工具 ───────────────────────────────────────────────

  private getShouldRunBackground(): boolean {
    const { useSettingsStore } = require('../stores/settingsStore');
    const state = useSettingsStore.getState();
    const config = state.config;
    const tempDisabled = state.isTempDisabledBackgroundTasks;
    return shouldRunBackgroundSync(config, tempDisabled);
  }

  /**
   * 更新静态短信接收器状态。
   * SMS 转发不受后台任务总开关控制，仅由 enableSmsForwarding 决定。
   */
  private _updateSmsReceiver(): void {
    try {
      const { useSettingsStore } = require('../stores/settingsStore');
      const config = useSettingsStore.getState().config;
      const { setStaticReceiverEnabled } = require('sms-forwarder');
      setStaticReceiverEnabled(!!config?.enableSmsForwarding);
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to toggle SMS receiver:', e);
    }
  }

  // ─── 公开 API ─────────────────────────────────────────────

  /**
   * 启动所有服务（幂等）。
   * 由任意 Activity 入口调用。
   * - 始终启动剪贴板监控（前台 UI 需要）
   * - 始终启动 ClipboardSyncService（前台 UI + 后台同步）
   * - 仅在后台任务启用时才启动前台通知和心跳
   * - 始终订阅配置变化以支持动态重启
   */
  async start(): Promise<void> {
    // 等待配置加载完成
    const { useSettingsStore } = require('../stores/settingsStore');
    if (!useSettingsStore.getState().isLoaded) {
      await useSettingsStore.getState().loadConfig();
    }

    // SMS 转发始终独立管理（Android 专属）
    if (Platform.OS === 'android') {
      this._updateSmsReceiver();
    }

    // 始终启动剪贴板监控（无论是否启用后台任务，UI 需要感知本地剪贴板变化）
    try {
      const { useClipboardStore } = require('../stores');
      await useClipboardStore.getState().startMonitoring();
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to start clipboard monitoring:', e);
    }

    // 启动 Rust-driven SyncEngine（1Hz 自动同步 + 去重 + 退避）
    await this._startSyncEngine();
    await this._reconcileSyncExecution();

    // 启动旧 ClipboardSyncService（上传与远程显示；syncclipboard 自动拉取由 SyncEngine 的 SSE+兜底 tick 接管）
    await this._startRemoteSync();

    // 后台专用服务（前台通知 + 心跳，Android 专属）
    if (Platform.OS === 'android') {
      if (this.getShouldRunBackground()) {
        if (!this.running) {
          this.running = true;
          await this._startBackgroundOnlyServices();
        }
      } else {
        await this._stopBackgroundOnlyServices();
      }
    }

    // 始终订阅配置变化（不再因 getShouldRunBackground() 为 false 而跳过）
    this._subscribeToConfigChanges();
  }

  /**
   * 停止后台专用服务（前台通知、心跳）。
   * 注意：ClipboardSyncService 不在此处停止，由 refresh() 统一管理。
   */
  async stop(): Promise<void> {
    await this._stopBackgroundOnlyServices();
  }

  /**
   * 配置变化时重新评估所有服务状态（由内部订阅自动触发）。
   */
  async refresh(): Promise<void> {
    // SMS 转发（Android 专属）
    if (Platform.OS === 'android') {
      this._updateSmsReceiver();
    }

    // 先立即应用停止/恢复策略，不能被旧远端请求阻塞。
    await this._reconcileSyncExecution();

    // 刷新远程同步服务（处理服务器变更、连接类型切换等）
    await this._startRemoteSync();

    // 后台专用服务（Android 专属）
    if (Platform.OS === 'android') {
      if (this.getShouldRunBackground()) {
        if (!this.running) {
          this.running = true;
          await this._startBackgroundOnlyServices();
        } else {
          await this._updateBackgroundOnlyServices();
        }
      } else {
        await this._stopBackgroundOnlyServices();
      }
    }
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  /** 启动/刷新 ClipboardSyncService */
  private async _startRemoteSync(): Promise<void> {
    try {
      const { getClipboardSyncService } = require('./ClipboardSyncService');
      await getClipboardSyncService().refresh();
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to start/refresh remote sync:', e);
    }
  }

  /** 启动 Rust-driven SyncEngine（新同步引擎） */
  private async _startSyncEngine(): Promise<void> {
    try {
      const { useSyncEngineStore } = require('../stores/syncEngineStore');
      const store = useSyncEngineStore.getState();
      if (!store.isRunning) {
        await store.start();
      }
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to start SyncEngine:', e);
    }
  }

  /** 按当前 AppState 和后台策略重评估新引擎与本地剪贴板监听。 */
  private async _reconcileSyncExecution(): Promise<void> {
    try {
      const { reconcileSyncEngineAppState } = require('../stores/syncEngineStore');
      reconcileSyncEngineAppState();
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to reconcile SyncEngine:', e);
    }

    if (AppState.currentState === 'active') return;

    try {
      const { useSettingsStore } = require('../stores/settingsStore');
      const settings = useSettingsStore.getState();
      const { useClipboardStore } = require('../stores/clipboardStore');
      if (canAutoPushInBackground(settings.config, settings.isTempDisabledBackgroundTasks)) {
        await useClipboardStore.getState().startMonitoring();
      } else {
        useClipboardStore.getState().stopMonitoring();
      }
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to reconcile clipboard monitoring:', e);
    }
  }

  /** 启动后台专用服务（前台通知、心跳、剪贴板监控） */
  private async _startBackgroundOnlyServices(): Promise<void> {
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;

    // 1. 按需启动前台常驻通知服务
    if (config?.enableForegroundNotification) {
      try {
        const ForegroundService = require('foreground-service');
        ForegroundService.startService();

        this.stopSub = ForegroundService.addStopListener(() => {
          useSettingsStore.getState().setEnableBackgroundTasks(false);
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          useSettingsStore.getState().setTempDisabledBackgroundTasks(true);
        });
      } catch (e) {
        log.error('[BackgroundServiceManager] Failed to start foreground service:', e);
      }
    }

    // 2. 统计心跳
    try {
      const { useStatisticsStore } = require('../stores/statisticsStore');
      await useStatisticsStore.getState().recordBackgroundTaskStart();

      const { setTimer: st } = require('native-timer');
      this.heartbeatTag = st(() => {
        useStatisticsStore.getState().updateHeartbeat();
      }, 60_000);
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to start statistics/heartbeat:', e);
    }

    log.info('[BackgroundServiceManager] Background-only services started');
  }

  /** 更新后台专用服务（配置变化时调用） */
  private async _updateBackgroundOnlyServices(): Promise<void> {
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;

    try {
      const ForegroundService = require('foreground-service');
      const isRunning = ForegroundService.isRunning();
      if (config?.enableForegroundNotification && !isRunning) {
        ForegroundService.startService();
        this.stopSub = ForegroundService.addStopListener(() => {
          useSettingsStore.getState().setEnableBackgroundTasks(false);
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          useSettingsStore.getState().setTempDisabledBackgroundTasks(true);
        });
      } else if (!config?.enableForegroundNotification && isRunning) {
        this._cleanupListeners();
        ForegroundService.stopService();
      }
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to update foreground service:', e);
    }
  }

  /** 停止后台专用服务 */
  private async _stopBackgroundOnlyServices(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this._cleanupListeners();

    if (this.heartbeatTag) {
      try {
        const { clearTimer } = require('native-timer');
        clearTimer(this.heartbeatTag);
      } catch (error) {
        log.warn('[BackgroundServiceManager] Failed to clear heartbeat timer:', error);
      }
      this.heartbeatTag = null;
    }

    try {
      const ForegroundService = require('foreground-service');
      ForegroundService.stopService();
    } catch (error) {
      log.warn('[BackgroundServiceManager] Failed to stop foreground service:', error);
    }
  }

  private _cleanupListeners(): void {
    this.stopSub?.remove();
    this.tempStopSub?.remove();
    this.stopSub = null;
    this.tempStopSub = null;
  }

  private _subscribeToConfigChanges(): void {
    if (this.settingsUnsub) return;
    const { useSettingsStore } = require('../stores/settingsStore');
    this.settingsUnsub = useSettingsStore.subscribe(
      (
        state: { config: unknown; isTempDisabledBackgroundTasks: boolean },
        prevState: { config: unknown; isTempDisabledBackgroundTasks: boolean }
      ) => {
        if (
          state.config !== prevState.config ||
          state.isTempDisabledBackgroundTasks !== prevState.isTempDisabledBackgroundTasks
        ) {
          this.refresh().catch((e) => log.error('[BackgroundServiceManager] refresh failed:', e));
        }
      }
    );
  }
}

export function getBackgroundServiceManager(): BackgroundServiceManager {
  return BackgroundServiceManager.getInstance();
}
