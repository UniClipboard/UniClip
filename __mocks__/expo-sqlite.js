/**
 * jest mock for expo-sqlite —— 用 better-sqlite3(node 原生 SQLite)驱动,
 * 把 expo-sqlite 的 async API 包装到同步的 better-sqlite3 上,
 * 让 historyRepository 的真实 SQL(WHERE / ORDER BY / COLLATE NOCASE / 事务)
 * 能在 node 测试环境跑通并验证。
 */
const Database = require('better-sqlite3');

/** expo-sqlite 支持 (sql, ...variadic) 或 (sql, [array]) 两种绑定,统一成数组 */
function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function wrap(db) {
  const wrapper = {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, ...args) {
      const r = db.prepare(sql).run(...normalizeParams(args));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    async getFirstAsync(sql, ...args) {
      return db.prepare(sql).get(...normalizeParams(args)) ?? null;
    },
    async getAllAsync(sql, ...args) {
      return db.prepare(sql).all(...normalizeParams(args));
    },
    async getEachAsync(sql, ...args) {
      return db.prepare(sql).all(...normalizeParams(args));
    },
    async withTransactionAsync(fn) {
      return wrapper.withExclusiveTransactionAsync(fn);
    },
    async withExclusiveTransactionAsync(fn) {
      db.exec('BEGIN');
      try {
        await fn(wrapper);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async prepareAsync(sql) {
      const stmt = db.prepare(sql);
      return {
        async executeAsync(...args) {
          const r = stmt.run(...normalizeParams(args));
          return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
        },
        async finalizeAsync() {
          // better-sqlite3 statements 无需显式 finalize
        },
      };
    },
    async closeAsync() {
      db.close();
    },
    closeSync() {
      db.close();
    },
  };
  return wrapper;
}

module.exports = {
  openDatabaseAsync: async () => wrap(new Database(':memory:')),
  openDatabaseSync: () => wrap(new Database(':memory:')),
  deleteDatabaseAsync: async () => {},
  defaultDatabaseDirectory: '/tmp',
};
