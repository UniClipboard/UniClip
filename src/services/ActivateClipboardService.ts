/**
 * activate_clipboard 写路径 —— 所有激活触发的单一入口。
 *
 * 背景(docs/activate-clipboard-plan.md):移动端没有实时剪贴板监听,reducer 每 tick
 * 仍需一个 device_hash。activate_clipboard 就是那个「设备当前想同步的内容」的持久代理。
 *
 * 三条写规则,全部经此模块:
 *  - 真正的本地新内容 / 用户主动使用某项  → writeActivate(写入)
 *  - 被动应用远端内容                     → clearActivate(清空;§3 消除陈旧 re-push 陷阱)
 *
 * content_id 统一由 profileHash 指向的历史行的 contentId 反规范化而来:本地复制→null,
 * 重新激活服务端拉取项→自然带回其 content_id。
 */

import { activateRepository } from '@/services/db/activateRepository';
import { historyRepository } from '@/services/db/historyRepository';
import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardContent } from '@/types/clipboard';
import { log } from '@/services/Logger';

/**
 * 最近一次被动应用的远端内容 hash(大写)。writeActivate 的反 echo 守卫:
 * 若剪贴板监听回读到刚被应用的内容,不得记为一次「激活」。
 */
let lastAppliedHash: string | null = null;

/** apply 路径调用:记录刚应用的远端 hash,供 writeActivate 反 echo。 */
export function noteApplied(hash: string | null): void {
  lastAppliedHash = hash ? hash.toUpperCase() : null;
}

const eqHash = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase();

/** writeActivate 选项。`active` 标记"用户主动激活",绕过被动 anti-echo(见 §3 表格)。 */
export interface WriteActivateOptions {
  /**
   * 用户主动使用/复制某项(点卡片、上下文菜单复制、选图等)。此时是明确的激活意图,
   * 即便内容恰好等于最近一次被动应用的远端 hash 也应写入——计划 §3 表格「用户主动使用」
   * 那行没有 `≠ last_applied_hash` 条件,只有被动捕获(monitor/前台快照)才做 anti-echo。
   */
  active?: boolean;
}

/**
 * 写入激活项。
 * - 被动路径(monitor 回调 / 前台快照):anti-echo → 去重 → 保证历史行 → upsert。
 * - 主动路径(active=true,用户主动使用某项):跳过 anti-echo,其余相同。
 */
export async function writeActivate(
  content: ClipboardContent,
  opts?: WriteActivateOptions
): Promise<void> {
  const profileHash = content.profileHash;
  if (!profileHash) return;

  // 被动 echo:刚应用的远端内容被监听回读到,不是一次激活。主动激活不受此限。
  if (!opts?.active && eqHash(profileHash, lastAppliedHash)) return;

  try {
    const current = await activateRepository.get();
    // 未变化 —— no-op(避免无谓 upsert 与 tick 抖动)。
    if (current && eqHash(current.profileHash, profileHash)) return;

    // 保证指针目标存在:缺则先插入历史行。content_id 来自历史行的 contentId 列
    // (本地内容为 null;若命中一条服务端拉取项则带回其 content_id)。
    let row = await historyRepository.getByProfileHash(profileHash);
    if (!row) {
      row = createDefaultClipboardItem({
        type: content.type,
        text: content.text ?? '',
        profileHash,
        hasData: content.hasData ?? false,
        dataName: content.fileName ?? undefined,
        size: content.fileSize ?? content.text?.length ?? undefined,
        fileUri: content.fileUri ?? undefined,
        localClipboardHash: content.localClipboardHash ?? undefined,
        timestamp: content.timestamp ?? Date.now(),
        syncStatus: HistorySyncStatus.LocalOnly,
        isLocalFileReady: !!content.fileUri || !(content.hasData ?? false),
        from: 'local',
      });
      await historyRepository.replace(row);
    }

    await activateRepository.upsert(profileHash, row.contentId ?? null, Date.now());
  } catch (e) {
    log.error('[ActivateClipboard] writeActivate failed:', e);
  }
}

/** 清空寄存器(被动应用远端内容后)。watermarks 已阻止 re-push,这里只是不把应用记为激活。 */
export async function clearActivate(): Promise<void> {
  try {
    await activateRepository.clear();
  } catch (e) {
    log.error('[ActivateClipboard] clearActivate failed:', e);
  }
}
