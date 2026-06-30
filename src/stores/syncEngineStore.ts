/**
 * SyncEngine Zustand Store — React bridge for the Rust-driven sync engine.
 *
 * Owns the SyncEngine lifecycle: creates the instance, wires it to the
 * clipboard system and settings, and exposes observable state + actions
 * to React components.
 */

import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  SyncEngine,
  type SyncEngineStatus,
  type DeviceClipboard,
  type SyncSettings,
} from '@/services/SyncEngine';
import { clipboardManager } from '@/services/ClipboardManager';
import { clipboardMonitor } from '@/services/ClipboardMonitor';
import { useSettingsStore } from './settingsStore';
import { calculateTextHash } from '@/utils/hash';
import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
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
let lastDeviceContent: ClipboardContent | null = null;

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
  };
}

function getDeviceClipboard(): DeviceClipboard | null {
  const content = lastDeviceContent;
  if (!content || !content.profileHash) return null;
  return {
    hash: content.profileHash,
    meta: {
      kind: (content.type ?? 'Text') as 'Text' | 'Image' | 'File' | 'Group',
      text: content.text ?? '',
      dataName: content.fileName ?? null,
      hasData: content.hasData ?? false,
      size: content.fileSize ?? content.text?.length ?? 0,
      hash: content.profileHash,
      // 设备本地内容尚无服务端身份；push 后下次 GET 时再学到。
      contentId: null,
    },
    payload: content.fileData,
    fileUri: content.fileUri,
  };
}

async function applyToDevice(meta: ClipboardMeta, payload?: ArrayBuffer): Promise<void> {
  clipboardMonitor.pausePolling();
  try {
    let appliedText = meta.text;
    let fileUri: string | undefined;

    if (meta.kind === 'Text') {
      if (meta.hasData && payload) {
        appliedText = new TextDecoder().decode(payload);
        await Clipboard.setStringAsync(appliedText);
      } else {
        await Clipboard.setStringAsync(meta.text);
      }
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
        } catch (e) {
          log.error('[SyncEngine] Failed to write applied image to system clipboard:', e);
        }
      }
    }

    // Echo protection: tell ClipboardMonitor this content is ours
    if (meta.hash) {
      const echoContent: ClipboardContent = {
        type: meta.kind as any,
        text: appliedText,
        profileHash: meta.hash,
        localClipboardHash: meta.hash,
      };
      await clipboardMonitor.setLastContent(echoContent);
      lastDeviceContent = echoContent;
    }

    // Add to history store so the card appears in UI
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

    await engine.init();
    log.info('[SyncEngineStore] SyncEngine initialized');

    engine.addListener((status) => {
      set({ status });
    });

    clipboardCallback = async (content) => {
      lastDeviceContent = content;
      if (content.profileHash) {
        engine?.noteDeviceWrite(content.profileHash);
      }
    };
    clipboardMonitor.addCallback(clipboardCallback);

    // Seed initial device content so the first tick sees it
    try {
      const current = await clipboardManager.getClipboardContent();
      if (current) {
        lastDeviceContent = current;
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

export function notifyDeviceClipboardChanged(content: ClipboardContent): void {
  lastDeviceContent = content;
  if (content.profileHash) {
    engine?.notifyDeviceChanged(content.profileHash);
  }
}
