/**
 * History Storage Service
 * 历史记录存储服务 - 管理剪贴板历史记录
 *
 * 存储层:SQLite(经 db/historyRepository)。本类保留业务逻辑
 * (文件移动 / 变更通知批处理 / 版本迁移 / 去重决策 / App Group 导入),
 * 数据存取全部委托 repository。对外 public 方法签名与返回契约保持不变。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { HistoryFilter, HistorySort, STORAGE_KEYS } from '../types/storage';
import { getHistoryFileDir, saveHistoryFile } from '../utils/fileStorage';
import { File, Directory } from 'expo-file-system';
import { log } from './Logger';
import {
  importHistoryFromAppGroup,
  repairAppGroupHistoryPayloadUris,
} from './appGroupHistoryImport';
import { getDatabase } from './db/database';
import { historyRepository } from './db/historyRepository';

/**
 * 当前历史记录数据版本号(AsyncStorage 时代的数据结构版本,迁移导入时复用)
 */
const CURRENT_HISTORY_VERSION = 1;

/**
 * 迁移函数类型
 */
type MigrationFunction = (items: ClipboardItem[]) => ClipboardItem[];

/**
 * 版本迁移函数映射
 * key: 目标版本号
 * value: 从上一版本迁移到目标版本的函数
 */
const MIGRATIONS: Record<number, MigrationFunction> = {
  // v0 -> v1: 添加 syncStatus, isLocalFileReady, lastAccessed 字段
  1: (items: ClipboardItem[]): ClipboardItem[] => {
    return items.map((item) => {
      const migratedItem = { ...item };

      if (migratedItem.syncStatus === undefined) {
        if (migratedItem.fileUri || !migratedItem.hasData) {
          migratedItem.isLocalFileReady = true;
        }
        migratedItem.syncStatus = HistorySyncStatus.LocalOnly;
      }

      if (migratedItem.isLocalFileReady === undefined) {
        migratedItem.isLocalFileReady = !!(migratedItem.fileUri || !migratedItem.hasData);
      }

      if (migratedItem.lastAccessed === undefined) {
        migratedItem.lastAccessed = migratedItem.timestamp;
      }

      return migratedItem;
    });
  },
};

/**
 * 历史记录存储服务
 */
export type HistoryChangeCallback = (
  items: ClipboardItem[],
  action: 'add' | 'update' | 'delete'
) => void;

/**
 * 规范化 ClipboardItem，确保所有字段都有默认值
 */
function normalizeClipboardItem(item: ClipboardItem): ClipboardItem {
  return {
    type: item.type,
    text: item.text ?? '',
    profileHash: item.profileHash,
    hasData: item.hasData ?? false,
    dataName: item.dataName,
    size: item.size ?? 0,
    timestamp: item.timestamp ?? Date.now(),
    deviceName: item.deviceName,
    synced: item.synced,
    starred: item.starred ?? false,
    useCount: item.useCount ?? 0,
    localClipboardHash: item.localClipboardHash,
    fileUri: item.fileUri,
    syncStatus: item.syncStatus ?? HistorySyncStatus.LocalOnly,
    version: item.version ?? 0,
    lastModified: item.lastModified ?? Date.now(),
    lastAccessed: item.lastAccessed ?? Date.now(),
    isDeleted: item.isDeleted ?? false,
    pinned: item.pinned ?? false,
    isLocalFileReady: item.isLocalFileReady ?? true,
    from: item.from,
    hasRemoteData: item.hasRemoteData ?? false,
  };
}

export class HistoryStorage {
  private static instance: HistoryStorage | null = null;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationError: unknown = null;
  private maxHistorySize = 1000;
  private changeCallbacks: Set<HistoryChangeCallback> = new Set();
  private pendingChanges: { items: ClipboardItem[]; action: 'add' | 'update' | 'delete' }[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly NOTIFY_BATCH_SIZE = 50;
  private static readonly NOTIFY_DELAY_MS = 100;
  private silentMode = false;
  private sortConfig: HistorySort = { field: 'timestamp', order: 'desc' };

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): HistoryStorage {
    if (!HistoryStorage.instance) {
      HistoryStorage.instance = new HistoryStorage();
    }
    return HistoryStorage.instance;
  }

  /**
   * 设置排序配置(用于查询期排序基准)
   */
  public setSortConfig(sort: HistorySort): void {
    this.sortConfig = sort;
  }

