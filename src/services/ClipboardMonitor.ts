/**
 * Clipboard Monitor
 * 剪贴板监听器 - 监听剪贴板内容变化
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClipboardManager } from './ClipboardManager';
import { ClipboardContent, ClipboardChangeCallback, ClipboardMonitorOptions } from '@/types';
import { setTimer, clearTimer } from 'native-timer';
import { getPasteboardChangeCount } from 'app-group-store';
import * as ClipboardProxy from '@/utils/clipboardProxy';

const LAST_CLIPBOARD_HASH_KEY = '@last_clipboard_hash';
const IOS_DENIED_CHANGE_COUNT_KEY = '@ios_pasteboard_denied_change_count';

interface PersistedClipboardHash {
  localClipboardHash?: string;
  profileHash?: string;
  type?: string;
}

/**
 * 剪贴板监听器类
 */
export class ClipboardMonitor {
  private clipboardManager: ClipboardManager;
  private callbacks: Set<ClipboardChangeCallback> = new Set();
  private isMonitoring: boolean = false;
  private pollingTimerTag: string | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private lastContent: ClipboardContent | null = null;

  // 配置选项
  private options: Required<ClipboardMonitorOptions> = {
    pollingInterval: 1000, // iOS 默认 1 秒轮询
    stopOnBackground: true,
    debounceDelay: 300,
  };

  private debounceTimerTag: string | null = null;
  private static readonly DEBOUNCE_TIMER_TAG = 'clipboard_monitor_debounce';
  private isChecking: boolean = false;
  private checkGeneration: number = 0;

  // iOS：UIPasteboard.changeCount 门控。读 changeCount 不触发系统「允许粘贴」
  // 弹窗，只有读真实内容才会弹。changeCount 未变化时跳过真实读取，避免每秒
  // 弹一次授权框（以及授权后每秒读一次内容的开销）。
  private lastSeenChangeCountIOS: number | null = null;
  // 用户在系统弹窗点了「不允许」时对应的 changeCount：在剪贴板出现新内容
  // （changeCount 变化）之前不再尝试读取，也就不再弹窗。持久化以跨启动生效。
  private deniedChangeCountIOS: number | null = null;

  // 事件驱动监听状态（Android + READ_LOGS 已授时启用，替代轮询）
  private eventMonitorActive: boolean = false;
  private eventSubscription: { remove: () => void } | null = null;
  // pausePolling/resumePolling 期间同时门控事件回调，防止「程序内写入剪贴板」
  // 触发原生 listener 被误判为用户新复制而回环上传。
  private eventPaused: boolean = false;

  constructor(clipboardManager: ClipboardManager, options?: ClipboardMonitorOptions) {
    this.clipboardManager = clipboardManager;

    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * 从 AsyncStorage 加载持久化的 hash
   */
  private async loadPersistedHash(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(LAST_CLIPBOARD_HASH_KEY);
      if (stored) {
        const parsed: PersistedClipboardHash = JSON.parse(stored);
        if (parsed.localClipboardHash || parsed.profileHash) {
          this.lastContent = {
            type: (parsed.type as 'Text' | 'Image' | 'File') || 'Text',
            localClipboardHash: parsed.localClipboardHash,
            profileHash: parsed.profileHash,
          };
        }
      }
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to load persisted hash:', error);
    }
  }

  /**
   * 将 hash 持久化到 AsyncStorage
   */
  private async persistHash(content: ClipboardContent): Promise<void> {
    try {
      const toStore: PersistedClipboardHash = {
        localClipboardHash: content.localClipboardHash,
        profileHash: content.profileHash,
        type: content.type,
      };
      await AsyncStorage.setItem(LAST_CLIPBOARD_HASH_KEY, JSON.stringify(toStore));
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to persist hash:', error);
    }
  }

