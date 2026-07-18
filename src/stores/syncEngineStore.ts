/**
 * SyncEngine Zustand Store — React bridge for the Rust-driven sync engine.
 *
 * Owns the SyncEngine lifecycle: creates the instance, wires it to the
 * clipboard system and settings, and exposes observable state + actions
 * to React components.
 */

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import {
  SyncEngine,
  type SyncEngineStatus,
  type DeviceClipboard,
  type SyncSettings,
} from '@/services/SyncEngine';
import { clipboardManager } from '@/services/ClipboardManager';
import { clipboardMonitor } from '@/services/ClipboardMonitor';
import { useSettingsStore } from './settingsStore';
import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import { activateRepository } from '@/services/db/activateRepository';
import { historyRepository } from '@/services/db/historyRepository';
import { writeActivate, clearActivate, noteApplied } from '@/services/ActivateClipboardService';
import type { ClipboardMeta } from 'uc-core';
import type { ClipboardContent } from '@/types';
import { log } from '@/services/Logger';
import {
  canAutoApplyInBackground,
  canAutoPushInBackground,
  shouldRunBackgroundSync,
} from '@/utils/syncDirectionPolicy';

interface SyncEngineState {
  status: SyncEngineStatus;
  isRunning: boolean;

  start: () => Promise<void>;
  stop: () => void;
  forceSync: () => Promise<void>;
  applyStagedEntry: () => Promise<void>;
  acknowledgeLoop: () => Promise<void>;
}

let engine: SyncEngine | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
const automaticPushesInFlight = new Map<string, Promise<void>>();

function getActiveServerInfo() {
  const settings = useSettingsStore.getState();
  const server = settings.getActiveServer();
  if (!server || !server.url) return null;
  const config = settings.config;
  const urls = server.urls && server.urls.length > 0 ? server.urls : [server.url];
  return {
    baseUrl: server.url.replace(/\/+$/, ''),
    urls,
    username: server.username || '',
    password: server.password || '',
    trustInsecureCert: config?.trustInsecureCert ?? false,
  };
}

function getSettings(): SyncSettings {
  const settings = useSettingsStore.getState();
  const config = settings.config;
  const appIsBackground = AppState.currentState !== 'active';
  const backgroundTemporarilyDisabled = settings.isTempDisabledBackgroundTasks;
  return {
    autoApplyRemote: appIsBackground
      ? canAutoApplyInBackground(config, backgroundTemporarilyDisabled)
      : config?.autoApplyRemote ?? true,
    autoPushLocal: appIsBackground
      ? canAutoPushInBackground(config, backgroundTemporarilyDisabled)
      : config?.autoPushLocal ?? true,
    enableSse: config?.enableSse ?? true,
  };
}

function shouldKeepRemoteSyncRunningInBackground(): boolean {
  const settings = useSettingsStore.getState();
  const config = settings.config;
  return shouldRunBackgroundSync(config, settings.isTempDisabledBackgroundTasks);
}

export function reconcileSyncEngineAppState(state: AppStateStatus = AppState.currentState): void {
  if (!engine) return;

  if (state === 'active') {
    engine.setSceneInactive(false);
    void engine.applySettings();
    engine.start();
    return;
  }

  engine.setSceneInactive(true);
  if (state !== 'background') return;

  void engine.applySettings();
  if (shouldKeepRemoteSyncRunningInBackground()) {
    engine.start();
  } else {
    engine.stop();
  }
}

/**
 * device_hash 代理 —— reducer 每 tick 读此值(§6)。
 * 读 activate_clipboard 单行,经 profile_hash 指针解析出 clipboard_history 行,拼成
 * DeviceClipboard。activate 被清空(apply 后)→ 返回 null → device_present=false。
 * 不提供 payload(ArrayBuffer):push 路径会按 hash/dataName 从文件存储按需读字节。
 */
async function getDeviceClipboard(): Promise<DeviceClipboard | null> {
  try {
    const activate = await activateRepository.get();
    if (!activate) return null;
    const item = await historyRepository.getByProfileHash(activate.profileHash);
    if (!item) return null;
    return {
      hash: item.profileHash,
      meta: {
        kind: (item.type ?? 'Text') as 'Text' | 'Image' | 'File' | 'Group',
        text: item.text ?? '',
        dataName: item.dataName ?? null,
        hasData: item.hasData ?? false,
        size: item.size ?? item.text?.length ?? 0,
        hash: item.profileHash,
        // content_id 优先取寄存器反规范化副本,回退历史行(拉取项才有,本地为 null)。
        contentId: activate.contentId ?? item.contentId ?? null,
      },
      payload: undefined,
      fileUri: item.fileUri,
    };
  } catch (e) {
    log.error('[SyncEngineStore] getDeviceClipboard failed:', e);
    return null;
  }
}

