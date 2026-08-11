/**
 * Settings Store
 * 设置状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { AppConfig } from '@/types/storage';
import { configStorage } from './internal/configStorage';
import { syncConfigToAppGroup } from '@/platform/app-group/appGroupAdapter';

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

  // 主题设置
  /** 获取主题 */
  getTheme: () => 'system' | 'light' | 'dark';

  /** 设置主题 */
  setTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>;

  // 通知设置
  /** 设置通知 */
  setNotifications: (enabled: boolean) => Promise<void>;

  /** 设置后台同步 */
  setSyncInBackground: (enabled: boolean) => Promise<void>;

  /** 设置自动检查更新 */
  setAutoCheckUpdate: (enabled: boolean) => Promise<void>;

  /** 设置是否更新到测试版 */
  setUpdateToBeta: (enabled: boolean) => Promise<void>;

  /** 设置日志等级 */
  setLogLevel: (level: 'debug' | 'info' | 'warn' | 'error') => Promise<void>;

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

  getTheme: () => {
    const { config } = get();
    return config?.appearance || 'system';
  },

  setTheme: async (theme: 'system' | 'light' | 'dark') => {
    await get().updateConfig({ appearance: theme });
  },

  setNotifications: async (enabled: boolean) => {
    await get().updateConfig({ enableNotifications: enabled });
  },

  setSyncInBackground: async (enabled: boolean) => {
    await get().updateConfig({ enableBackgroundTasks: enabled });
  },

  setAutoCheckUpdate: async (enabled: boolean) => {
    await get().updateConfig({ autoCheckUpdate: enabled });
  },

  setUpdateToBeta: async (enabled: boolean) => {
    await get().updateConfig({ updateToBeta: enabled });
  },

  setLogLevel: async (level: 'debug' | 'info' | 'warn' | 'error') => {
    await get().updateConfig({ logLevel: level });
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
