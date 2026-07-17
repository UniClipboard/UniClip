/**
 * Settings Store
 * 设置状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { AppConfig } from '../types/storage';
import { ServerConfig } from '../types/api';
import { SyncMode, ConflictResolution } from '../types/sync';
import { configStorage } from '../services/ConfigStorage';
import { syncConfigToAppGroup } from '../services/appGroupSyncCore';

export type UpdateConfigResult = { ok: true } | { ok: false; error: string };

/**
 * 设置状态接口
 */
interface SettingsState {
  // 状态
  /** 应用配置 */
  config: AppConfig | null;

  /** 是否已加载 */
  isLoaded: boolean;

  /** 是否正在保存 */
  isSaving: boolean;

  /** 错误信息 */
  error: string | null;

  // 动作
  /** 加载配置 */
  loadConfig: () => Promise<void>;

  /** 更新配置，并显式返回持久化结果 */
  updateConfig: (updates: Partial<AppConfig>) => Promise<UpdateConfigResult>;

  /** 重置配置 */
  resetConfig: () => Promise<void>;

  // 服务器管理
  /** 获取服务器列表 */
  getServers: () => ServerConfig[];

  /** 获取当前服务器 */
  getActiveServer: () => ServerConfig | null;

  /** 添加服务器 */
  addServer: (server: ServerConfig) => Promise<void>;

  /** 更新服务器 */
  updateServer: (index: number, updates: Partial<ServerConfig>) => Promise<void>;

  /** 删除服务器 */
  deleteServer: (index: number) => Promise<void>;

  /** 设置激活服务器 */
  setActiveServer: (index: number) => Promise<void>;

  // 主题设置
  /** 获取主题 */
  getTheme: () => 'system' | 'light' | 'dark';

  /** 设置主题 */
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>;

  // 同步设置
  /** 设置同步模式 */
  setSyncMode: (mode: string) => Promise<void>;

  /** 设置同步间隔 */
  setSyncInterval: (interval: number) => Promise<void>;

  /** 设置冲突解决策略 */
  setConflictResolution: (strategy: string) => Promise<void>;

  /** 设置离线队列 */
  setOfflineQueue: (enabled: boolean) => Promise<void>;

  /** 设置大文件同步 */
  setLargeFileSync: (enabled: boolean, threshold?: number) => Promise<void>;

  // 通知设置
  /** 设置通知 */
  setNotifications: (enabled: boolean) => Promise<void>;

  /** 设置后台同步 */
  setSyncInBackground: (enabled: boolean) => Promise<void>;

  /** 设置启动时同步 */
  setSyncOnStartup: (enabled: boolean) => Promise<void>;

  /** 设置自动下载最大文件大小（字节） */
  setAutoDownloadMaxSize: (sizeInBytes: number) => Promise<void>;

  /** 设置自动检查更新 */
  setAutoCheckUpdate: (enabled: boolean) => Promise<void>;

  /** 设置上次检查更新日期 */
  setLastUpdateCheckDate: (date: string) => Promise<void>;

  /** 设置是否更新到测试版 */
  setUpdateToBeta: (enabled: boolean) => Promise<void>;

  /** 设置是否启用 SSE 推送通道 */
  setEnableSse: (enabled: boolean) => Promise<void>;

  /** 设置日志等级 */
  setLogLevel: (level: 'debug' | 'info' | 'warn' | 'error') => Promise<void>;

  /** 设置远程轮询间隔（毫秒） */
  setRemotePollingInterval: (interval: number) => Promise<void>;

  /** 设置本地轮询间隔（毫秒） */
  setLocalPollingInterval: (interval: number) => Promise<void>;

  /** 设置后台任务总开关 */
  setEnableBackgroundTasks: (enabled: boolean) => Promise<void>;

  /** 是否被临时停止（不持久化，重启后自动恢复） */
  isTempDisabledBackgroundTasks: boolean;