async function applyToDevice(meta: ClipboardMeta, payload?: ArrayBuffer): Promise<void> {
  clipboardMonitor.pausePolling();
  try {
    let appliedText = meta.text;
    let fileUri: string | undefined;
    // 这次 apply 是否真的把内容写进了系统剪贴板。File 类型写不进 Android 系统剪贴板,
    // 故保持 false——用于避免向 echo 保护 / anti-echo 谎报「系统剪贴板已是本内容」。
    let wroteToClipboard = false;

    if (meta.kind === 'Text') {
      if (meta.hasData && payload) {
        appliedText = new TextDecoder().decode(payload);
        await ClipboardProxy.setStringAsync(appliedText);
      } else {
        await ClipboardProxy.setStringAsync(meta.text);
      }
      wroteToClipboard = true;
    } else if (meta.hasData && payload && meta.dataName && meta.hash) {
      const { saveHistoryFile } = await import('@/utils/fileStorage');
      fileUri = await saveHistoryFile(meta.kind, meta.hash, meta.dataName, payload);
      // 图片必须真正写入系统剪贴板。否则 apply 只落了历史文件，系统剪贴板仍是设备
      // 原有内容；ClipboardMonitor 下一轮读回旧内容并覆盖 device 视图，reducer 便
      // 反复判定「服务端有新图」→ 不停重复 pull 同一张图（并把旧内容 push 回去），
      // 形成 pull/push 震荡。文本分支已写剪贴板，图片分支此前遗漏。
      if (fileUri && meta.kind === 'Image') {
        try {
          await clipboardManager.setImageContent(fileUri);
          wroteToClipboard = true;
        } catch (e) {
          log.error('[SyncEngine] Failed to write applied image to system clipboard:', e);
        }
      }
    }

    // Echo protection: 只有这次 apply 真的写入了系统剪贴板时,才把它登记为
    // ClipboardMonitor 的 lastContent。File 写不进 Android 系统剪贴板,系统剪贴板仍
    // 停留在上一条内容;若在此谎报 meta.hash,monitor 回读到真实残留(上一条文本)时
    // 会误判为「新变化」→ 触发 writeActivate 污染 activate 寄存器 → 把旧内容 push 回
    // 去,覆盖服务端刚同步来的文件。跳过后 lastContent 保持真实残留,回读即被当作
    // echo 丢弃(不依赖时间窗,永久有效)。
    if (meta.hash && wroteToClipboard) {
      const echoContent: ClipboardContent = {
        type: meta.kind as any,
        text: appliedText,
        profileHash: meta.hash,
        localClipboardHash: meta.hash,
      };
      await clipboardMonitor.setLastContent(echoContent);
    }

    // §3:被动应用的内容不是一次「激活」。清空 activate 寄存器(无条件)。anti-echo 基准
    // 只在真的写入了系统剪贴板时更新,使 lastAppliedHash 始终等于系统剪贴板的真实残留——
    // File 应用后它保持文件之前那条文本的 hash,回读该文本时反 echo 直接跳过。
    if (wroteToClipboard) {
      noteApplied(meta.hash ?? null);
    }
    await clearActivate();

    // Add to history store so the card appears in UI（回填 contentId:保留服务端身份,
    // 供「用户重新激活此拉取项」时自然带回 content_id）
    try {
      const { useHistoryStore } = require('./historyStore');
      const historyItem = createDefaultClipboardItem({
        type: meta.kind,
        text: appliedText,
        profileHash: meta.hash ?? '',
        hasData: meta.hasData,
        dataName: meta.dataName ?? undefined,
        size: meta.size,
        timestamp: Date.now(),
        syncStatus: HistorySyncStatus.Synced,
        fileUri,
        isLocalFileReady: !!fileUri || !meta.hasData,
        from: 'server',
        contentId: meta.contentId ?? undefined,
      });
      await useHistoryStore.getState().addItem(historyItem);
    } catch (e) {
      log.error('[SyncEngine] Failed to add to history:', e);
    }

    // Notify old ClipboardSyncService store for upload-progress UI compatibility
    try {
      const { useClipboardSyncServiceStore } = require('./ClipboardSyncServiceStore');
      useClipboardSyncServiceStore.getState().setRemoteContent({
        type: meta.kind as any,
        text: appliedText,
        profileHash: meta.hash ?? undefined,
        hasData: meta.hasData,
        fileName: meta.dataName ?? undefined,
        fileSize: meta.size,
      });
    } catch {
      // store not initialized yet
    }
  } finally {
    clipboardMonitor.resumePolling();
  }
}

