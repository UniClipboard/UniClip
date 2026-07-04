import * as SQLite from 'expo-sqlite';

import { log } from '@/services/Logger';

/** 数据库文件名(RN 私有沙盒,默认位置) */
const DB_NAME = 'uniclipboard.db';

/**
 * Schema 版本。与 AsyncStorage 的 HISTORY_VERSION 解耦——
 * 这里管理的是 SQLite 表结构的演进,用 PRAGMA user_version 持久化。
 */
export const SCHEMA_VERSION = 1;

/** 历史记录表名 */
export const TABLE_HISTORY = 'clipboard_history';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let openPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * 获取数据库单例(懒打开)。首次调用会打开连接、启用 WAL、执行 schema 迁移。
 * 并发调用共享同一个打开中的 Promise,避免重复打开。
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (!openPromise) {
    openPromise = openAndMigrate()
      .then((db) => {
        dbInstance = db;
        return db;
      })
      .catch((e) => {
        // 打开失败时清空 promise,允许后续重试
        openPromise = null;
        throw e;
      });
  }
  return openPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL 提升并发读写性能(官方推荐建库即开)
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  log.info(`[DB] opened ${DB_NAME}, schema v${SCHEMA_VERSION}`);
  return db;
}

/**
 * 按 user_version 递增迁移。每个版本块只前向应用一次。
 */
async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version >= SCHEMA_VERSION) {
    return;
  }

  if (version === 0) {
    await db.execAsync(CREATE_SCHEMA_V1);
    log.info('[DB] applied schema v1 (create table + indexes)');
    version = 1;
  }

  // 后续版本在此追加:
  // if (version === 1) { await db.execAsync(MIGRATE_V1_TO_V2); version = 2; }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Schema v1 —— 历史记录表 + 索引。
 *
 * 红线:
 * - profileHash 主键 COLLATE NOCASE(全库靠 .toLowerCase() 判重,漏了会复现网格 key 冲突)
 * - displayKind 物化列(getDisplayKind 的 JS 派生值,写入时算好,否则 SQL 筛不了类型)
 * - localClipboardHash 索引(每次读剪贴板都查)+ syncStatus 索引(同步全量扫)+ 排序复合索引
 * - 布尔字段一律 INTEGER(0/1)
 */
const CREATE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS ${TABLE_HISTORY} (
  profileHash        TEXT PRIMARY KEY COLLATE NOCASE,
  type               TEXT NOT NULL,
  text               TEXT NOT NULL DEFAULT '',
  displayKind        TEXT,
  dataName           TEXT,
  size               INTEGER,
  fileUri            TEXT,
  hasData            INTEGER NOT NULL DEFAULT 0,
  hasRemoteData      INTEGER NOT NULL DEFAULT 0,
  localClipboardHash TEXT,
  timestamp          INTEGER NOT NULL DEFAULT 0,
  lastAccessed       INTEGER NOT NULL DEFAULT 0,
  lastModified       INTEGER NOT NULL DEFAULT 0,
  useCount           INTEGER NOT NULL DEFAULT 0,
  starred            INTEGER NOT NULL DEFAULT 0,
  pinned             INTEGER NOT NULL DEFAULT 0,
  isDeleted          INTEGER NOT NULL DEFAULT 0,
  isLocalFileReady   INTEGER NOT NULL DEFAULT 0,
  syncStatus         INTEGER NOT NULL DEFAULT 0,
  version            INTEGER NOT NULL DEFAULT 0,
  "from"             TEXT,
  deviceName         TEXT,
  synced             INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hist_sort_ts   ON ${TABLE_HISTORY}(isDeleted, pinned, timestamp);
CREATE INDEX IF NOT EXISTS idx_hist_sort_acc  ON ${TABLE_HISTORY}(isDeleted, pinned, lastAccessed);
CREATE INDEX IF NOT EXISTS idx_hist_localhash ON ${TABLE_HISTORY}(localClipboardHash);
CREATE INDEX IF NOT EXISTS idx_hist_sync      ON ${TABLE_HISTORY}(syncStatus);
`;

/** 仅供测试/调试:关闭并丢弃单例(下次 getDatabase 会重新打开) */
export async function _closeDatabaseForTest(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
    openPromise = null;
  }
}
