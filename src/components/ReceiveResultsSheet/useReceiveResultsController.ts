import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryReceiveCancellation, ReceiveRetryOutcome } from '@/platform/engine';
import {
  getReceiveResultsService,
  type ReceiveEntryView,
  type ReceiveItemState,
} from '@/features/transfer';
import { useReceiveResultsStore } from '@/stores/receiveResultsStore';
import { formatBytes } from '@/utils/formatBytes';

export type ReceiveNoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface ReceiveItemRowModel {
  itemId: string;
  label: string;
  state: ReceiveItemState;
  stateLabel: string;
  reasonLabel: string | null;
  selectable: boolean;
  selected: boolean;
}

export interface ReceiveEntryModel {
  entryId: string;
  title: string;
  /** Aggregate attempt state. A failed or cancelled attempt can still hold saved files. */
  summary: string;
  bytesLabel: string;
  /** Member counts, shown apart from rows because a directory is one row with many members. */
  membersLabel: string | null;
  items: ReceiveItemRowModel[];
  selectedCount: number;
  canRetry: boolean;
  canCancel: boolean;
  busy: boolean;
  notice: { text: string; tone: ReceiveNoticeTone } | null;
}

const ATTEMPT_STATES = new Set([
  'receiving',
  'committing',
  'cancelling',
  'failing',
  'completed',
  'failed',
  'cancelled',
]);
const FAILURE_REASONS = new Set([
  'network_unavailable',
  'timed_out',
  'access_denied',
  'storage_unavailable',
  'integrity_check_failed',
  'interrupted',
  'unknown',
]);

type NoticeKey =
  | 'retryAccepted'
  | 'alreadyReceiving'
  | 'superseded'
  | 'retryCancellationIncomplete'
  | 'sourceUnavailable'
  | 'accessDenied'
  | 'cancelled'
  | 'cancellationIncomplete'
  | 'notReceiving'
  | 'tooLate'
  | 'alreadyTerminal'
  | 'requestFailed';

const NOTICE_TONE: Record<NoticeKey, ReceiveNoticeTone> = {
  retryAccepted: 'info',
  alreadyReceiving: 'info',
  superseded: 'info',
  retryCancellationIncomplete: 'warning',
  sourceUnavailable: 'error',
  accessDenied: 'error',
  cancelled: 'success',
  cancellationIncomplete: 'warning',
  notReceiving: 'info',
  tooLate: 'info',
  alreadyTerminal: 'info',
  requestFailed: 'error',
};

function retryNotice(outcome: ReceiveRetryOutcome): NoticeKey {
  switch (outcome.kind) {
    case 'accepted':
      return 'retryAccepted';
    case 'alreadyReceiving':
      return 'alreadyReceiving';
    case 'superseded':
      return 'superseded';
    case 'cancellationIncomplete':
      return 'retryCancellationIncomplete';
    case 'unavailable':
      if (outcome.reason === 'source_unavailable') return 'sourceUnavailable';
      if (outcome.reason === 'access_denied') return 'accessDenied';
      return 'requestFailed';
    default:
      return 'requestFailed';
  }
}

function cancelNotice(outcome: EntryReceiveCancellation): NoticeKey {
  switch (outcome) {
    case 'cancelled':
      return 'cancelled';
    case 'cancellation_incomplete':
      return 'cancellationIncomplete';
    case 'not_receiving':
      return 'notReceiving';
    case 'too_late':
      return 'tooLate';
    case 'already_terminal':
      return 'alreadyTerminal';
    case 'superseded':
      return 'superseded';
    default:
      return 'requestFailed';
  }
}

/**
 * View model for the receive results sheet. It reads the Engine snapshot from the store,
 * keeps only the user's selection locally, and forwards intent to the receive service.
 * Selecting, retrying and cancelling never decide an outcome: the Engine does.
 */