export const useSyncEngineStore = create<SyncEngineState>((set) => ({
  status: {
    state: 'Idle',
    lastSyncedAt: null,
    lastError: null,
    isExplicitlyRefreshing: false,
    stagedEntry: null,
  },
  isRunning: false,

  start: async () => {
    if (engine) return;

    log.info('[SyncEngineStore] Starting SyncEngine...');
    const serverInfo = getActiveServerInfo();
    log.info('[SyncEngineStore] Active server:', serverInfo ? serverInfo.baseUrl : 'none');

    engine = new SyncEngine({
      getActiveServer: getActiveServerInfo,
      getDeviceClipboard,
      getSettings,
      applyToDevice,
    });

    engine.addListener((status) => {
      set({ status });
    });

    appStateSubscription = AppState.addEventListener('change', reconcileSyncEngineAppState);

    engine.start();
    reconcileSyncEngineAppState();
    set({ isRunning: true });
  },

  stop: () => {
    if (!engine) return;

    engine.destroy();
    engine = null;

    if (appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
    }

    set({
      isRunning: false,
      status: {
        state: 'Idle',
        lastSyncedAt: null,
        lastError: null,
        isExplicitlyRefreshing: false,
        stagedEntry: null,
      },
    });
  },

  forceSync: async () => {
    if (!engine) return;
    await engine.explicitRefresh();
  },

  applyStagedEntry: async () => {
    if (!engine) return;
    await engine.applyStagedEntry();
  },

  acknowledgeLoop: async () => {
    if (!engine) return;
    await engine.acknowledgeLoop();
  },
}));

export function notifyServerChanged(): void {
  engine?.handleServerChanged();
}

export function notifyNetworkChanged(): void {
  engine?.handleNetworkChanged();
}

/** enableSse 开关翻转时调用：按最新设置断开或重建 SSE 订阅。 */
export function notifySseSettingChanged(): void {
  engine?.restartSse();
}

/** autoApplyRemote 等引擎设置变更时调用：把最新 auto_apply 推给引擎。 */
export function notifySettingsChanged(): void {
  void engine?.applySettings();
}

/** 本地新内容落库后，按当前方向设置当场尝试上传一次。失败只保留本地，不排队重试。 */
export async function notifyDeviceClipboardChanged(content: ClipboardContent): Promise<void> {
  const profileHash = content.profileHash;
  if (!profileHash) return;

  // 保留既有的主动激活/历史兜底语义，但不把它留给生命周期或网络恢复补传。
  await writeActivate(content, { active: true });
  await clearActivate();

  if (!getSettings().autoPushLocal) return;

  const key = profileHash.toUpperCase();
  const existing = automaticPushesInFlight.get(key);
  if (existing) return existing;

  const attempt = (async () => {
    if (!engine) {
      await useSyncEngineStore.getState().start();
    }
    if (!engine) return;

    try {
      await engine.pushRecordExplicit(profileHash);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.info('[SyncEngineStore] Automatic push failed; kept local:', detail);
    }
  })().finally(() => {
    automaticPushesInFlight.delete(key);
  });

  automaticPushesInFlight.set(key, attempt);
  await attempt;
}

/**
 * 显式推送一条已落库记录到服务器（uc-core putClipboard 直传，绕过 autoPushLocal 门控）。
 *
 * 供 BackgroundUploadManager（FAB / 分享上传）与前台文本上传使用:内容先 import*ToHistory
 * 落库(LocalOnly),再用此函数按 profileHash 推送。成功后 pushRecordExplicit 把该行标记
 * Synced;失败(离线等)向上抛,交调用方退避重试。
 *
 * 引擎未启动时先冷启一次(用户显式上传意图应尽力送达)。注意 start() 副作用较重——会注册
 * 剪贴板监听 / AppState 监听、并抓一次系统剪贴板快照写入 activate 寄存器;正常路径下引擎
 * 早已由 BackgroundServiceManager 启动,此分支极少走到(仅冷启兜底)。
 */
export async function pushHistoryRecordViaEngine(profileHash: string): Promise<void> {
  if (!engine) {
    await useSyncEngineStore.getState().start();
  }
  if (!engine) throw new Error('SyncEngine failed to start');
  await engine.pushRecordExplicit(profileHash);
}
