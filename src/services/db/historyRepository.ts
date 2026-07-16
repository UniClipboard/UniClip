import { ClipboardItem } from '@/types/clipboard';
import { HistoryFilter, HistorySort } from '@/types/storage';

import { getDatabase, TABLE_HISTORY } from './database';
import { fromRow, HISTORY_COLUMNS, HistoryRow, rowValues, toRow } from './rowMapper';

/**
 * 历史记录的 SQL 数据访问层。
 *
 * 只做「数据存取」,不含业务逻辑(文件移动 / 通知 / 迁移决策仍在 HistoryStorage)。
 * add/update 分支在上层都构造完整 ClipboardItem,故写入统一走 INSERT OR REPLACE(upsert)。
 */

type QueryOpts = { limit?: number; offset?: number; includeDeleted?: boolean };

/** 列名转 SQL 标识符("from" 是保留字) */
const colId = (c: string): string => (c === 'from' ? '"from"' : c);

/** 转义 LIKE 的特殊字符(% _ \),配合 ESCAPE '\' 使用 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * 把 HistoryFilter 翻译成 SQL WHERE。**必须与 utils/historyFilters.ts 的
 * matchesHistoryFilter 语义等价**(R7):初始查询走这里,增量走 JS,两者要一致。
 */
function buildWhere(
  filter: HistoryFilter | undefined,
  includeDeleted: boolean
): { clause: string; params: (string | number)[] } {
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (!includeDeleted) {
    conds.push('isDeleted = 0');
  }

  if (filter) {
    if (filter.type && filter.type.length > 0) {
      conds.push(`type IN (${filter.type.map(() => '?').join(',')})`);
      params.push(...filter.type);
    }
    if (filter.displayKinds && filter.displayKinds.length > 0) {
      conds.push(`displayKind IN (${filter.displayKinds.map(() => '?').join(',')})`);
      params.push(...filter.displayKinds);
    }
    if (filter.startDate != null) {
      conds.push('timestamp >= ?');
      params.push(filter.startDate);
    }
    if (filter.endDate != null) {
      conds.push('timestamp <= ?');
      params.push(filter.endDate);
    }
    if (filter.keyword) {
      // matchesHistoryFilter: text.includes(kw) || dataName.includes(kw),大小写不敏感
      const kw = `%${escapeLike(filter.keyword.toLowerCase())}%`;
      conds.push(
        `(LOWER(text) LIKE ? ESCAPE '\\' OR LOWER(IFNULL(dataName, '')) LIKE ? ESCAPE '\\')`
      );
      params.push(kw, kw);
    }
    if (filter.starredOnly) {
      conds.push('starred = 1');
    }
    if (filter.syncedOnly) {
      conds.push('synced = 1');
    }
    if (filter.pinnedOnly) {
      conds.push('pinned = 1');
    }
    if (filter.localOnly) {
      // matchesHistoryFilter: localOnly ⟹ isLocalFileReady === true
      conds.push('isLocalFileReady = 1');
    }
    if (filter.syncStatus && filter.syncStatus.length > 0) {
      conds.push(`syncStatus IN (${filter.syncStatus.map(() => '?').join(',')})`);
      params.push(...filter.syncStatus);
    }
    if (filter.transferringOnly) {
      conds.push('syncStatus = 2');
    }
  }

  return { clause: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '', params };
}