  /**
   * 开始监听剪贴板变化
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      log.warn('[ClipboardMonitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;

    // 从 AsyncStorage 加载持久化的 hash
    await this.loadPersistedHash();

    if (Platform.OS === 'ios') {
      await this.loadPersistedDeniedChangeCount();
    }

    // 监听应用状态变化
    if (this.options.stopOnBackground) {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }

    // 开始轮询（iOS）或事件驱动/轮询（Android）
    if (Platform.OS === 'ios') {
      this.startPolling();
    } else if (Platform.OS === 'android') {
      // Android：READ_LOGS 已授 → 事件驱动（复制即触发，无 1Hz 轮询空转）；
      // 否则回落到轮询。
      const eventStarted = await this.tryStartEventMonitor();
      if (!eventStarted) {
        this.startPolling();
      }
    }

    log.info(
      `[ClipboardMonitor] Started monitoring (${this.eventMonitorActive ? 'event-driven' : 'polling'})`
    );
  }

  /**
   * 停止监听剪贴板变化
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    // 停止轮询
    this.stopPolling();

    // 停止事件驱动监听
    this.stopEventMonitor();

    // 取消应用状态监听
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // 清除防抖计时器
    if (this.debounceTimerTag) {
      clearTimer(this.debounceTimerTag);
      this.debounceTimerTag = null;
    }

    log.info('[ClipboardMonitor] Stopped monitoring');
  }

  /**
   * 添加剪贴板变化回调
   */
  addCallback(callback: ClipboardChangeCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * 移除剪贴板变化回调
   */
  removeCallback(callback: ClipboardChangeCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * 清除所有回调
   */
  clearCallbacks(): void {
    this.callbacks.clear();
  }

  /**
   * 检查是否正在监听
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * 开始轮询
   */
  private startPolling(): void {
    this.stopPolling(); // 先停止现有轮询

    this.pollingTimerTag = setTimer(
      () => this.checkClipboard(),
      this.options.pollingInterval,
      'clipboard_monitor'
    );
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingTimerTag) {
      clearTimer(this.pollingTimerTag);
      this.pollingTimerTag = null;
    }
  }

  /**
   * 检查剪贴板内容
   */
  private async checkClipboard(): Promise<void> {
    // 互斥锁：如果上一次检查还在进行中（大图片 hash 计算耗时），跳过本次
    if (this.isChecking) return;

    // iOS：changeCount 未变化（或用户已对当前内容拒绝授权）时跳过真实读取
    const changeCount = Platform.OS === 'ios' ? getPasteboardChangeCount() : null;
    if (changeCount !== null) {
      if (changeCount === this.deniedChangeCountIOS) return;
      if (changeCount === this.lastSeenChangeCountIOS) return;
    }

    this.isChecking = true;
    const gen = this.checkGeneration;
    try {
      const content = await this.clipboardManager.getClipboardContent();

      // 如果在 getClipboardContent 期间 setLastContent 被调用，丢弃本次结果
      if (gen !== this.checkGeneration) return;

      if (changeCount !== null) {
        if (content) {
          this.lastSeenChangeCountIOS = changeCount;
          if (this.deniedChangeCountIOS !== null) {
            await this.setDeniedChangeCount(null);
          }
        } else {
          // 读到空但剪贴板确有内容 → 用户在系统弹窗点了「不允许」。
          // 记住该 changeCount，出现新内容前不再尝试读取（不再弹窗）。
          const hasContent =
            (await ClipboardProxy.hasStringAsync()) || (await ClipboardProxy.hasImageAsync());
          if (hasContent) {
            log.info(
              '[ClipboardMonitor] Pasteboard read denied by user; pausing reads until changeCount changes'
            );
            await this.setDeniedChangeCount(changeCount);
          } else {
            // 剪贴板确实为空，同样记住 changeCount 避免每秒重复读
            this.lastSeenChangeCountIOS = changeCount;
          }
        }
      }

      if (!content) {
        // log.info('[ClipboardMonitor] Poll: clipboard is empty');
        return;
      }

      await this.emitIfChanged(content);
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to check clipboard:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * iOS：当前剪贴板内容是否已被用户拒绝读取（点过「不允许」且尚无新内容）。
   * 供启动时的一次性初始读取等外部读取点在读之前判断，避免再次触发弹窗。
   */
  isReadBlockedByDenial(): boolean {
    if (Platform.OS !== 'ios' || this.deniedChangeCountIOS === null) return false;
    const changeCount = getPasteboardChangeCount();
    return changeCount !== null && changeCount === this.deniedChangeCountIOS;
  }

  /**
   * iOS：清除「用户已拒绝」状态并强制下次轮询重新读取。
   * 供用户显式重新触发授权的入口（如设置页「触发一次并授权」）调用。
   */
  async clearDenial(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    this.lastSeenChangeCountIOS = null;
    await this.setDeniedChangeCount(null);
  }

  private async loadPersistedDeniedChangeCount(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(IOS_DENIED_CHANGE_COUNT_KEY);
      if (stored !== null) {
        const parsed = Number(stored);
        this.deniedChangeCountIOS = Number.isFinite(parsed) ? parsed : null;
      }
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to load denied changeCount:', error);
    }
  }

  private async setDeniedChangeCount(changeCount: number | null): Promise<void> {
    this.deniedChangeCountIOS = changeCount;
    try {
      if (changeCount === null) {
        await AsyncStorage.removeItem(IOS_DENIED_CHANGE_COUNT_KEY);
      } else {
        await AsyncStorage.setItem(IOS_DENIED_CHANGE_COUNT_KEY, String(changeCount));
      }
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to persist denied changeCount:', error);
    }
  }

  /**
   * 若内容相对 lastContent 发生变化，则更新 lastContent、持久化并通知回调。
   * 轮询与事件驱动两条路径共用。
   */
  private async emitIfChanged(content: ClipboardContent): Promise<void> {
    if (this.hasContentChanged(content)) {
      this.lastContent = content;
      await this.persistHash(content);
      this.notifyCallbacks(content);
    }
  }

  /**
   * 尝试启动事件驱动监听（ClipCascade 式）。
   * 仅 Android + READ_LOGS 已授时生效：前台走原生 OnPrimaryClipChangedListener，
   * 后台走 logcat 触发的悬浮窗读取，复制即 emit onClipboardChange。
   * @returns 是否成功启用（false 时调用方回落到轮询）
   */
  private async tryStartEventMonitor(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const overlay = require('clipboard-overlay') as typeof import('clipboard-overlay');
      if (!overlay.hasReadLogsPermission()) return false;

      // 先订阅再启动，避免漏掉启动瞬间的事件
      this.eventSubscription = overlay.addClipboardChangeListener((event) => {
        void this.handleClipboardEvent(event);
      });

      const ok = await overlay.startClipboardMonitor();
      if (!ok) {
        this.eventSubscription?.remove();
        this.eventSubscription = null;
        return false;
      }
      this.eventMonitorActive = true;
      return true;
    } catch (error) {
      log.warn('[ClipboardMonitor] Event monitor unavailable, falling back to polling:', error);
      this.eventSubscription?.remove();
      this.eventSubscription = null;
      return false;
    }
  }

  private stopEventMonitor(): void {
    if (this.eventSubscription) {
      try {
        this.eventSubscription.remove();
      } catch {
        /* ignore */
      }
      this.eventSubscription = null;
    }
    if (this.eventMonitorActive) {
      try {
        const overlay = require('clipboard-overlay') as typeof import('clipboard-overlay');
        void overlay.stopClipboardMonitor();
      } catch {
        /* ignore */
      }
      this.eventMonitorActive = false;
    }
  }

  /**
   * 处理原生 onClipboardChange 事件。
   * - text：原生已在焦点窗口读到文本，直接用其构建内容，避免二次抢焦点。
   * - image/files：临时放开悬浮窗读取，走完整 checkClipboard 管道（含存文件/hash）。
   */
  private async handleClipboardEvent(event: { type: string; content: string }): Promise<void> {
    if (!this.isMonitoring || this.eventPaused) return;
    try {
      if (event.type === 'text') {
        if (!event.content) return;
        const content = await this.clipboardManager.buildTextContent(event.content);
        await this.emitIfChanged(content);
      } else {
        // 图片/文件：需再次读取系统剪贴板取实际内容，事件期间放开按需悬浮窗读取
        const { setOnDemandRead } = require('@/utils/clipboardProxy');
        setOnDemandRead(true);
        try {
          await this.checkClipboard();
        } finally {
          setOnDemandRead(false);
        }
      }
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to handle clipboard event:', error);
    }
  }

  /**
   * 检查内容是否发生变化
   */
  private hasContentChanged(newContent: ClipboardContent): boolean {
    if (!this.lastContent) {
      return true;
    }

    // 优先使用 localClipboardHash 比较（用于本地变化检测）
    if (newContent.localClipboardHash && this.lastContent.localClipboardHash) {
      return newContent.localClipboardHash !== this.lastContent.localClipboardHash;
    }

    // 回退到 profileHash 比较
    if (newContent.profileHash && this.lastContent.profileHash) {
      return newContent.profileHash !== this.lastContent.profileHash;
    }

    // 比较类型和文本
    if (newContent.type !== this.lastContent.type) {
      return true;
    }

    if (newContent.text !== this.lastContent.text) {
      return true;
    }

    return false;
  }

  /**
   * 通知所有回调（带防抖）
   * 使用 native-timer 替代 JS setTimeout，确保 Android 后台也能可靠触发
   */
  private notifyCallbacks(content: ClipboardContent): void {
    // 清除现有防抖计时器
    if (this.debounceTimerTag) {
      clearTimer(this.debounceTimerTag);
      this.debounceTimerTag = null;
    }

    // 使用 native-timer 设置防抖（native-timer 是 interval 模式，回调后立即清除实现 one-shot）
    this.debounceTimerTag = setTimer(
      () => {
        // 立即清除，实现 one-shot 防抖
        if (this.debounceTimerTag) {
          clearTimer(this.debounceTimerTag);
          this.debounceTimerTag = null;
        }
        this.callbacks.forEach((callback) => {
          try {
            callback(content);
          } catch (error) {
            log.error('[ClipboardMonitor] Callback error:', error);
          }
        });
      },
      this.options.debounceDelay,
      ClipboardMonitor.DEBOUNCE_TIMER_TAG
    );
  }

  /**
   * 处理应用状态变化
   */
  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.options.stopOnBackground) {
      return;
    }

