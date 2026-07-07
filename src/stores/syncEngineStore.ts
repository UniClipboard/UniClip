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
let clipboardCallback: ((content: ClipboardContent) => void) | null = null;

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
  const config = useSettingsStore.getState().config;
  return {
    autoApplyRemote: config?.autoApplyRemote ?? true,
    autoPushLocal: config?.autoPushLocal ?? false,
    enableSse: config?.enableSse ?? true,
  };
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

    // 剪贴板监听(Android 事件驱动 / 前台快照)捕获到本地新内容:写入 activate 寄存器,
    // 并强制一次 tick 让本地内容尽快 push(反 echo 由 writeActivate 内部处理)。
    clipboardCallback = async (content) => {
      if (!content.profileHash) return;
      await writeActivate(content);
      engine?.notifyLocalChanged();
    };
    clipboardMonitor.addCallback(clipboardCallback);

    // 首次前台快照:把当前系统剪贴板作为一次本地激活写入寄存器,让首个 tick 能看到它。
    try {
      const current = await clipboardManager.getClipboardContent();
      if (current) {
        await writeActivate(current);
      }
    } catch {
      // ignore
    }

    appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (!engine) return;
      if (state === 'active') {
        engine.setSceneInactive(false);
        engine.start();
      } else if (state === 'inactive') {
        engine.setSceneInactive(true);
      } else if (state === 'background') {
        engine.stop();
      }
    });

    engine.start();
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

    if (clipboardCallback) {
      clipboardMonitor.removeCallback(clipboardCallback);
      clipboardCallback = null;
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

/**
 * 用户主动产生的本地新内容(复制/粘贴/选图/拍照)——写入 activate 寄存器后强制一次 tick。
 * 先 await 写库,确保被强制的 tick 读到的是最新 device_hash 而非陈旧值。
 */
export async function notifyDeviceClipboardChanged(content: ClipboardContent): Promise<void> {
  if (!content.profileHash) return;
  // 主动激活:绕过被动 anti-echo(用户明确使用某项,即便等于刚 apply 的内容也要激活)。
  await writeActivate(content, { active: true });
  engine?.notifyLocalChanged();
}
