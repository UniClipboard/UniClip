import { getDatabase, TABLE_ACTIVATE } from './database';

/**
 * activate_clipboard 单行寄存器的数据访问层。
 *
 * 这是 reducer 每 tick 读取的 device_hash 代理:一个「设备当前想同步的内容」的
 * 持久指针。列用 snake_case(遵循权威文档),此处单独映射,不复用 history 的 rowMapper。
 * 「清空」= 删除 id=1 行(get 返回 null → device_present=false)。
 */

/** activate_clipboard 行(camelCase 映射,给 TS 侧使用) */
export interface ActivateRow {
  /** 指向必然存在的 clipboard_history.profileHash */
  profileHash: string;
  /** 当前行服务端身份的反规范化副本(本地内容为 null) */
  contentId: string | null;
  /** 成为当前激活项的时刻(ms) */
  activatedAtMs: number;
}

interface ActivateSqlRow {
  profile_hash: string;
  content_id: string | null;
  activated_at_ms: number;
}

export const activateRepository = {
  /** 取当前激活行,无则返回 null(= 已清空,device_present=false) */
  async get(): Promise<ActivateRow | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ActivateSqlRow>(
      `SELECT profile_hash, content_id, activated_at_ms FROM ${TABLE_ACTIVATE} WHERE id = 1`
    );
    if (!row) return null;
    return {
      profileHash: row.profile_hash,
      contentId: row.content_id ?? null,
      activatedAtMs: row.activated_at_ms,
    };
  },

  /** upsert 单行(id=1)。调用方须先保证 profileHash 指向的历史行存在。 */
  async upsert(
    profileHash: string,
    contentId: string | null,
    activatedAtMs: number
  ): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO ${TABLE_ACTIVATE} (id, profile_hash, content_id, activated_at_ms)
       VALUES (1, ?, ?, ?)`,
      profileHash,
      contentId,
      activatedAtMs
    );
  },

  /** 清空寄存器(应用远端内容后调用):删除 id=1 行。 */
  async clear(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`DELETE FROM ${TABLE_ACTIVATE} WHERE id = 1`);
  },
};