  /**
   * 获取当前排序配置
   */
  public getSortConfig(): HistorySort {
    return { ...this.sortConfig };
  }

  // ─── 变更通知(批处理,保持不变)──────────────────────────

  public addChangeCallback(callback: HistoryChangeCallback): void {
    this.changeCallbacks.add(callback);
  }

  public removeChangeCallback(callback: HistoryChangeCallback): void {
    this.changeCallbacks.delete(callback);
  }

  public beginSilentMode(): void {
    this.silentMode = true;
  }

  public endSilentMode(): void {
    this.silentMode = false;
  }

  private notifyChange(item: ClipboardItem, action: 'add' | 'update' | 'delete'): void {
    if (this.silentMode) {
      return;
    }

    // 浅拷贝，避免 store 中的旧引用和新通知指向同一对象导致比较失效
    this.pendingChanges.push({ items: [{ ...item }], action });

    if (this.pendingChanges.length >= HistoryStorage.NOTIFY_BATCH_SIZE) {
      this.flushPendingChanges();
      return;
    }

    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.flushPendingChanges();
      }, HistoryStorage.NOTIFY_DELAY_MS);
    }
  }

  /**
   * 立即批量通知变更
   */
  private notifyChangeBatch(items: ClipboardItem[], action: 'add' | 'update' | 'delete'): void {
    if (this.silentMode) {
      return;
    }
    // 浅拷贝，避免 store 中的旧引用和新通知指向同一对象导致比较失效
    const copied = items.map((item) => ({ ...item }));
    for (const callback of this.changeCallbacks) {
      try {
        callback(copied, action);
      } catch (error) {
        log.error('[HistoryStorage] Error in change callback:', error);
      }
    }
  }

  /**
   * 刷新待处理的变更通知
   */
  private flushPendingChanges(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }

    if (this.pendingChanges.length === 0) return;

    const groupedChanges = new Map<'add' | 'update' | 'delete', ClipboardItem[]>();
    for (const change of this.pendingChanges) {
      const existing = groupedChanges.get(change.action) || [];
      existing.push(...change.items);
      groupedChanges.set(change.action, existing);
    }

    for (const [action, items] of groupedChanges) {
      for (const callback of this.changeCallbacks) {
        try {
          callback(items, action);
        } catch (error) {
          log.error('[HistoryStorage] Error in change callback:', error);
        }
      }
    }

    this.pendingChanges = [];
  }

  // ─── 初始化 & 迁移导入 ──────────────────────────────────

  /**
   * 初始化历史记录存储
   *
   * 并发调用共享同一次初始化。失败后门闩住并对后续调用快速抛出首个错误——初始化流水线是确定性的
   * (建库 + schema 迁移 + 一次性数据导入),立刻重跑不会有不同结果,只会让三十来个
   * `if (!initialized) await initialize()` 守卫把整条重型 IO 流水线反复重放。恢复手段是重启 app。
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationError !== null) throw this.initializationError;

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeOnce()
        .catch((error: unknown) => {
          log.error('[HistoryStorage] Failed to initialize:', error);
          this.initializationError = error;
          throw error;
        })
        .finally(() => {
          this.initializationPromise = null;
        });
    }
    return this.initializationPromise;
  }

  private async initializeOnce(): Promise<void> {
    // 读不到配置不致命:退回默认 maxHistorySize
    try {
      const { configStorage } = await import('./ConfigStorage');
      const config = await configStorage.getConfig();
      if (config?.maxHistoryItems) {
        this.maxHistorySize = config.maxHistoryItems;
      }
    } catch (error) {
      log.warn('[HistoryStorage] Failed to load maxHistoryItems from config:', error);
    }

    // 建库(含 schema 迁移)是唯一致命的一步:没有 DB 就没有历史功能,必须让调用方知道
    await getDatabase();

    // 以下三步都是一次性数据搬运(旧 AsyncStorage 历史 / iOS App Group 遗留 JSON / payload URI 修复)。
    // 失败只影响历史数据的完整性,DB 本身仍然可用——记录后继续,让 app 带着已有历史正常跑,
    // 而不是因为搬不动遗留数据就把整个历史功能拖垮(App Group 读取失败在 iOS 上是有先例的)。
    try {
      await this.migrateFromAsyncStorageOnce();
      await this.importAppGroupHistory();
      await this.repairAppGroupPayloadUris();
    } catch (error) {
      log.error('[HistoryStorage] History data import failed, continuing with existing DB:', error);
    }

    this.initialized = true;

    // 启动时清理孤儿数据
    this.cleanupOrphanedData().catch((error) => {
      log.error('[HistoryStorage] Failed to cleanup orphaned data on startup:', error);
    });
  }

  /**
   * 一次性迁移:旧 AsyncStorage 的 @syncclipboard:history → SQLite。
   * DB 非空即视为已迁移,跳过。复用现有 MIGRATIONS + normalize + dedupe。
   * 旧 JSON 保留(回滚保险),不删除。
   */
  private async migrateFromAsyncStorageOnce(): Promise<void> {
    if (!(await historyRepository.isEmpty())) {
      return;
    }

    const historyJson = await AsyncStorage.getItem(STORAGE_KEYS.HISTORY);
    if (!historyJson) {
      // 全新安装,无旧数据
      await AsyncStorage.setItem(STORAGE_KEYS.HISTORY_VERSION, CURRENT_HISTORY_VERSION.toString());
      return;
    }

    try {
      let items: ClipboardItem[] = (JSON.parse(historyJson) as ClipboardItem[]).map(
        normalizeClipboardItem
      );

      const storedVersion = parseInt(
        (await AsyncStorage.getItem(STORAGE_KEYS.HISTORY_VERSION)) || '0',
        10
      );
      if (storedVersion < CURRENT_HISTORY_VERSION) {
        items = await this.runMigrations(items, storedVersion);
      }

      // 自愈:去重(同 profileHash 大小写不敏感),避免网格 key 冲突
      const { items: deduped, removed } = this.dedupeByProfileHash(items);

      await historyRepository.replaceMany(deduped);
      log.info(
        `[HistoryStorage] Migrated ${deduped.length} items from AsyncStorage to SQLite (removed ${removed} duplicates)`
      );

      // 保留旧 JSON 作回滚,仅更新版本号
      await AsyncStorage.setItem(STORAGE_KEYS.HISTORY_VERSION, CURRENT_HISTORY_VERSION.toString());
    } catch (error) {
      log.error('[HistoryStorage] Failed to migrate AsyncStorage history to SQLite:', error);
    }
  }

  /**
   * 按 profileHash(不区分大小写)去重:保留 lastAccessed 最新的副本,
   * 合并 starred/pinned(或)与 useCount(取最大),缺失 fileUri 时从旧副本补齐。
   */
  private dedupeByProfileHash(items: ClipboardItem[]): {
    items: ClipboardItem[];
    removed: number;
  } {
    const byHash = new Map<string, ClipboardItem>();
    const order: string[] = [];

    for (const item of items) {
      const key = item.profileHash.toLowerCase();
      const existing = byHash.get(key);
      if (!existing) {
        byHash.set(key, item);
        order.push(key);
        continue;
      }

      const existingSeen = existing.lastAccessed || existing.timestamp;
      const itemSeen = item.lastAccessed || item.timestamp;
      const winner = itemSeen > existingSeen ? item : existing;
      const loser = winner === item ? existing : item;

      const merged: ClipboardItem = {
        ...winner,
        starred: winner.starred || loser.starred,
        pinned: winner.pinned || loser.pinned,
        useCount: Math.max(winner.useCount ?? 0, loser.useCount ?? 0),
      };
      if (!merged.fileUri && loser.fileUri) {
        merged.fileUri = loser.fileUri;
        merged.isLocalFileReady = loser.isLocalFileReady;
      }
      byHash.set(key, merged);
    }

    return {
      items: order.map((key) => byHash.get(key)!),
      removed: items.length - order.length,
    };
  }

  /**
   * 合并 App Group legacy JSON 日志(UserDefaults)进共享 SQLite。
   * 常态下扩展直写共享 DB,JSON 不再增长;但共享 DB 尚不可用时
   * (App 更新后未首启、容器暂不可读)扩展会回退写 JSON,所以每次
   * 启动都跑:按 profileHash 判重(含软删 tombstone,已删不复活),
   * 幂等且日志 ≤200 条,开销可忽略。
   */
  private async importAppGroupHistory(): Promise<void> {
    const existing = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });
    const imported = await importHistoryFromAppGroup(existing);
    if (imported.length > 0) {
      await historyRepository.replaceMany(imported.map(normalizeClipboardItem));
      await AsyncStorage.setItem(STORAGE_KEYS.HISTORY_VERSION, CURRENT_HISTORY_VERSION.toString());
    }
  }

  private async repairAppGroupPayloadUris(): Promise<void> {
    const existing = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });
    const { items, repaired } = await repairAppGroupHistoryPayloadUris(existing);
    if (repaired === 0) return;

    await historyRepository.replaceMany(items.map(normalizeClipboardItem));
  }

  /**
   * 执行数据迁移
   */
  private async runMigrations(
    items: ClipboardItem[],
    fromVersion: number
  ): Promise<ClipboardItem[]> {
    let migratedItems = [...items];

    for (let v = fromVersion + 1; v <= CURRENT_HISTORY_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (migration) {
        log.info(`[HistoryStorage] Running migration to version ${v}`);
        migratedItems = migration(migratedItems);
      }
    }

    return migratedItems;
  }

  // ─── 写入 ──────────────────────────────────────────────

  /**
   * 添加历史记录
   */
  public async addItem(item: ClipboardItem): Promise<ClipboardItem> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 处理文件复制逻辑
    let processedItem = { ...item };

    if (
      processedItem.hasData &&
      processedItem.fileUri &&
      processedItem.profileHash &&
      processedItem.dataName
    ) {
      try {
        const historyDir = getHistoryFileDir(processedItem.type, processedItem.profileHash);
        const historyDirUri = historyDir.uri;

        if (!processedItem.fileUri.startsWith(historyDirUri)) {
          const sourceFile = new File(processedItem.fileUri);
          if (sourceFile.exists) {
            if (Platform.OS === 'ios') {
              const data = await sourceFile.arrayBuffer();
              processedItem.fileUri = await saveHistoryFile(
                processedItem.type,
                processedItem.profileHash,
                processedItem.dataName,
                data
              );
              log.info('[HistoryStorage] File saved to history storage:', processedItem.fileUri);
            } else {
              const dir = getHistoryFileDir(processedItem.type, processedItem.profileHash);
              if (!dir.exists) {
                dir.create();
              }
              const targetFile = new File(dir, processedItem.dataName);
              if (!targetFile.exists) {
                sourceFile.move(targetFile);
              }
              processedItem.fileUri = targetFile.uri;
              log.info('[HistoryStorage] File moved to history directory:', targetFile.uri);
            }
          }
        }
      } catch (error) {
        log.error('[HistoryStorage] Failed to move file to history directory:', error);
      }
    }

    // 判重(大小写不敏感,靠列 COLLATE NOCASE)
    const existing = await historyRepository.getByProfileHash(processedItem.profileHash);

    let action: 'add' | 'update';
    let resultItem: ClipboardItem;

    if (existing) {
      // 更新现有记录 - 参照桌面客户端 AddLocalProfile 逻辑
      const text = !existing.text && processedItem.text ? processedItem.text : existing.text;
      const wasDeleted = existing.isDeleted === true;

      resultItem = {
        ...existing,
        text,
        fileUri: processedItem.fileUri ?? existing.fileUri,
        isLocalFileReady: true,
        isDeleted: false,
        lastModified: Date.now(),
        lastAccessed: Date.now(),
        version: existing.version + 1,
        syncStatus: wasDeleted
          ? HistorySyncStatus.LocalOnly
          : (processedItem.syncStatus ?? HistorySyncStatus.LocalOnly),
        from: processedItem.from,
      };
      await historyRepository.replace(resultItem);
      action = 'update';
    } else {
      // 添加新记录
      resultItem = {
        ...processedItem,
        timestamp: processedItem.timestamp || Date.now(),
      };
      await historyRepository.replace(resultItem);
      action = 'add';

      // 清理超出数量的记录（仅清理 LocalOnly 状态的记录）
      await this.cleanupByCount(this.maxHistorySize);
    }

    this.notifyChange(resultItem, action);
    return resultItem;
  }

  /**
   * 批量添加历史记录
   */
  public async addItems(items: ClipboardItem[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const addedItems: ClipboardItem[] = [];
    const updatedItems: ClipboardItem[] = [];

    for (const item of items) {
      const existing = await historyRepository.getByProfileHash(item.profileHash);

      if (existing) {
        const text = !existing.text && item.text ? item.text : existing.text;
        const wasDeleted = existing.isDeleted === true;

        updatedItems.push({
          ...existing,
          text,
          fileUri: item.fileUri ?? existing.fileUri,
          isLocalFileReady: true,
          isDeleted: false,
          lastModified: Date.now(),
          lastAccessed: Date.now(),
          version: wasDeleted ? existing.version + 1 : existing.version,
          syncStatus: wasDeleted ? HistorySyncStatus.NeedSync : existing.syncStatus,
        });
      } else {
        addedItems.push({
          ...item,
          timestamp: item.timestamp || Date.now(),
        });
      }
    }

    if (updatedItems.length > 0 || addedItems.length > 0) {
      await historyRepository.replaceMany([...updatedItems, ...addedItems]);
    }

    // 清理超出数量的记录（仅清理 LocalOnly 状态的记录）
    await this.cleanupByCount(this.maxHistorySize);

    if (addedItems.length > 0) {
      this.notifyChangeBatch(addedItems, 'add');
    }
    if (updatedItems.length > 0) {
      this.notifyChangeBatch(updatedItems, 'update');
    }
  }

  // ─── 查询 ──────────────────────────────────────────────

  /**
   * 根据 profileHash 获取历史记录
   */
  public async getItem(profileHash: string): Promise<ClipboardItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.getByProfileHash(profileHash);
  }

  /**
   * 根据 localClipboardHash 获取历史记录
   */
  public async getItemByLocalHash(localClipboardHash: string): Promise<ClipboardItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.getByLocalHash(localClipboardHash);
  }

  /**
   * 获取所有历史记录（排除软删除）
   */
  public async getAllItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.find(undefined, this.sortConfig, { includeDeleted: false });
  }

  /**
   * 获取所有历史记录（包括软删除）
   */
  public async getAllItemsIncludingDeleted(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.getAll(this.sortConfig, { includeDeleted: true });
  }

  /**
   * 获取分页历史记录（排除软删除）
   */
  public async getItems(page: number = 1, pageSize: number = 20): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.find(undefined, this.sortConfig, {
      includeDeleted: false,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
  }

  /**
   * 搜索和过滤历史记录（排除软删除）
   * Phase 0:仍返回全部符合条件的记录(分页在 Phase 1 接入)。
   */
  public async searchItems(
    filter?: HistoryFilter,
    sort?: HistorySort
  ): Promise<{ items: ClipboardItem[]; total: number }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const items = await historyRepository.find(filter, sort, { includeDeleted: false });
    return { items, total: items.length };
  }

  /**
   * 更新历史记录项
   */
  public async updateItem(profileHash: string, updates: Partial<ClipboardItem>): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) {
      throw new Error(`History item not found: ${profileHash}`);
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    const merged = { ...existing, ...filteredUpdates } as ClipboardItem;
    await historyRepository.replace(merged);
    this.notifyChange(merged, 'update');
  }

  /**
   * 批量更新历史记录项
   */
  public async updateItems(
    updates: { profileHash: string; updates: Partial<ClipboardItem> }[]
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const updatedItems: ClipboardItem[] = [];

    for (const { profileHash, updates: itemUpdates } of updates) {
      const existing = await historyRepository.getByProfileHash(profileHash);
      if (existing) {
        updatedItems.push({ ...existing, ...itemUpdates } as ClipboardItem);
      }
    }

    if (updatedItems.length > 0) {
      await historyRepository.replaceMany(updatedItems);
      this.notifyChangeBatch(updatedItems, 'update');
    }
  }

  // ─── 删除 ──────────────────────────────────────────────

  /**
   * 软删除历史记录项
   */
  public async softDeleteItem(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return;

    const updated: ClipboardItem = {
      ...existing,
      isDeleted: true,
      lastModified: Date.now(),
      version: existing.version + 1,
      syncStatus: HistorySyncStatus.NeedSync,
      isLocalFileReady: false,
    };
    await historyRepository.replace(updated);

    // 删除本地文件
    try {
      const { deleteHistoryFileDir } = await import('../utils/fileStorage');
      if (existing.type && existing.profileHash) {
        await deleteHistoryFileDir(existing.type, existing.profileHash);
        log.info(
          '[HistoryStorage] Soft deleted, file directory removed:',
          existing.type,
          existing.profileHash
        );
      }
    } catch (error) {
      log.error('[HistoryStorage] Failed to delete history file directory:', error);
    }

    this.notifyChange(updated, 'update');
  }

  /**
   * 批量软删除历史记录项
   */
  public async softDeleteItems(profileHashes: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const now = Date.now();
    const updatedItems: ClipboardItem[] = [];

    for (const hash of profileHashes) {
      const existing = await historyRepository.getByProfileHash(hash);
      if (existing) {
        updatedItems.push({
          ...existing,
          isDeleted: true,
          lastModified: now,
          version: (existing.version || 0) + 1,
          syncStatus: HistorySyncStatus.NeedSync,
          isLocalFileReady: false,
        });
      }
    }

    if (updatedItems.length > 0) {
      await historyRepository.replaceMany(updatedItems);

      // 批量删除本地文件
      try {
        const { deleteHistoryFileDir } = await import('../utils/fileStorage');
        for (const item of updatedItems) {
          if (item.type && item.profileHash) {
            try {
              await deleteHistoryFileDir(item.type, item.profileHash);
            } catch (error) {
              log.error(
                '[HistoryStorage] Failed to delete history file directory:',
                item.type,
                item.profileHash,
                error
              );
            }
          }
        }
      } catch (error) {
        log.error('[HistoryStorage] Failed to delete history file directories:', error);
      }

      this.notifyChangeBatch(updatedItems, 'update');
    }
  }

  /**
   * 物理删除历史记录项（用于孤儿数据清理和过期软删除清理）
   */
  public async physicalDeleteItem(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return;

    await historyRepository.remove(profileHash);
    this.notifyChange(existing, 'delete');

    try {
      const { deleteHistoryFileDir } = await import('../utils/fileStorage');
      if (existing.type && existing.profileHash) {
        await deleteHistoryFileDir(existing.type, existing.profileHash);
        log.info(
          '[HistoryStorage] History file directory deleted:',
          existing.type,
          existing.profileHash
        );
      }
    } catch (error) {
      log.error('[HistoryStorage] Failed to delete history file directory:', error);
    }
  }

  /**
   * 批量物理删除历史记录项（一次性删除，减少 IO）
   */
  public async physicalDeleteItems(profileHashes: string[]): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const deletedItems: ClipboardItem[] = [];
    for (const hash of profileHashes) {
      const existing = await historyRepository.getByProfileHash(hash);
      if (existing) {
        deletedItems.push(existing);
      }
    }

    if (deletedItems.length > 0) {
      await historyRepository.removeMany(deletedItems.map((i) => i.profileHash));
      this.notifyChangeBatch(deletedItems, 'delete');

      for (const item of deletedItems) {
        try {
          const { deleteHistoryFileDir } = await import('../utils/fileStorage');
          if (item.type && item.profileHash) {
            await deleteHistoryFileDir(item.type, item.profileHash);
          }
        } catch (error) {
          log.error('[HistoryStorage] Failed to delete history file directory:', error);
        }
      }
    }

    return deletedItems;
  }

  /**
   * 清理过期的软删除记录（30天后物理删除）
   */
  public async cleanupExpiredSoftDeletes(): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - THIRTY_DAYS_MS;

    const all = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });
    const expiredItems = all.filter(
      (item) => item.isDeleted && item.lastModified && item.lastModified < cutoffTime
    );

    if (expiredItems.length === 0) {
      return 0;
    }

    log.info(`[HistoryStorage] Cleaning up ${expiredItems.length} expired soft-deleted records`);

    await this.physicalDeleteItems(expiredItems.map((item) => item.profileHash));
    return expiredItems.length;
  }

  /**
   * 获取所有软删除的记录
   */
  public async getSoftDeletedItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    const all = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });
    return all.filter((item) => item.isDeleted);
  }

  /**
   * 恢复软删除的记录
   */
  public async restoreSoftDeletedItem(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (existing && existing.isDeleted) {
      const updated: ClipboardItem = {
        ...existing,
        isDeleted: false,
        lastModified: Date.now(),
        version: existing.version + 1,
        syncStatus: HistorySyncStatus.NeedSync,
      };
      await historyRepository.replace(updated);
      this.notifyChange(updated, 'update');
    }
  }

  // ─── 标记 / 置顶 / 访问 / 同步状态 ─────────────────────

  /**
   * 标记/取消标记历史记录
   */
  public async toggleStar(profileHash: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return false;

    const starred = !existing.starred;
    const updated: ClipboardItem = {
      ...existing,
      starred,
      lastModified: Date.now(),
      version: existing.version + 1,
      syncStatus:
        existing.syncStatus !== HistorySyncStatus.LocalOnly
          ? HistorySyncStatus.NeedSync
          : existing.syncStatus,
    };
    await historyRepository.replace(updated);
    this.notifyChange(updated, 'update');
    return starred;
  }

  /**
   * 置顶/取消置顶历史记录
   */
  public async togglePin(profileHash: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return false;

    const pinned = !existing.pinned;
    const updated: ClipboardItem = {
      ...existing,
      pinned,
      lastModified: Date.now(),
      version: existing.version + 1,
      syncStatus:
        existing.syncStatus !== HistorySyncStatus.LocalOnly
          ? HistorySyncStatus.NeedSync
          : existing.syncStatus,
    };
    await historyRepository.replace(updated);
    this.notifyChange(updated, 'update');
    return pinned;
  }

  /**
   * 更新最后访问时间（复制记录时调用）
   */
  public async updateLastAccessed(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return;

    const updated: ClipboardItem = { ...existing, lastAccessed: Date.now() };
    await historyRepository.replace(updated);
    this.notifyChange(updated, 'update');
  }

  /**
   * 更新同步状态
   */
  public async updateSyncStatus(
    profileHash: string,
    syncStatus: number,
    version?: number
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return;

    const updated: ClipboardItem = {
      ...existing,
      syncStatus,
      ...(version !== undefined ? { version } : {}),
    };
    await historyRepository.replace(updated);
    this.notifyChange(updated, 'update');
  }

  /**
   * 增加使用次数
   */
  public async incrementUseCount(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const existing = await historyRepository.getByProfileHash(profileHash);
    if (!existing) return;

    await historyRepository.replace({
      ...existing,
      useCount: (existing.useCount || 0) + 1,
    });
  }

  // ─── 同步相关查询 ──────────────────────────────────────

  /**
   * 获取需要同步的记录（syncStatus === NeedSync）
   */
  public async getNeedSyncItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.find({ syncStatus: [HistorySyncStatus.NeedSync] }, this.sortConfig, {
      includeDeleted: true,
    });
  }

  /**
   * 获取本地记录（syncStatus === LocalOnly）
   */
  public async getLocalOnlyItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.find({ syncStatus: [HistorySyncStatus.LocalOnly] }, this.sortConfig, {
      includeDeleted: true,
    });
  }

  /**
   * 获取服务器记录（isLocalFileReady === false 且 syncStatus === Synced）
   */
  public async getServerOnlyItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    const synced = await historyRepository.find(
      { syncStatus: [HistorySyncStatus.Synced] },
      this.sortConfig,
      { includeDeleted: true }
    );
    return synced.filter((item) => item.isLocalFileReady === false);
  }

  // ─── 统计 / 数量 ───────────────────────────────────────

  /**
   * 获取历史记录数量（排除软删除）
   */
  public async getCount(): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }
    return historyRepository.count(undefined, { includeDeleted: false });
  }

  /**
   * 获取历史记录统计信息
   */
  public async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    totalSize: number;
    starred: number;
    synced: number;
    pinned: number;
    localOnly: number;
    serverOnly: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });

    const stats = {
      total: all.length,
      byType: {} as Record<string, number>,
      totalSize: 0,
      starred: 0,
      synced: 0,
      pinned: 0,
      localOnly: 0,
      serverOnly: 0,
    };

    all.forEach((item) => {
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;

      if (item.size) {
        stats.totalSize += item.size;
      }
      if (item.starred) {
        stats.starred++;
      }
      if (item.synced) {
        stats.synced++;
      }
      if (item.pinned) {
        stats.pinned++;
      }
      if (item.syncStatus === HistorySyncStatus.LocalOnly || item.syncStatus === undefined) {
        stats.localOnly++;
      }
      if (item.syncStatus === HistorySyncStatus.Synced && item.isLocalFileReady === false) {
        stats.serverOnly++;
      }
    });

    return stats;
  }

  // ─── 清理 ──────────────────────────────────────────────

  /**
   * 清空历史记录
   */
  public async clear(): Promise<void> {
    await historyRepository.clearAll();
    // 一并清掉旧 AsyncStorage JSON(回滚数据)
    await AsyncStorage.removeItem(STORAGE_KEYS.HISTORY);

    // 删除历史记录文件夹下的所有文件
    try {
      const { initFileStorage } = await import('../utils/fileStorage');
      await initFileStorage();

      const { HISTORY_BASE_DIR } = await import('../utils/fileStorage');
      if (HISTORY_BASE_DIR.exists) {
        const entries = HISTORY_BASE_DIR.list();
        for (const entry of entries) {
          try {
            entry.delete();
          } catch (error) {
            log.error('[HistoryStorage] Failed to delete history entry:', error);
          }
        }
        log.info('[HistoryStorage] History files cleared');
      }
    } catch (error) {
      log.error('[HistoryStorage] Failed to clear history files:', error);
    }
  }

  /**
   * 清空旧记录（保留最近的 N 条）
   */
  public async cleanOldItems(keepCount: number = 100): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = await historyRepository.getAll(this.sortConfig, { includeDeleted: true });
    if (all.length > keepCount) {
      const toDelete = all.slice(keepCount);
      await historyRepository.removeMany(toDelete.map((i) => i.profileHash));
      return all.length - keepCount;
    }

    return 0;
  }

  /**
   * 设置最大历史记录大小
   */
  public setMaxHistorySize(size: number): void {
    if (size < 10) {
      throw new Error('Max history size must be at least 10');
    }
    this.maxHistorySize = size;
  }

  /**
   * 清理超出数量的记录（仅清理 LocalOnly 状态的记录）
   * @param maxCount 最大保留数量，0 表示不限制
   * @returns 删除的记录数量
   */
  public async cleanupByCount(maxCount: number = this.maxHistorySize): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    log.info(
      `[HistoryStorage] cleanupByCount called: maxCount=${maxCount}, current maxHistorySize=${this.maxHistorySize}`
    );

    if (maxCount === 0) {
      log.info('[HistoryStorage] cleanupByCount skipped: maxCount is 0');
      return 0;
    }

    // LocalOnly 且非 starred/pinned 的记录,按最旧在前
    const localOnly = await historyRepository.find(
      { syncStatus: [HistorySyncStatus.LocalOnly] },
      { field: 'timestamp', order: 'asc' },
      { includeDeleted: true }
    );
    const candidates = localOnly.filter((item) => !item.starred && !item.pinned);

    const total = await historyRepository.count(undefined, { includeDeleted: true });
    log.info(
      `[HistoryStorage] cleanupByCount: total items=${total}, localOnly items=${candidates.length}, maxCount=${maxCount}`
    );

    if (candidates.length <= maxCount) {
      log.info('[HistoryStorage] cleanupByCount skipped: no items to delete');
      return 0;
    }

    const toDeleteCount = candidates.length - maxCount;
    const itemsToDelete = candidates.slice(0, toDeleteCount);

    await historyRepository.removeMany(itemsToDelete.map((item) => item.profileHash));

    for (const item of itemsToDelete) {
      try {
        const { deleteHistoryFileDir } = await import('../utils/fileStorage');
        if (item.type && item.profileHash) {
          await deleteHistoryFileDir(item.type, item.profileHash);
        }
      } catch (error) {
        log.error('[HistoryStorage] Failed to delete history file directory:', error);
      }
    }

    this.notifyChangeBatch(itemsToDelete, 'delete');

    log.info(`[HistoryStorage] Cleaned up ${toDeleteCount} LocalOnly records`);
    return toDeleteCount;
  }

  /**
   * 清理孤儿数据（文件存在但记录不存在的数据）
   */
  public async cleanupOrphanedData(): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    let cleanedCount = 0;

    try {
      const { initFileStorage, HISTORY_BASE_DIR } = await import('../utils/fileStorage');
      await initFileStorage();

      if (!HISTORY_BASE_DIR.exists) {
        return 0;
      }

      const validProfileHashes = await historyRepository.allProfileHashesLower();

      const typeDirs = HISTORY_BASE_DIR.list();
      for (const typeDir of typeDirs) {
        if (!('isDirectory' in typeDir) || !typeDir.isDirectory) continue;

        const hashDirs = (typeDir as Directory).list();
        for (const hashDir of hashDirs) {
          if (!('isDirectory' in hashDir) || !hashDir.isDirectory) continue;

          const hashFromDir = (hashDir as Directory).name?.toLowerCase();
          if (hashFromDir && !validProfileHashes.has(hashFromDir)) {
            try {
              (hashDir as Directory).delete();
              cleanedCount++;
              log.info(`[HistoryStorage] Cleaned orphaned directory: ${hashDir.uri}`);
            } catch (error) {
              log.error('[HistoryStorage] Failed to delete orphaned directory:', error);
            }
          }
        }
      }

      if (cleanedCount > 0) {
        log.info(`[HistoryStorage] Cleaned ${cleanedCount} orphaned data directories`);
      }
    } catch (error) {
      log.error('[HistoryStorage] Failed to cleanup orphaned data:', error);
    }

    return cleanedCount;
  }
}

// 导出单例
export const historyStorage = HistoryStorage.getInstance();
