/**
 * AppRuntime
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
import { createLogger } from '@/support/observability';
import { shouldRunBackgroundSync } from '@/utils/syncDirectionPolicy';
import { getCurrentNetworkContext } from '@/platform/network';
import type { AppSettings } from '@/types/settings';
import type { EngineEvent, UnifiedEngineService } from '@/platform/engine';

const log = createLogger('AppRuntime');

export function normalizeEngineApplicationVersion(version: string): string {
  const androidRelease = version.match(/^(\d+\.\d+\.\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/);
  if (!androidRelease) return version;

  const [, marketingVersion, buildNumber, prerelease = ''] = androidRelease;
  return `${marketingVersion}${prerelease}+build.${buildNumber}`;
}

export function isDeviceListRefreshEvent(event: EngineEvent): boolean {
  return (
    event.type === 'refreshRequired' ||
    event.type === 'peerPresenceChanged' ||
    (event.type === 'changed' && event.kind === 'pairing_completed')
  );
}

type RuntimeSettingsState = {
  config: AppSettings | null;
  isLoaded: boolean;
  isTempDisabledBackgroundTasks: boolean;
};

export interface AppRuntimeDependencies {
  settingsStore: {
    getState(): RuntimeSettingsState & {
      loadConfig(): Promise<void>;
      setEnableBackgroundTasks(enabled: boolean): void;
      setTempDisabledBackgroundTasks(disabled: boolean): void;
    };
    subscribe(
      listener: (state: RuntimeSettingsState, previous: RuntimeSettingsState) => void
    ): () => void;
  };
  clipboardStore: { getState(): { startMonitoring(): Promise<void> } };
  engine(): Pick<
    UnifiedEngineService,
    | 'start'
    | 'setBackgroundSyncPolicy'
    | 'resume'
    | 'recoverPeerConnections'
    | 'cancelPeerRecovery'
    | 'subscribeEvents'
  >;
  space(): {
    refresh(options?: { afterInvalidation?: boolean }): Promise<{ devices: unknown[] }>;
    refreshDevices(): Promise<unknown>;
    refreshDeviceTrust(): Promise<unknown>;
  };
  statisticsStore: {
    getState(): { recordBackgroundTaskStart(): Promise<void>; updateHeartbeat(): void };
  };
  applicationVersion(): string | null;
}

let configuredDependencies: AppRuntimeDependencies | null = null;

export function configureAppRuntime(dependencies: AppRuntimeDependencies): void {
  if (AppRuntime.hasInstance()) throw new Error('The app runtime has already been created');
  configuredDependencies = dependencies;
}

export class AppRuntime {
  private static instance: AppRuntime | null = null;

  private running = false;
  private heartbeatTag: string | null = null;
  private stopSub: { remove(): void } | null = null;
  private tempStopSub: { remove(): void } | null = null;
  private appStateSub: { remove(): void } | null = null;
  /** 取消对 settingsStore 的订阅 */
  private settingsUnsub: (() => void) | null = null;
  /** 取消对 Engine 事件的订阅 */
  private engineEventsUnsub: (() => void) | null = null;
  private currentAppState = AppState.currentState;
  private hasStarted = false;
  private startPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private refreshPending = false;
  private constructor(private readonly dependencies: AppRuntimeDependencies) {}

  static getInstance(dependencies: AppRuntimeDependencies): AppRuntime {
    if (!AppRuntime.instance) {
      AppRuntime.instance = new AppRuntime(dependencies);
    }
    return AppRuntime.instance;
  }

  static hasInstance(): boolean {
    return AppRuntime.instance !== null;
  }

  // ─── 工具 ───────────────────────────────────────────────

  private getShouldRunBackground(): boolean {
    const state = this.dependencies.settingsStore.getState();
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
    if (this.startPromise) return this.startPromise;

    // The formal startup reads the latest route state, so an earlier route
    // notification does not need to be replayed after startup.
    this.refreshPending = false;
    const startPromise = this._performStart();
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null;
    }
  }

  private async _performStart(): Promise<void> {
    // 等待配置加载完成
    if (!this.dependencies.settingsStore.getState().isLoaded) {
      await this.dependencies.settingsStore.getState().loadConfig();
    }

    this._subscribeToAppState();
    this._subscribeToEngineEvents();

    // 始终启动剪贴板监控（无论是否启用后台任务，UI 需要感知本地剪贴板变化）
    try {
      await this.dependencies.clipboardStore.getState().startMonitoring();
    } catch (e) {
      log.error('Failed to start clipboard monitoring:', e);
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
    this.hasStarted = true;

    if (this.refreshPending) {
      await this._drainRefreshes();
    }
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
    this.refreshPending = true;
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    if (!this.hasStarted) return;
    await this._drainRefreshes();
  }

  async activateP2p(): Promise<void> {
    await this._startUnifiedEngine();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _startUnifiedEngine(): Promise<void> {
    const service = this.dependencies.engine();
    const startedAt = Date.now();
    log.info('Starting native P2P engine');
    const applicationVersion = this.dependencies.applicationVersion() ?? 'unknown';
    await service.start({
      appVersion: normalizeEngineApplicationVersion(applicationVersion),
      profileId: 'default',
    });
    log.info(`Native P2P engine started in ${Date.now() - startedAt}ms`);
    await this._refreshUnifiedEngine(startedAt);
  }

  private async _refreshUnifiedEngine(startedAt = Date.now()): Promise<void> {
    const service = this.dependencies.engine();
    await service.setBackgroundSyncPolicy(this.getShouldRunBackground());
    if (Platform.OS === 'ios') {
      if (this.currentAppState !== 'active') return;
      const resumeStartedAt = Date.now();
      log.info('Resuming P2P foreground session');
      await service.resume();
      log.info(`P2P foreground session resumed in ${Date.now() - resumeStartedAt}ms`);
    }
    const space = await this.dependencies.space().refresh();
    log.info('P2P space state', { deviceCount: space.devices.length });
    log.info(`Selected P2P channel ready in ${Date.now() - startedAt}ms`);
    if (Platform.OS === 'ios' && this.currentAppState !== 'active') return;

    const recoveryStartedAt = Date.now();
    log.info('Recovering P2P receiver connections');
    void service.recoverPeerConnections().then(
      (report: { online: number }) =>
        log.info(`P2P receiver recovery finished in ${Date.now() - recoveryStartedAt}ms`, report),
      (error: unknown) => log.error('Failed to recover P2P peer connections:', error)
    );
  }

  private async _drainRefreshes(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshPromise = (async () => {
      while (this.refreshPending) {
        this.refreshPending = false;
        await this._refreshUnifiedEngine();

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
    })();
    this.refreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    }
  }

  /** 启动 Android 后台专用服务（前台通知、统计心跳） */
  private async _startBackgroundOnlyServices(): Promise<void> {
    const config = this.dependencies.settingsStore.getState().config;

    // 1. 按需启动前台常驻通知服务
    if (config?.enableForegroundNotification) {
      try {
        const ForegroundService = require('foreground-service');
        ForegroundService.startService();

        this.stopSub = ForegroundService.addStopListener(() => {
          this.dependencies.settingsStore.getState().setEnableBackgroundTasks(false);
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          this.dependencies.settingsStore.getState().setTempDisabledBackgroundTasks(true);
        });
      } catch (e) {
        log.error('Failed to start foreground service:', e);
      }
    }

    // 2. 统计心跳
    try {
      await this.dependencies.statisticsStore.getState().recordBackgroundTaskStart();

      const { setTimer: st } = require('native-timer');
      this.heartbeatTag = st(() => {
        this.dependencies.statisticsStore.getState().updateHeartbeat();
      }, 60_000);
    } catch (e) {
      log.error('Failed to start statistics/heartbeat:', e);
    }

    log.info('Background-only services started');
  }

  /** 更新后台专用服务（配置变化时调用） */
  private async _updateBackgroundOnlyServices(): Promise<void> {
    const config = this.dependencies.settingsStore.getState().config;

    try {
      const ForegroundService = require('foreground-service');
      const isRunning = ForegroundService.isRunning();
      if (config?.enableForegroundNotification && !isRunning) {
        ForegroundService.startService();
        this.stopSub = ForegroundService.addStopListener(() => {
          this.dependencies.settingsStore.getState().setEnableBackgroundTasks(false);
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          this.dependencies.settingsStore.getState().setTempDisabledBackgroundTasks(true);
        });
      } else if (!config?.enableForegroundNotification && isRunning) {
        this._cleanupListeners();
        ForegroundService.stopService();
      }
    } catch (e) {
      log.error('Failed to update foreground service:', e);
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
        log.warn('Failed to clear heartbeat timer:', error);
      }
      this.heartbeatTag = null;
    }

    try {
      const ForegroundService = require('foreground-service');
      ForegroundService.stopService();
    } catch (error) {
      log.warn('Failed to stop foreground service:', error);
    }
  }

  private _cleanupListeners(): void {
    this.stopSub?.remove();
    this.tempStopSub?.remove();
    this.stopSub = null;
    this.tempStopSub = null;
  }

  private _subscribeToAppState(): void {
    if (this.appStateSub) return;

    this.appStateSub = AppState.addEventListener('change', (state) => {
      const previousState = this.currentAppState;
      this.currentAppState = state;

      if (Platform.OS === 'ios' && (state === 'inactive' || state === 'background')) {
        this.dependencies.engine().cancelPeerRecovery();
        return;
      }

      if (state === 'active' && previousState !== 'active') {
        this.refresh().catch((error) => log.error('Failed to resume services:', error));
      }
    });
  }

  private _subscribeToEngineEvents(): void {
    if (this.engineEventsUnsub) return;
    this.engineEventsUnsub = this.dependencies.engine().subscribeEvents((event) => {
      if (event.type === 'deviceTrustChanged' || event.type === 'rePairingRequired') {
        if (this.currentAppState !== 'active') return;
        this.dependencies
          .space()
          .refresh({ afterInvalidation: true })
          .catch((error) =>
            log.error('Failed to refresh space after a device trust event:', error)
          );
        return;
      }
      if (!isDeviceListRefreshEvent(event)) return;
      if (this.currentAppState !== 'active') return;
      this.dependencies
        .space()
        .refreshDevices()
        .catch((error) => log.error('Failed to refresh devices after an engine event:', error));
    });
  }

  private _subscribeToConfigChanges(): void {
    if (this.settingsUnsub) return;
    this.settingsUnsub = this.dependencies.settingsStore.subscribe(
      (
        state: { config: unknown; isTempDisabledBackgroundTasks: boolean },
        prevState: { config: unknown; isTempDisabledBackgroundTasks: boolean }
      ) => {
        if (
          state.config !== prevState.config ||
          state.isTempDisabledBackgroundTasks !== prevState.isTempDisabledBackgroundTasks
        ) {
          this.refresh().catch((e) => log.error('refresh failed:', e));
        }
      }
    );
  }
}

export function getAppRuntime(): AppRuntime {
  if (!configuredDependencies) throw new Error('The app runtime is not configured');
  return AppRuntime.getInstance(configuredDependencies);
}