  /** 临时禁用/恢复后台任务（不修改持久化配置） */
  setTempDisabledBackgroundTasks: (disabled: boolean) => void;

  /** 设置后台下载远程 */
  setEnableBackgroundDownload: (enabled: boolean) => Promise<void>;

  /** 设置后台上传本地 */
  setEnableBackgroundUpload: (enabled: boolean) => Promise<void>;

  /** 设置悬浮窗获取剪贴板 */
  setEnableClipboardOverlay: (enabled: boolean) => Promise<void>;

  /** 设置自动上传短信验证码 */
  setEnableSmsForwarding: (enabled: boolean) => Promise<void>;

  // 导入/导出
  /** 导出配置 */
  exportConfig: () => Promise<string>;

  /** 导入配置 */
  importConfig: (json: string) => Promise<void>;

  /** 清除错误 */
  clearError: () => void;
}

/**
 * 初始状态
 */
const initialState = {
  config: null,
  isLoaded: false,
  isSaving: false,
  error: null,
  isTempDisabledBackgroundTasks: false,
};

async function publishConfig(config: AppConfig): Promise<void> {
  await syncConfigToAppGroup(config);
}

let configUpdateQueue: Promise<void> = Promise.resolve();

function notifySyncEngineServerChanged(): void {
  try {
    const { notifyServerChanged } = require('./syncEngineStore');
    notifyServerChanged();
  } catch {
    // SyncEngine is optional until its store has been initialized.
  }
}

