import { ClipboardItem } from '@/types/clipboard';
import { HistoryFilter } from '@/types/storage';
import { DisplayKind, getDisplayKind } from './displayKind';

export type HistoryDateFilter = 'all' | 'today' | 'yesterday' | 'pastWeek';

export interface HistorySearchFilterOptions {
  keyword?: string;
  displayKinds?: DisplayKind[];
  dateFilter?: HistoryDateFilter;
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function createHistorySearchFilter(options: HistorySearchFilterOptions): HistoryFilter {
  const filter: HistoryFilter = {};
  const keyword = options.keyword?.trim();
  const displayKinds = options.displayKinds ?? [];
  const dateFilter = options.dateFilter ?? 'all';
  const now = options.now ?? Date.now();

  if (keyword) {
    filter.keyword = keyword;
  }

  if (displayKinds.length > 0) {
    filter.displayKinds = displayKinds;
  }

  switch (dateFilter) {
    case 'today':
      filter.startDate = startOfDay(now);
      filter.endDate = endOfDay(now);
      break;
    case 'yesterday': {
      const yesterday = now - DAY_MS;
      filter.startDate = startOfDay(yesterday);
      filter.endDate = endOfDay(yesterday);
      break;
    }
    case 'pastWeek':
      filter.startDate = now - 7 * DAY_MS;
      break;
    case 'all':
    default:
      break;
  }

  return filter;
}

export function matchesHistoryFilter(item: ClipboardItem, filter?: HistoryFilter): boolean {
  if (item.isDeleted) {
    return false;
  }

  if (!filter) {
    return true;
  }

  if (filter.type && filter.type.length > 0 && !filter.type.includes(item.type)) {
    return false;
  }

  if (filter.displayKinds && filter.displayKinds.length > 0) {
    const displayKind = getDisplayKind(item.type, item.text);
    if (!filter.displayKinds.includes(displayKind)) {
      return false;
    }
  }

  if (filter.startDate && item.timestamp < filter.startDate) {
    return false;
  }

  if (filter.endDate && item.timestamp > filter.endDate) {
    return false;
  }

  if (filter.keyword) {
    const keyword = filter.keyword.toLowerCase();
    const text = item.text.toLowerCase();
    const dataName = item.dataName?.toLowerCase() ?? '';
    if (!text.includes(keyword) && !dataName.includes(keyword)) {
      return false;
    }
  }

  if (filter.starredOnly && item.starred !== true) {
    return false;
  }

  if (filter.syncedOnly && item.synced !== true) {
    return false;
  }

  if (filter.pinnedOnly && item.pinned !== true) {
    return false;
  }

  if (filter.localOnly && item.isLocalFileReady !== true) {
    return false;
  }

  if (
    filter.syncStatus &&
    filter.syncStatus.length > 0 &&
    (item.syncStatus === undefined || !filter.syncStatus.includes(item.syncStatus))
  ) {
    return false;
  }

  if (filter.transferringOnly && item.syncStatus !== 2) {
    return false;
  }

  return true;
}

export function filterHistoryItems(
  items: ClipboardItem[],
  filter?: HistoryFilter
): ClipboardItem[] {
  return items.filter((item) => matchesHistoryFilter(item, filter));
}
