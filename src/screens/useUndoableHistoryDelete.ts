import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ShowMessageOptions } from '@/stores/messageStore';
import type { MessageType } from '@/components/MessageToast.types';
import { HISTORY_DELETE_MODE } from '@/utils/historyDeleteMode';
import type { HistoryDeleteMode } from '@/utils/historyDeleteMode.types';

interface PendingBatch {
  ids: string[];
  settled: boolean;
}

interface UndoableHistoryDeleteDeps {
  /** 真正的软删除(会同步删除本地文件,因此只能在撤销窗口结束后调用) */
  deleteItems: (ids: string[]) => Promise<void>;
  showMessage: (text: string, type?: MessageType, options?: ShowMessageOptions) => void;
  messages: {
    deleted: string;
    deletedCount: (count: number) => string;
    undo: string;
  };
  /** 测试注入;默认按平台策略 */
  mode?: HistoryDeleteMode;
}

const EMPTY: ReadonlySet<string> = new Set();

function without(set: ReadonlySet<string>, ids: string[]): ReadonlySet<string> {
  if (set.size === 0) return set;
  const next = new Set(set);
  ids.forEach((id) => next.delete(id));
  return next.size === 0 ? EMPTY : next;
}

/**
 * 历史删除(单条 / 批量共用)。
 *
 * undo 模式下删除分两步:先把条目加入 pendingIds(列表立即隐藏),Snackbar 给出「撤销」;
 * Snackbar 自然消失、被新消息顶掉、App 进入后台或页面卸载时才提交软删除。
 * 软删除会删掉本地文件,所以不能「先删后恢复」,只能延迟提交。
 * immediate 模式直接删除(iOS 现状),单条删除给一条「已删除」提示。
 */
export function useUndoableHistoryDelete({
  deleteItems,
  showMessage,
  messages,
  mode = HISTORY_DELETE_MODE,
}: UndoableHistoryDeleteDeps) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(EMPTY);
  const outstanding = useRef(new Set<PendingBatch>());
  // 提交可能发生在卸载 / 进后台时,需要最新的 deleteItems;在 effect 里同步,不在渲染期写 ref
  const deleteRef = useRef(deleteItems);
  useEffect(() => {
    deleteRef.current = deleteItems;
  }, [deleteItems]);

  const commit = useCallback((batch: PendingBatch) => {
    if (batch.settled) return;
    batch.settled = true;
    outstanding.current.delete(batch);
    void deleteRef.current(batch.ids).finally(() => {
      setPendingIds((prev) => without(prev, batch.ids));
    });
  }, []);

  const undo = useCallback((batch: PendingBatch) => {
    if (batch.settled) return;
    batch.settled = true;
    outstanding.current.delete(batch);
    setPendingIds((prev) => without(prev, batch.ids));
  }, []);

  const commitAll = useCallback(() => {
    [...outstanding.current].forEach(commit);
  }, [commit]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') commitAll();
    });
    return () => {
      sub.remove();
      commitAll();
    };
  }, [commitAll]);

  const requestDelete = useCallback(
    async (ids: string[], options: { announce: boolean }) => {
      if (ids.length === 0) return;
      if (mode === 'immediate') {
        await deleteItems(ids);
        if (options.announce) showMessage(messages.deleted, 'success');
        return;
      }

      const batch: PendingBatch = { ids, settled: false };
      outstanding.current.add(batch);
      setPendingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      showMessage(ids.length > 1 ? messages.deletedCount(ids.length) : messages.deleted, 'info', {
        action: { label: messages.undo, onPress: () => undo(batch) },
        onTimeout: () => commit(batch),
      });
    },
    [mode, deleteItems, showMessage, messages, undo, commit]
  );

  return { pendingIds, requestDelete };
}