/** ORDER BY —— pinned 优先(对齐 searchItems / findInsertIndex),再按排序字段 */
function buildOrderBy(sort: HistorySort | undefined): string {
  const field = sort?.field ?? 'timestamp';
  const order = (sort?.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const col =
    field === 'lastAccessed'
      ? 'COALESCE(NULLIF(lastAccessed, 0), timestamp)' // a.lastAccessed || a.timestamp
      : field === 'useCount'
        ? 'IFNULL(useCount, 0)'
        : field === 'size'
          ? 'IFNULL(size, 0)'
          : 'timestamp';
  return `ORDER BY pinned DESC, ${col} ${order}`;
}

const INSERT_SQL = `INSERT OR REPLACE INTO ${TABLE_HISTORY} (${HISTORY_COLUMNS.map(colId).join(
  ', '
)}) VALUES (${HISTORY_COLUMNS.map(() => '?').join(', ')})`;

export const historyRepository = {
  /** 按 profileHash 取单条(大小写不敏感,靠列 COLLATE NOCASE) */
  async getByProfileHash(profileHash: string): Promise<ClipboardItem | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<HistoryRow>(
      `SELECT * FROM ${TABLE_HISTORY} WHERE profileHash = ?`,
      profileHash
    );
    return row ? fromRow(row) : null;
  },

  /** 按 localClipboardHash 取单条(走 idx_hist_localhash 索引) */
  async getByLocalHash(localClipboardHash: string): Promise<ClipboardItem | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<HistoryRow>(
      `SELECT * FROM ${TABLE_HISTORY} WHERE localClipboardHash = ? LIMIT 1`,
      localClipboardHash
    );
    return row ? fromRow(row) : null;
  },

  /** 过滤 + 排序 + 分页查询(默认排除软删除) */
  async find(
    filter?: HistoryFilter,
    sort?: HistorySort,
    opts: QueryOpts = {}
  ): Promise<ClipboardItem[]> {
    const db = await getDatabase();
    const { clause, params } = buildWhere(filter, opts.includeDeleted ?? false);
    let sql = `SELECT * FROM ${TABLE_HISTORY} ${clause} ${buildOrderBy(sort)}`;
    const bind = [...params];
    if (opts.limit != null) {
      sql += ` LIMIT ?`;
      bind.push(opts.limit);
      if (opts.offset != null) {
        sql += ` OFFSET ?`;
        bind.push(opts.offset);
      }
    }
    const rows = await db.getAllAsync<HistoryRow>(sql, bind);
    return rows.map(fromRow);
  },

  /** 符合过滤条件的总数(默认排除软删除) */
  async count(filter?: HistoryFilter, opts: QueryOpts = {}): Promise<number> {
    const db = await getDatabase();
    const { clause, params } = buildWhere(filter, opts.includeDeleted ?? false);
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE_HISTORY} ${clause}`,
      params
    );
    return row?.n ?? 0;
  },

  /** 取全部(includeDeleted 控制是否含软删除),按当前排序 */
  async getAll(sort?: HistorySort, opts: QueryOpts = {}): Promise<ClipboardItem[]> {
    return this.find(undefined, sort, opts);
  },

  /** 所有 profileHash 的小写集合(cleanupOrphanedData 用) */
  async allProfileHashesLower(): Promise<Set<string>> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ profileHash: string }>(
      `SELECT profileHash FROM ${TABLE_HISTORY}`
    );
    return new Set(rows.map((r) => r.profileHash.toLowerCase()));
  },

  /** upsert 单条(add / update 分支都构造完整 item) */
  async replace(item: ClipboardItem): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(INSERT_SQL, rowValues(toRow(item)));
  },

  /**
   * 事务内批量 upsert(迁移导入 / addItems / updateItems)
   *
   * 必须顺序执行:整个批次复用同一个 prepared statement,而 statement 的参数绑定是有状态的。
   * 原生侧靠互斥锁保证单次 execute 的原子性,所以并发下发不会更快(锁把它们排回队列),
   * 只会让 INSERT OR REPLACE 在批内同 profileHash 时的胜出者变成竞态。
   */
  async replaceMany(items: ClipboardItem[]): Promise<void> {
    if (items.length === 0) return;
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const stmt = await txn.prepareAsync(INSERT_SQL);
      try {
        for (const item of items) {
          await stmt.executeAsync(rowValues(toRow(item)));
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
  },

  /** 物理删除单条 */
  async remove(profileHash: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`DELETE FROM ${TABLE_HISTORY} WHERE profileHash = ?`, profileHash);
  },

  /** 物理删除多条(事务) */
  async removeMany(profileHashes: string[]): Promise<void> {
    if (profileHashes.length === 0) return;
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const stmt = await txn.prepareAsync(`DELETE FROM ${TABLE_HISTORY} WHERE profileHash = ?`);
      try {
        for (const h of profileHashes) {
          await stmt.executeAsync(h);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
  },

  /** 清空整表 */
  async clearAll(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`DELETE FROM ${TABLE_HISTORY}`);
  },

  /** 表是否为空(迁移导入前判断) */
  async isEmpty(): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE_HISTORY}`);
    return (row?.n ?? 0) === 0;
  },
};
