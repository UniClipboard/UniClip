import { Directory, File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { log } from '@/services/Logger';

/**
 * 数据库文件名。iOS 上落在 App Group 容器的 Databases/ 子目录,
 * 键盘/分享扩展直接读写同一个文件(单一信源);Android 用默认位置。
 */
const DB_NAME = 'uniclipboard.db';

/** App Group 容器内的数据库子目录(与 payloads/ 平级) */
const APP_GROUP_DB_SUBDIR = 'Databases';

/**
 * Schema 版本。与 AsyncStorage 的 HISTORY_VERSION 解耦——
 * 这里管理的是 SQLite 表结构的演进,用 PRAGMA user_version 持久化。
 */
export const SCHEMA_VERSION = 2;

/** 历史记录表名 */
export const TABLE_HISTORY = 'clipboard_history';

/**
 * activate_clipboard 表名——单行同步寄存器,承载 reducer 每 tick 读取的 device_hash 代理。
 * 单一意图、低噪声,与多写者的 clipboard_history 隔离(见 docs/activate-clipboard-plan.md)。
 */
export const TABLE_ACTIVATE = 'activate_clipboard';

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
  const directory = await resolveIOSAppGroupDirectory();
  const db = await SQLite.openDatabaseAsync(DB_NAME, undefined, directory ?? undefined);
  // WAL 提升并发读写性能(官方推荐建库即开);跨进程(键盘/分享扩展)
  // 并发访问依赖 WAL + busy_timeout,两侧都必须设置。
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA busy_timeout = 3000;');
  await migrate(db);
  log.info(`[DB] opened ${DB_NAME} at ${directory ?? 'default'}, schema v${SCHEMA_VERSION}`);
  return db;
}

/**
 * iOS:解析 App Group 容器内的数据库目录,并在首次切换时把
 * 私有沙盒里的旧数据库文件(.db / -wal / -shm)搬过去。
 * 容器不可用(测试宿主、entitlement 缺失)时返回 null,回落默认目录。
 */
async function resolveIOSAppGroupDirectory(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const { getContainerUrl } = await import('app-group-store');
    const containerUrl = await getContainerUrl();
    if (!containerUrl) return null;

    const dir = new Directory(containerUrl, APP_GROUP_DB_SUBDIR);
    if (!dir.exists) dir.create({ intermediates: true });
    migrateSandboxDatabaseFiles(dir);

    // expo-sqlite 的 directory 参数是原生文件路径(非 file:// URI)
    return decodeURIComponent(dir.uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
  } catch (error) {
    log.warn('[DB] App Group container unavailable, using sandbox directory:', error);
    return null;
  }
}

/**
 * 一次性搬迁:旧版把 DB 建在私有沙盒(expo-sqlite 默认目录)。
 * App Group 里还没有 DB 而沙盒里有时,连同 -wal/-shm 一起移动,
 * 避免丢掉尚未 checkpoint 的写入。目标已存在则不动(幂等)。
 */
function migrateSandboxDatabaseFiles(targetDir: Directory): void {
  const targetDb = new File(targetDir, DB_NAME);
  if (targetDb.exists) return;

  const legacyDir = SQLite.defaultDatabaseDirectory as string;
  const legacyDb = new File(`file://${legacyDir}`, DB_NAME);
  if (!legacyDb.exists) return;

  for (const suffix of ['', '-wal', '-shm']) {
    const src = new File(`file://${legacyDir}`, `${DB_NAME}${suffix}`);
    if (!src.exists) continue;
    src.move(new File(targetDir, `${DB_NAME}${suffix}`));
  }
  log.info('[DB] moved sandbox database into App Group container');
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

  if (version === 1) {
    await migrateToV2(db);
    log.info('[DB] applied schema v2 (activate_clipboard + clipboard_history.contentId)');
    version = 2;
  }

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

/**
 * Schema v2 —— activate_clipboard 单行寄存器 + clipboard_history.contentId 列。
 *
 * - activate_clipboard:CHECK(id=1) 强制单行;profile_hash 指向必然存在的历史行,
 *   content_id 为当前行服务端身份的反规范化副本;删除该行 = device_present=false。
 * - clipboard_history.contentId:拉取/应用的条目回填 `blake3v1:<hex>`,本地复制为 null。
 *   不做回填,后续拉取自然填充。
 */
async function migrateToV2(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
CREATE TABLE IF NOT EXISTS ${TABLE_ACTIVATE} (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  profile_hash    TEXT NOT NULL,
  content_id      TEXT,
  activated_at_ms INTEGER NOT NULL
);
`);

  // ALTER TABLE ADD COLUMN 无 IF NOT EXISTS;迁移可能被中断后重跑,先探测列是否已存在。
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${TABLE_HISTORY})`);
  if (!cols.some((c) => c.name === 'contentId')) {
    await db.execAsync(`ALTER TABLE ${TABLE_HISTORY} ADD COLUMN contentId TEXT`);
  }
}

/** 仅供测试/调试:关闭并丢弃单例(下次 getDatabase 会重新打开) */
export async function _closeDatabaseForTest(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
    openPromise = null;
  }
}
