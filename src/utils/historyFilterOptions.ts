import { DisplayKind } from './displayKind';
import { HistoryDateFilter } from './historyFilters';

export const HISTORY_FILTER_KIND_OPTIONS: DisplayKind[] = ['text', 'url', 'image', 'file', 'group'];

export const HISTORY_FILTER_DATE_OPTIONS: Array<{ value: HistoryDateFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'pastWeek', label: '7 天内' },
];

export function getHistoryDateFilterLabel(dateFilter: HistoryDateFilter): string {
  return (
    HISTORY_FILTER_DATE_OPTIONS.find((option) => option.value === dateFilter)?.label ??
    HISTORY_FILTER_DATE_OPTIONS[0].label
  );
}