    // 事件驱动模式不使用轮询计时器（原生监听器已覆盖前后台），跳过轮询增删
    if (this.eventMonitorActive) {
      if (nextAppState === 'active' && this.isMonitoring) {
        void this.checkClipboard();
      }
      return;
    }

    if (nextAppState === 'active') {
      // 应用进入前台，立即检查一次剪贴板（减少等待第一次轮询的延迟）
      // 再重启轮询计时器
      if (this.isMonitoring) {
        void this.checkClipboard();
        if (!this.pollingTimerTag) {
          this.startPolling();
        }
      }
    } else if (
      nextAppState === 'background' ||
      (nextAppState === 'inactive' && Platform.OS !== 'ios')
    ) {
      // 后台上传启用时不停止轮询
      const { useSettingsStore } = require('@/stores/settingsStore');
      const bgUploadEnabled =
        useSettingsStore.getState().config?.enableBackgroundTasks &&
        useSettingsStore.getState().config?.enableBackgroundUpload;
      if (!bgUploadEnabled) {
        // 应用进入后台，停止监听
        log.info(
          '[ClipboardMonitor] Background upload disabled, stopping polling (app went to background/inactive)'
        );
        this.stopPolling();
      }
    }
  };

  /**
   * 手动触发一次检查
   */
  async triggerCheck(): Promise<void> {
    await this.checkClipboard();
  }

  /**
   * 检查内容是否变化，如果变化则更新 lastContent 并持久化
   * @param content 要检查的内容
   * @returns 是否发生变化
   */
  async checkAndUpdateLastContent(content: ClipboardContent): Promise<boolean> {
    const changed = this.hasContentChanged(content);
    // 无论是否变化，都更新 lastContent 为完整内容
    this.lastContent = content;
    if (changed) {
      await this.persistHash(content);
    }
    return changed;
  }

  /**
   * 手动更新上次已知内容，防止监听器将外部设置的剪贴板内容误判为用户新复制
   */
  async setLastContent(content: ClipboardContent): Promise<void> {
    this.checkGeneration++; // 使正在进行的 checkClipboard 结果失效
    this.lastContent = content;
    await this.persistHash(content);
  }

  /**
   * 临时暂停轮询计时器，不改变 isMonitoring 状态。
   * 用于"程序内写入剪贴板"期间防止监听器误触发，配合 resumePolling 使用。
   */
  pausePolling(): void {
    // 事件驱动模式下无轮询计时器，但仍需门控事件回调，防止程序内写入被误判为新复制
    this.eventPaused = true;
    this.stopPolling();
  }

  /**
   * 恢复被 pausePolling 暂停的轮询计时器。
   * 会重置计时器间隔，下次轮询从调用此方法起重新计时。
   * 后台且后台上传未启用时，不恢复轮询（避免后台写入剪贴板后误重启轮询）。
   */
  resumePolling(): void {
    // 无论是否恢复轮询计时器，都先解除事件回调门控（事件模式仅需这一步）
    this.eventPaused = false;

    if (!this.isMonitoring) return;

    // 事件驱动模式无轮询计时器，解除门控即可
    if (this.eventMonitorActive) return;

    // 如果配置了后台停止，且当前在后台且后台上传未启用，则不恢复轮询
    if (this.options.stopOnBackground) {
      const currentState = AppState.currentState;
      if (currentState === 'background' || currentState === 'inactive') {
        const { useSettingsStore } = require('@/stores/settingsStore');
        const config = useSettingsStore.getState().config;
        const bgUploadEnabled = config?.enableBackgroundTasks && config?.enableBackgroundUpload;
        if (!bgUploadEnabled) {
          return;
        }
      }
    }

    this.startPolling();
  }

  /**
   * 更新轮询间隔
   * 如果正在监听，会重新启动轮询计时器
   */
  updatePollingInterval(interval: number): void {
    this.options.pollingInterval = interval;
    if (this.isMonitoring && this.pollingTimerTag) {
      this.startPolling();
    }
  }

  /**
   * 获取当前轮询间隔
   */
  getPollingInterval(): number {
    return this.options.pollingInterval;
  }

  /**
   * 重置监听器状态
   */
  async reset(): Promise<void> {
    this.lastContent = null;
    this.clipboardManager.resetLastProfileHash();
    try {
      await AsyncStorage.removeItem(LAST_CLIPBOARD_HASH_KEY);
    } catch (error) {
      log.error('[ClipboardMonitor] Failed to clear persisted hash:', error);
    }
  }
}

// 创建默认实例
import { clipboardManager } from './ClipboardManager';
import { log } from './Logger';
export const clipboardMonitor = new ClipboardMonitor(clipboardManager);