/**
 * 创建设置 Store
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialState,

  loadConfig: async () => {
    try {
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isLoaded: true, error: null });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load config';
      set({ error: errorMessage, isLoaded: false });
    }
  },

  updateConfig: (updates: Partial<AppConfig>) => {
    const update = configUpdateQueue.then(async (): Promise<UpdateConfigResult> => {
      // 保存旧值用于持久化失败时回滚（乐观更新模式）
      const prevConfig = get().config;
      set((state) => ({
        config: state.config ? { ...state.config, ...updates } : null,
        isSaving: true,
        error: null,
      }));

      try {
        await configStorage.updateConfig(updates);
        const config = await configStorage.getConfig();
        await publishConfig(config);
        set({ config, isSaving: false });
        // autoApplyRemote 是引擎内部持有的设置（auto_apply），改动要推给引擎；
        // autoPushLocal 是客户端侧门控（协调器 push 时读），无需通知引擎。
        if ('autoApplyRemote' in updates) {
          try {
            const { notifySettingsChanged } = require('./syncEngineStore');
            notifySettingsChanged();
          } catch {
            // SyncEngine not yet initialized
          }
        }
        return { ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update config';
        // 回滚乐观更新，保证内存 config 与持久化层一致
        set({ config: prevConfig, error: errorMessage, isSaving: false });
        return { ok: false, error: errorMessage };
      }
    });

    configUpdateQueue = update.then(
      () => undefined,
      () => undefined
    );
    return update;
  },

  resetConfig: async () => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.resetConfig();
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reset config';
      set({ error: errorMessage, isSaving: false });
    }
  },

  getServers: () => {
    const { config } = get();
    return config?.servers || [];
  },

  getActiveServer: () => {
    const { config } = get();
    if (!config || config.activeServerIndex < 0) {
      return null;
    }
    return config.servers[config.activeServerIndex] || null;
  },

  addServer: async (server: ServerConfig) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.addServer(server);
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  updateServer: async (index: number, updates: Partial<ServerConfig>) => {
    const updatesActiveServer = get().config?.activeServerIndex === index;
    set({ isSaving: true, error: null });

    try {
      await configStorage.updateServer(index, updates);
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
      if (updatesActiveServer) notifySyncEngineServerChanged();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  deleteServer: async (index: number) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.deleteServer(index);
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  setActiveServer: async (index: number) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.setActiveServer(index);
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
      notifySyncEngineServerChanged();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set active server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  getTheme: () => {
    const { config } = get();
    return config?.appearance || 'system';
  },

  setTheme: async (theme: 'system' | 'light' | 'dark') => {
    await get().updateConfig({ appearance: theme });
  },

  setSyncMode: async (mode: string) => {
    await get().updateConfig({ syncMode: mode as SyncMode });
  },

  setSyncInterval: async (interval: number) => {
    await get().updateConfig({ syncInterval: interval });
  },

  setConflictResolution: async (strategy: string) => {
    await get().updateConfig({ conflictResolution: strategy as ConflictResolution });
  },

  setOfflineQueue: async (enabled: boolean) => {
    await get().updateConfig({ enableOfflineQueue: enabled });
  },

  setLargeFileSync: async (enabled: boolean, threshold?: number) => {
    const updates: Partial<AppConfig> = { syncLargeFiles: enabled };
    if (threshold !== undefined) {
      updates.largeFileThreshold = threshold;
    }
    await get().updateConfig(updates);
  },

  setNotifications: async (enabled: boolean) => {
    await get().updateConfig({ enableNotifications: enabled });
  },

  setSyncInBackground: async (enabled: boolean) => {
    await get().updateConfig({ enableBackgroundTasks: enabled });
  },

  setSyncOnStartup: async (enabled: boolean) => {
    await get().updateConfig({ syncOnStartup: enabled });
  },

  setAutoDownloadMaxSize: async (sizeInBytes: number) => {
    await get().updateConfig({ autoDownloadMaxSize: sizeInBytes });
  },

  setAutoCheckUpdate: async (enabled: boolean) => {
    await get().updateConfig({ autoCheckUpdate: enabled });
  },

  setLastUpdateCheckDate: async (date: string) => {
    const { runtimeStateStorage } = await import('../services/RuntimeStateStorage');
    await runtimeStateStorage.update({ lastUpdateCheckDate: date });
  },

  setUpdateToBeta: async (enabled: boolean) => {
    await get().updateConfig({ updateToBeta: enabled });
  },

  setEnableSse: async (enabled: boolean) => {
    await get().updateConfig({ enableSse: enabled });
    try {
      const { notifySseSettingChanged } = require('./syncEngineStore');
      notifySseSettingChanged();
    } catch {
      // SyncEngine not yet initialized
    }
  },

  setLogLevel: async (level: 'debug' | 'info' | 'warn' | 'error') => {
    await get().updateConfig({ logLevel: level });
  },

  setRemotePollingInterval: async (interval: number) => {
    await get().updateConfig({ remotePollingInterval: interval });
  },

  setLocalPollingInterval: async (interval: number) => {
    await get().updateConfig({ localPollingInterval: interval });
  },

  setEnableBackgroundTasks: async (enabled: boolean) => {
    if (enabled) {
      // 用户主动开启时清除临时停止标志
      set({ isTempDisabledBackgroundTasks: false });
    }
    await get().updateConfig({ enableBackgroundTasks: enabled });
  },

  setTempDisabledBackgroundTasks: (disabled: boolean) => {
    set({ isTempDisabledBackgroundTasks: disabled });
  },

  setEnableBackgroundDownload: async (enabled: boolean) => {
    await get().updateConfig({ enableBackgroundDownload: enabled });
  },

  setEnableBackgroundUpload: async (enabled: boolean) => {
    await get().updateConfig({ enableBackgroundUpload: enabled });
  },

  setEnableClipboardOverlay: async (enabled: boolean) => {
    await get().updateConfig({ enableClipboardOverlay: enabled });
  },

  setEnableSmsForwarding: async (enabled: boolean) => {
    await get().updateConfig({ enableSmsForwarding: enabled });
  },

  exportConfig: async () => {
    try {
      return await configStorage.exportConfig();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export config';
      set({ error: errorMessage });
      throw error;
    }
  },

  importConfig: async (json: string) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.importConfig(json);
      const config = await configStorage.getConfig();
      await publishConfig(config);
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to import config';
      set({ error: errorMessage, isSaving: false });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