export function useReceiveResultsController(visible: boolean) {
  const { t } = useTranslation('home');
  const entries = useReceiveResultsStore((state) => state.entries);
  const stale = useReceiveResultsStore((state) => state.stale);
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [busyEntries, setBusyEntries] = useState<Record<string, boolean>>({});
  const [notices, setNotices] = useState<Record<string, NoticeKey>>({});

  useEffect(() => {
    if (visible) void getReceiveResultsService().refresh();
  }, [visible]);

  // A selection may only name items the current snapshot still offers.
  useEffect(() => {
    setSelection((current) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [entryId, ids] of Object.entries(current)) {
        const allowed = entries[entryId]?.retryableItemIds ?? [];
        const kept = ids.filter((id) => allowed.includes(id));
        if (kept.length !== ids.length) changed = true;
        if (kept.length > 0) next[entryId] = kept;
        else if (ids.length > 0) changed = true;
      }
      return changed ? next : current;
    });
  }, [entries]);

  const toggleItem = useCallback((entryId: string, itemId: string) => {
    setSelection((current) => {
      const ids = current[entryId] ?? [];
      const next = ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId];
      return { ...current, [entryId]: next };
    });
  }, []);

  const runRequest = useCallback(
    async (entryId: string, request: () => Promise<NoticeKey>) => {
      setBusyEntries((current) => ({ ...current, [entryId]: true }));
      try {
        const notice = await request();
        setNotices((current) => ({ ...current, [entryId]: notice }));
      } catch {
        setNotices((current) => ({ ...current, [entryId]: 'requestFailed' }));
      } finally {
        setBusyEntries((current) => ({ ...current, [entryId]: false }));
      }
    },
    []
  );

  const retry = useCallback(
    (entryId: string) => {
      const ids = selection[entryId] ?? [];
      if (ids.length === 0) return Promise.resolve();
      return runRequest(entryId, async () => {
        const outcome = await getReceiveResultsService().retry(entryId, ids);
        setSelection((current) => ({ ...current, [entryId]: [] }));
        return retryNotice(outcome);
      });
    },
    [runRequest, selection]
  );

  const cancel = useCallback(
    (entryId: string) =>
      runRequest(entryId, async () => cancelNotice(await getReceiveResultsService().cancel(entryId))),
    [runRequest]
  );

  const models = useMemo<ReceiveEntryModel[]>(
    () =>
      Object.values(entries).map((entry, index) =>
        entryModel(entry, index, selection[entry.entryId] ?? [], busyEntries, notices, t)
      ),
    [entries, selection, busyEntries, notices, t]
  );

  return {
    title: t('receive.title'),
    emptyLabel: t('receive.empty'),
    staleLabel: stale ? t('receive.stale') : null,
    entries: models,
    toggleItem,
    retry,
    cancel,
  };
}

function entryModel(
  entry: ReceiveEntryView,
  index: number,
  selected: string[],
  busyEntries: Record<string, boolean>,
  notices: Record<string, NoticeKey>,
  t: (key: string, options?: Record<string, unknown>) => string
): ReceiveEntryModel {
  const progress = entry.progress;
  const attempt = ATTEMPT_STATES.has(progress.state) ? progress.state : 'unknown';
  const busy = busyEntries[entry.entryId] === true;
  let position = 0;
  const items = entry.items.map<ReceiveItemRowModel>((item) => {
    position += 1;
    const reason =
      item.failureReason === null
        ? null
        : FAILURE_REASONS.has(item.failureReason)
        ? item.failureReason
        : 'unknown';
    return {
      itemId: item.itemId,
      label:
        item.kind === 'directory_unit'
          ? t('receive.item.directory')
          : item.kind === 'representation'
          ? t('receive.item.content')
          : item.kind === 'file'
          ? t('receive.item.file', { index: position })
          : t('receive.item.unknown'),
      state: item.state,
      stateLabel: t(`receive.state.${item.state}`),
      reasonLabel: reason ? t(`receive.reason.${reason}`) : null,
      selectable: item.selectable,
      selected: selected.includes(item.itemId),
    };
  });
  const noticeKey =
    notices[entry.entryId] ??
    (entry.retryBlockedReason === 'source_unavailable'
      ? 'sourceUnavailable'
      : entry.retryBlockedReason === 'access_denied'
      ? 'accessDenied'
      : null);
  return {
    entryId: entry.entryId,
    title: t('receive.entryTitle', { index: index + 1 }),
    summary: t(`receive.attempt.${attempt}`),
    bytesLabel: t('receive.bytes', {
      completed: formatBytes(Math.max(0, progress.completedBytes)),
      total: formatBytes(Math.max(0, progress.totalBytes)),
    }),
    membersLabel: entry.items.some((item) => item.kind === 'directory_unit')
      ? t('receive.members', {
          completed: entry.memberCounts.completed,
          total: entry.memberCounts.total,
        })
      : null,
    items,
    selectedCount: selected.length,
    canRetry: selected.length > 0 && !busy,
    canCancel: !entry.settled && entry.awaitingRetryAttemptId === null && !busy,
    busy,
    notice: noticeKey ? { text: t(`receive.notice.${noticeKey}`), tone: NOTICE_TONE[noticeKey] } : null,
  };
}
