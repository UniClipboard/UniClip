import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ShowMessageOptions } from '@/stores/messageStore';
import type { MessageType } from '@/components/MessageToast.types';
import { HISTORY_DELETE_MODE } from '@/utils/historyDeleteMode';
import type { HistoryDeleteMode } from '@/utils/historyDeleteMode.types';
import { matchesHistoryRevision, type ClipboardItem, type HistoryItemRevision } from '@/types/clipboard';

type DeleteTarget = Pick<ClipboardItem, 'profileHash' | 'version' | 'incarnationId'>;

interface PendingBatch {
  targets: readonly DeleteTarget[];
  settled: boolean;
}
interface UndoableHistoryDeleteDeps {
  /** 真正的软删除(会同步删除本地文件,因此只能在撤销窗口结束后调用) */
  deleteItems: (
    ids: string[],
    expectedVersions?: ReadonlyMap<string, HistoryItemRevision>
  ) => Promise<void>;
  showMessage: (text: string, type?: MessageType, options?: ShowMessageOptions) => void;
  messages: {
    deleted: string;
    deletedCount: (count: number) => string;
    undo: string;
  };
  /** 测试注入;默认按平台策略 */
  mode?: HistoryDeleteMode;
}
const EMPTY: ReadonlyMap<string, HistoryItemRevision> = new Map();

function without(
  versions: ReadonlyMap<string, HistoryItemRevision>,
  targets: readonly DeleteTarget[]
): ReadonlyMap<string, HistoryItemRevision> {
  if (versions.size === 0) return versions;
  const next = new Map(versions);
  targets.forEach((target) => {
    const { profileHash } = target;
    const key = profileHash.toLowerCase();
    if (matchesHistoryRevision(target, next.get(key))) next.delete(key);
  });
  return next.size === 0 ? EMPTY : next;
}
/**
 * 历史删除(单条 / 批量共用)。
 *
 * undo 模式下删除分两步:先把条目版本加入 pendingVersions(列表立即隐藏),Snackbar 给出「撤销」;
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
  const [pendingVersions, setPendingVersions] = useState<ReadonlyMap<string, HistoryItemRevision>>(EMPTY);
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
    const ids = batch.targets.map(({ profileHash }) => profileHash);
    const expectedVersions = new Map(
      batch.targets.map(({ profileHash, version, incarnationId }) => [
        profileHash.toLowerCase(), { version, incarnationId },
      ])
    );
    void deleteRef.current(ids, expectedVersions).finally(() => {
      setPendingVersions((prev) => without(prev, batch.targets));
    });
  }, []);

  const undo = useCallback((batch: PendingBatch) => {
    if (batch.settled) return;
    batch.settled = true;
    outstanding.current.delete(batch);
    setPendingVersions((prev) => without(prev, batch.targets));
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
    async (targets: readonly DeleteTarget[], options: { announce: boolean }) => {
      if (targets.length === 0) return;
      const ids = targets.map(({ profileHash }) => profileHash);
      if (mode === 'immediate') {
        await deleteItems(ids);
        if (options.announce) showMessage(messages.deleted, 'success');
        return;
      }

      const batch: PendingBatch = { targets, settled: false };
      outstanding.current.add(batch);
      setPendingVersions((prev) => {
        const next = new Map(prev);
        targets.forEach(({ profileHash, version, incarnationId }) =>
          next.set(profileHash.toLowerCase(), { version, incarnationId })
        );
        return next;
      });
      showMessage(
        targets.length > 1 ? messages.deletedCount(targets.length) : messages.deleted,
        'info',
        {
          action: { label: messages.undo, onPress: () => undo(batch) },
          onTimeout: () => commit(batch),
        }
      );
    },
    [mode, deleteItems, showMessage, messages, undo, commit]
  );

  return { pendingVersions, requestDelete };
}
