/**
 * BackgroundServiceManager
 * 统一管理所有 JS 侧后台服务的生命周期。
 *
 * 负责管理：
 * - P2P engine
 * - 前台服务（常驻通知）
 * - 剪贴板监控（startMonitoring）
 * - 统计心跳
 * - 通知栏停止/临时停止监听
 *
 * 被 ServiceRestartApp、QuickActionApp、App（main）调用。
 * HomeScreen 不负责后台服务的启动与停止。
 */

import { AppState, Platform } from 'react-native';
import { log } from './Logger';
import { shouldRunBackgroundSync } from '@/utils/syncDirectionPolicy';
import { getCurrentNetworkContext } from './networkContext';

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager | null = null;

  private running = false;
  private heartbeatTag: string | null = null;
  private stopSub: { remove(): void } | null = null;
  private tempStopSub: { remove(): void } | null = null;
  private appStateSub: { remove(): void } | null = null;
  /** 取消对 settingsStore 的订阅 */
  private settingsUnsub: (() => void) | null = null;
  private currentAppState = AppState.currentState;
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
    return shouldRunBackgroundSync(config, tempDisabled, getCurrentNetworkContext());
  }

  // ─── 公开 API ─────────────────────────────────────────────

  /**
   * 启动所有服务（幂等）。
   * 由任意 Activity 入口调用。
   * - 始终启动剪贴板监控（前台 UI 需要）
   * - 始终启动 P2P engine
   * - 仅在后台任务启用时才启动前台通知和心跳
   * - 始终订阅配置变化以支持动态重启
   */
  async start(): Promise<void> {
    // 等待配置加载完成
    const { useSettingsStore } = require('../stores/settingsStore');
    if (!useSettingsStore.getState().isLoaded) {
      await useSettingsStore.getState().loadConfig();
    }

    this._subscribeToAppState();

    // 始终启动剪贴板监控（无论是否启用后台任务，UI 需要感知本地剪贴板变化）
    try {
      const { useClipboardStore } = require('../stores');
      await useClipboardStore.getState().startMonitoring();
    } catch (e) {
      log.error('[BackgroundServiceManager] Failed to start clipboard monitoring:', e);
    }

    await this._startUnifiedEngine();

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
   * P2P engine 由应用生命周期统一管理。
   */
  async stop(): Promise<void> {
    await this._stopBackgroundOnlyServices();
  }

  /**
   * 配置变化时重新评估所有服务状态（由内部订阅自动触发）。
   */
  async refresh(): Promise<void> {
    await this._startUnifiedEngine();

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

  async activateP2p(): Promise<void> {
    await this._startUnifiedEngine();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _startUnifiedEngine(): Promise<void> {
    const { getUnifiedEngineService } = require('./UnifiedEngineService');
    const Application = require('expo-application');
    const service = getUnifiedEngineService();
    const startedAt = Date.now();
    log.info('[P2PStartup] Starting native engine');
    await service.start({
      appVersion: Application.nativeApplicationVersion ?? 'unknown',
      profileId: 'default',
    });
    await service.setBackgroundSyncPolicy(this.getShouldRunBackground());
    log.info(`[P2PStartup] Native engine started in ${Date.now() - startedAt}ms`);
    if (Platform.OS === 'ios') {
      if (this.currentAppState !== 'active') return;
      const resumeStartedAt = Date.now();
      log.info('[P2PStartup] Resuming foreground session');
      await service.resume();
      log.info(`[P2PStartup] Foreground session resumed in ${Date.now() - resumeStartedAt}ms`);
    }
    const { getUnifiedSpaceService } = require('./UnifiedSpaceService');
    const space = await getUnifiedSpaceService().refresh();
    log.info('[P2PStartup] Space devices', space.devices);
    log.info(`[P2PStartup] Selected P2P channel ready in ${Date.now() - startedAt}ms`);
    if (Platform.OS === 'ios' && this.currentAppState !== 'active') return;

    const recoveryStartedAt = Date.now();
    log.info('[P2PStartup] Recovering receiver connections');
    void service.recoverPeerConnections().then(
      (report: { online: number }) =>
        log.info(
          `[P2PStartup] Receiver recovery finished in ${Date.now() - recoveryStartedAt}ms`,
          report
        ),
      (error: unknown) =>
        log.error('[BackgroundServiceManager] Failed to recover P2P peer connections:', error)
    );
  }

  /** 启动 Android 后台专用服务（前台通知、统计心跳） */
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

  private _subscribeToAppState(): void {
    if (this.appStateSub || Platform.OS !== 'ios') return;

    this.appStateSub = AppState.addEventListener('change', (state) => {
      this.currentAppState = state;
      const { getUnifiedEngineService } = require('./UnifiedEngineService');
      const service = getUnifiedEngineService();
      if (state === 'inactive' || state === 'background') {
        service.cancelPeerRecovery();
        if (service.isStarting()) {
          service
            .stop()
            .catch((error: unknown) =>
              log.error('[BackgroundServiceManager] Failed to stop starting P2P engine:', error)
            );
        }
        return;
      }

      if (state === 'active') {
        this.refresh().catch((error) =>
          log.error('[BackgroundServiceManager] Failed to resume services:', error)
        );
      }
    });
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
