import { useEffect, useRef } from 'react';
import type { DisplayKind } from '@/utils/displayKind';
import {
  createHistorySearchFilter,
  type HistoryDateFilter,
  type HistorySourceFilter,
} from '@/utils/historyFilters';
import type { HistoryFilter, HistorySort } from '@/types/storage';
import { useHistoryStore } from '@/features/history';

type SearchItems = (filter?: HistoryFilter, sort?: HistorySort) => Promise<void>;

/** 只有正在输入的关键词需要防抖;选筛选、清空关键词是一次明确的操作,立即查询。 */
export const KEYWORD_DEBOUNCE_MS = 250;

interface UseHomeHistoryFilterOptions {
  isSearching: boolean;
  searchText: string;
  selectedFilterKinds: DisplayKind[];
  selectedDateFilter: HistoryDateFilter;
  selectedSourceFilter?: HistorySourceFilter;
  searchItems: SearchItems;
}

export function useHomeHistoryFilter({
  isSearching,
  searchText,
  selectedFilterKinds,
  selectedDateFilter,
  selectedSourceFilter = 'all',
  searchItems,
}: UseHomeHistoryFilterOptions): void {
  const keyword = isSearching ? searchText.trim() : '';
  const lastKeywordRef = useRef(keyword);

  useEffect(() => {
    const filter = createHistorySearchFilter({
      keyword,
      displayKinds: selectedFilterKinds,
      dateFilter: selectedDateFilter,
      sourceFilter: selectedSourceFilter,
    });
    const hasFilter = Object.keys(filter).length > 0;
    const typing = keyword !== lastKeywordRef.current && keyword.length > 0;
    lastKeywordRef.current = keyword;

    // Avoid racing the initial unfiltered load. Clearing an active filter still needs a query.
    if (!hasFilter && !useHistoryStore.getState().filter) return;

    const run = () => void searchItems(hasFilter ? filter : undefined);
    if (!typing) {
      run();
      return;
    }
    const timer = setTimeout(run, KEYWORD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword, selectedFilterKinds, selectedDateFilter, selectedSourceFilter, searchItems]);
}
