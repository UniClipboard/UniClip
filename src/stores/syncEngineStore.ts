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
  return {
    baseUrl: server.url.replace(/\/+$/, ''),
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
      size: content.fileSize ?? (content.text?.length ?? 0),
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
    if (meta.kind === 'Text') {
      if (meta.hasData && payload) {
        appliedText = new TextDecoder().decode(payload);
        await Clipboard.setStringAsync(appliedText);
      } else {
        await Clipboard.setStringAsync(meta.text);
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
      });
      await useHistoryStore.getState().addItem(historyItem);
    } catch (e) {
      console.error('[SyncEngine] Failed to add to history:', e);
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

    console.log('[SyncEngineStore] Starting SyncEngine...');
    const serverInfo = getActiveServerInfo();
    console.log('[SyncEngineStore] Active server:', serverInfo ? serverInfo.baseUrl : 'none');

    engine = new SyncEngine({
      getActiveServer: getActiveServerInfo,
      getDeviceClipboard,
      getSettings,
      applyToDevice,
    });

    await engine.init();
    console.log('[SyncEngineStore] SyncEngine initialized');

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
