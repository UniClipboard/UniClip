/**
 * Config Storage Service
 * 配置存储服务 - 管理应用偏好和升级迁移
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../types/storage';
import { AppSettings, DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../types/settings';
import { migrateConfig, extractRuntimeState } from './ConfigMigration';
import { runtimeStateStorage } from './RuntimeStateStorage';
import { log } from './Logger';
import { seedConfigFromAppGroup } from './appGroupSeed';

/**
 * 配置存储服务
 */
const SCHEMA_VERSION_KEY = '@syncclipboard:schema_version';
export const CONFIG_USER_STATE_KEY = '@syncclipboard:config:user-state';
const LEGACY_CREDENTIAL_KEY = '@syncclipboard:credentials';
const LEGACY_SECURE_STORAGE_PREFIX = '@syncclipboard:secure:';

async function removeLegacyCredentials(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const legacyKeys = keys.filter(
      (key) => key === LEGACY_CREDENTIAL_KEY || key.startsWith(LEGACY_SECURE_STORAGE_PREFIX)
    );
    if (legacyKeys.length > 0) await AsyncStorage.multiRemove(legacyKeys);
  } catch (error) {
    log.warn('[ConfigStorage] Failed to remove legacy credentials:', error);
  }
}

export class ConfigStorage {
  private static instance: ConfigStorage | null = null;
  private config: AppSettings | null = null;
  private initialized = false;
  private updateQueue: Promise<void> = Promise.resolve();

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): ConfigStorage {
    if (!ConfigStorage.instance) {
      ConfigStorage.instance = new ConfigStorage();
    }
    return ConfigStorage.instance;
  }

  /**
   * 初始化配置存储
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadConfig();
      this.initialized = true;
    } catch (error) {
      log.error('[ConfigStorage] Failed to initialize:', error);
      this.config = { ...DEFAULT_SETTINGS };
      this.initialized = true;
    }
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    await removeLegacyCredentials();
    const configJson = await AsyncStorage.getItem(STORAGE_KEYS.CONFIG);
    const versionStr = await AsyncStorage.getItem(SCHEMA_VERSION_KEY);
    const storedVersion = versionStr ? parseInt(versionStr, 10) : 1;

    if (configJson) {
      let savedConfig: unknown;
      try {
        savedConfig = JSON.parse(configJson);
      } catch (error) {
        throw new Error('Stored config is not valid JSON', { cause: error });
      }

      if (storedVersion < SETTINGS_SCHEMA_VERSION) {
        const runtimeState = extractRuntimeState(savedConfig);
        await runtimeStateStorage.save(runtimeState);
        this.config = migrateConfig(savedConfig, storedVersion);
        await this.saveConfig();
        await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION));
      } else {
        this.config = migrateConfig(savedConfig);
      }
    } else {
      const seed = await seedConfigFromAppGroup();
      this.config = seed ? { ...DEFAULT_SETTINGS, ...seed } : { ...DEFAULT_SETTINGS };
      await this.saveConfig();
      await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION));
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(config: AppSettings | null = this.config): Promise<void> {
    if (!config) {
      throw new Error('Config not initialized');
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
    } catch (error) {
      log.error('[ConfigStorage] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 获取完整配置
   */
  public async getConfig(): Promise<AppSettings> {
    if (!this.initialized) {
      await this.initialize();
    }

    return { ...this.config! };
  }

  /**
   * 更新配置
   */
  public updateConfig(updates: Partial<AppSettings>): Promise<void> {
    const update = this.updateQueue.then(async () => {
      if (!this.initialized) {
        await this.initialize();
      }

      const nextConfig = { ...this.config!, ...updates };
      await AsyncStorage.setItem(CONFIG_USER_STATE_KEY, '1');
      await this.saveConfig(nextConfig);
      this.config = nextConfig;
    });

    // A failed write must reject its caller without poisoning later updates.
    this.updateQueue = update.catch(() => undefined);
    return update;
  }

  /**
   * 重置配置为默认值
   */
  public async resetConfig(): Promise<void> {
    this.config = { ...DEFAULT_SETTINGS };
    await this.saveConfig();
    await AsyncStorage.setItem(CONFIG_USER_STATE_KEY, '1');
  }

  // ========== 主题管理 ==========

  /**
   * 获取主题设置
   */
  public async getTheme(): Promise<'system' | 'light' | 'dark'> {
    const config = await this.getConfig();
    return config.appearance;
  }

  /**
   * 设置主题
   */
  public async setTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
    await this.updateConfig({ appearance: theme });
  }

  // ========== 通知设置管理 ==========

  /**
   * 是否启用通知
   */
  public async isNotificationsEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enableNotifications;
  }

  /**
   * 设置通知开关
   */
  public async setNotificationsEnabled(enabled: boolean): Promise<void> {
    await this.updateConfig({ enableNotifications: enabled });
  }

  // ========== 导入/导出 ==========

  /**
   * 导出配置为 JSON
   */
  public async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    return JSON.stringify(config, null, 2);
  }

  /**
   * 从 JSON 导入配置
   */
  public async importConfig(json: string): Promise<void> {
    try {
      const imported = JSON.parse(json);

      this.config = migrateConfig(imported);
      await this.saveConfig();
      await AsyncStorage.setItem(CONFIG_USER_STATE_KEY, '1');
    } catch (error) {
      log.error('[ConfigStorage] Failed to import config:', error);
      throw new Error('Invalid config JSON');
    }
  }

  /**
   * 清空所有配置
   */
  public async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.CONFIG);
    await AsyncStorage.removeItem(CONFIG_USER_STATE_KEY);
    this.config = { ...DEFAULT_SETTINGS };
    this.initialized = false;
  }
}

// 导出单例
export const configStorage = ConfigStorage.getInstance();
