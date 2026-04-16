/**
 * BackgroundServiceManager
 * 统一管理所有 JS 侧后台服务的生命周期。
 *
 * 负责管理：
 * - 前台服务（常驻通知）
 * - 短信验证码服务
 * - SyncManager 初始化（为后台上传/下载提供 API 客户端）
 * - 剪贴板监控（检测本地变化，触发后台上传）
 * - 后台下载轮询（定期从服务器同步最新内容）
 * - 统计心跳
 * - 通知栏停止/临时停止监听
 *
 * 被 ServiceRestartApp、QuickActionApp、App（main）调用；
 * HomeScreen 不再负责后台服务的启动与停止。
 */

import { Platform } from 'react-native';
import { SyncDirection } from '../types/sync';

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager | null = null;

  private running = false;
  private downloadPollingTag: string | null = null;
  private heartbeatTag: string | null = null;
  private stopSub: { remove(): void } | null = null;
  private tempStopSub: { remove(): void } | null = null;
  /** 取消对 settingsStore 的订阅 */
  private settingsUnsub: (() => void) | null = null;
  /** 取消对 clipboardStore 的订阅（用于后台上传） */
  private clipboardUnsub: (() => void) | null = null;
  /** 后台 SignalR 是否已连接（用于后台下载） */
  private signalRConnected = false;

  /** SignalR 收到远程变化时触发后台下载（箭头函数以保证 this 和引用稳定性，供 off 注销） */
  private readonly _signalRProfileCallback = async (): Promise<void> => {
    try {
      const { SyncManager } = require('./SyncManager');
      const manager = SyncManager.getInstance();
      if (manager.getAPIClient()) {
        await manager.sync(SyncDirection.Download, true);
      }
    } catch {}
  };

  private constructor() {}

  static getInstance(): BackgroundServiceManager {
    if (!BackgroundServiceManager.instance) {
      BackgroundServiceManager.instance = new BackgroundServiceManager();
    }
    return BackgroundServiceManager.instance;
  }

  // ─── 工具 ───────────────────────────────────────────────

  private getShouldRun(): boolean {
    const { useSettingsStore } = require('../stores/settingsStore');
    const state = useSettingsStore.getState();
    const config = state.config;
    const tempDisabled = state.isTempDisabledBackgroundTasks;
    return (
      !tempDisabled &&
      !!config?.enableBackgroundTasks &&
      !!config?.enableForegroundNotification &&
      !!(
        config?.enableBackgroundDownload ||
        config?.enableBackgroundUpload ||
        config?.enableSmsForwarding
      )
    );
  }

  // ─── 公开 API ─────────────────────────────────────────────

  /** 后台是否正在维护 SignalR 连接（供 HomeScreen 判断是否可以断开）。 */
  isSignalRRunning(): boolean {
    return this.signalRConnected;
  }

  /**
   * 启动所有后台服务（幂等）。
   * 由任意 Activity 入口调用，配置满足时启动，不满足时停止。
   */
  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;

    // 等待配置加载完成（已加载则跳过）
    const { useSettingsStore } = require('../stores/settingsStore');
    if (!useSettingsStore.getState().isLoaded) {
      await useSettingsStore.getState().loadConfig();
    }

    if (!this.getShouldRun()) {
      await this.stop();
      return;
    }

    if (!this.running) {
      this.running = true;
      await this._startServices();
    }

    // 订阅配置变化，动态更新服务状态
    this._subscribeToConfigChanges();
  }

  /**
   * 停止所有后台服务。
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this._unsubscribeFromConfigChanges();
    this._unsubscribeFromClipboardChanges();
    this._cleanupListeners();

    // 停止 SignalR（仅当由本管理器维护时）
    await this._stopSignalR();

    // 停止后台下载轮询
    if (this.downloadPollingTag) {
      const { clearTimer } = require('native-timer');
      clearTimer(this.downloadPollingTag);
      this.downloadPollingTag = null;
    }

    // 停止心跳
    if (this.heartbeatTag) {
      const { clearTimer } = require('native-timer');
      clearTimer(this.heartbeatTag);
      this.heartbeatTag = null;
    }

    // 停止 SMS 服务
    try {
      const { getSmsCodeService } = require('./SmsCodeService');
      await getSmsCodeService().disable();
    } catch {}

    // 停止前台服务
    try {
      const ForegroundService = require('foreground-service');
      ForegroundService.stopService();
    } catch {}
  }

  /**
   * 配置变化时重新评估是否需要启动/停止服务。
   * 可以从 HomeScreen 或 settings 变化处调用，也可以靠订阅自动触发。
   */
  async refresh(): Promise<void> {
    if (this.getShouldRun()) {
      if (!this.running) {
        this.running = true;
        await this._startServices();
      } else {
        // 已运行，但某些子服务可能需要更新（如 SMS 启用/禁用）
        await this._updateServices();
      }
    } else {
      await this.stop();
    }
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _startServices(): Promise<void> {
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;

    // 1. 启动前台服务
    try {
      const ForegroundService = require('foreground-service');
      ForegroundService.startService();

      // 记录后台任务启动时间
      const { useStatisticsStore } = require('../stores/statisticsStore');
      await useStatisticsStore.getState().recordBackgroundTaskStart();

      // 启动心跳（每 60s 更新持续时间统计）
      const { setTimer: st } = require('native-timer');
      this.heartbeatTag = st(() => {
        useStatisticsStore.getState().updateHeartbeat();
      }, 60_000);

      // 监听通知栏"停止"和"临时停止"按钮
      this.stopSub = ForegroundService.addStopListener(() => {
        useSettingsStore.getState().setEnableBackgroundTasks(false);
      });
      this.tempStopSub = ForegroundService.addTempStopListener(() => {
        useSettingsStore.getState().setTempDisabledBackgroundTasks(true);
      });
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start foreground service:', e);
    }

    // 2. 初始化 SyncManager（提供 API 客户端，支持后台上传/下载）
    try {
      const { useSyncStore } = require('../stores/syncStore');
      await useSyncStore.getState().initialize();
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to initialize SyncManager:', e);
    }

    // 3. 启动剪贴板监控，并订阅内容变化以触发后台上传
    try {
      const { useClipboardStore } = require('../stores');
      await useClipboardStore.getState().startMonitoring();
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start clipboard monitoring:', e);
    }
    this._subscribeToClipboardChanges();

    // 4. 启动后台下载：SyncClipboard 服务器使用 SignalR，其他使用轮询
    if (config?.enableBackgroundDownload) {
      const activeServer = useSettingsStore.getState().getActiveServer();
      if (activeServer?.type === 'syncclipboard') {
        await this._startSignalR(activeServer);
      } else {
        await this._startDownloadPolling(config.remotePollingInterval);
      }
    }

    // 5. 启动 SMS 验证码服务（含 emitPendingSms，处理堆积的验证码）
    if (config?.enableSmsForwarding) {
      try {
        const { getSmsCodeService } = require('./SmsCodeService');
        await getSmsCodeService().enable();
      } catch (e) {
        console.error('[BackgroundServiceManager] Failed to enable SMS service:', e);
      }
    }

    console.log('[BackgroundServiceManager] All background services started');
  }

  private async _updateServices(): Promise<void> {
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;

    // 更新 SMS 服务状态
    try {
      const { getSmsCodeService } = require('./SmsCodeService');
      const smsService = getSmsCodeService();
      if (config?.enableBackgroundTasks && config?.enableSmsForwarding) {
        await smsService.enable();
      } else {
        await smsService.disable();
      }
    } catch {}

    // 更新后台下载（SignalR vs 轮询）
    const shouldDownload = config?.enableBackgroundTasks && config?.enableBackgroundDownload;
    const activeServer = useSettingsStore.getState().getActiveServer();
    const useSignalR = activeServer?.type === 'syncclipboard';
    if (shouldDownload) {
      if (useSignalR) {
        // 切换到 SignalR：停止轮询
        if (this.downloadPollingTag) {
          const { clearTimer } = require('native-timer');
          clearTimer(this.downloadPollingTag);
          this.downloadPollingTag = null;
        }
        if (activeServer && !this.signalRConnected) {
          await this._startSignalR(activeServer);
        }
      } else {
        // 切换到轮询：停止 SignalR
        await this._stopSignalR();
        if (!this.downloadPollingTag) {
          await this._startDownloadPolling(config?.remotePollingInterval);
        }
      }
    } else {
      // 关闭后台下载
      if (this.downloadPollingTag) {
        const { clearTimer } = require('native-timer');
        clearTimer(this.downloadPollingTag);
        this.downloadPollingTag = null;
      }
      await this._stopSignalR();
    }
  }

  private async _startDownloadPolling(remotePollingInterval?: number): Promise<void> {
    if (this.downloadPollingTag) return;
    try {
      const { setTimer } = require('native-timer');
      const interval = remotePollingInterval ?? 5000;
      this.downloadPollingTag = setTimer(
        async () => {
          try {
            const { SyncManager } = require('./SyncManager');
            const manager = SyncManager.getInstance();
            if (manager.getAPIClient()) {
              await manager.sync(SyncDirection.Download, true);
            }
          } catch {}
        },
        interval,
        'bg_download_poll'
      );
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start download polling:', e);
    }
  }

  private async _startSignalR(serverConfig: {
    type: string;
    url: string;
    username?: string;
    password?: string;
  }): Promise<void> {
    if (this.signalRConnected) return;
    try {
      const { getSignalRClient } = require('signalr-client');
      const client = getSignalRClient();
      client.onRemoteClipboardChanged(this._signalRProfileCallback);
      await client.connect(serverConfig);
      this.signalRConnected = true;
      console.log('[BackgroundServiceManager] SignalR connected for background download');
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to connect SignalR:', e);
    }
  }

  private async _stopSignalR(): Promise<void> {
    if (!this.signalRConnected) return;
    this.signalRConnected = false;
    try {
      const { getSignalRClient } = require('signalr-client');
      const client = getSignalRClient();
      client.offRemoteClipboardChanged(this._signalRProfileCallback);
      await client.disconnect();
      console.log('[BackgroundServiceManager] SignalR disconnected');
    } catch {}
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
    // Zustand v5: subscribe(listener) — listener receives (state, prevState)
    this.settingsUnsub = useSettingsStore.subscribe(
      (
        state: { config: unknown; isTempDisabledBackgroundTasks: boolean },
        prevState: { config: unknown; isTempDisabledBackgroundTasks: boolean }
      ) => {
        if (
          state.config !== prevState.config ||
          state.isTempDisabledBackgroundTasks !== prevState.isTempDisabledBackgroundTasks
        ) {
          this.refresh().catch((e) =>
            console.error('[BackgroundServiceManager] refresh failed:', e)
          );
        }
      }
    );
  }

  private _unsubscribeFromConfigChanges(): void {
    this.settingsUnsub?.();
    this.settingsUnsub = null;
  }

  private _subscribeToClipboardChanges(): void {
    if (this.clipboardUnsub) return;
    const { useClipboardStore } = require('../stores/clipboardStore');
    this.clipboardUnsub = useClipboardStore.subscribe(
      (state: { currentContent: unknown }, prevState: { currentContent: unknown }) => {
        if (state.currentContent !== prevState.currentContent && state.currentContent) {
          this._handleClipboardUpload(
            state.currentContent as import('../types/clipboard').ClipboardContent
          );
        }
      }
    );
  }

  private _unsubscribeFromClipboardChanges(): void {
    this.clipboardUnsub?.();
    this.clipboardUnsub = null;
  }

  /**
   * 剪贴板内容变化时触发后台上传。
   * 仅当后台上传已启用且 SyncManager 已初始化时执行。
   */
  private _handleClipboardUpload(content: import('../types/clipboard').ClipboardContent): void {
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;
    const bgUploadEnabled = config?.enableBackgroundTasks && config?.enableBackgroundUpload;
    if (!bgUploadEnabled) return;

    const { SyncManager } = require('./SyncManager');
    const manager = SyncManager.getInstance();
    if (!manager.getAPIClient()) return;

    manager.setPendingUploadContent(content);
    manager
      .sync(SyncDirection.Upload, true)
      .catch((e: Error) => console.error('[BackgroundServiceManager] Background upload failed:', e))
      .finally(() => manager.setPendingUploadContent(null));
  }
}

export function getBackgroundServiceManager(): BackgroundServiceManager {
  return BackgroundServiceManager.getInstance();
}
