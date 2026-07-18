import { useEffect } from 'react';
import type { DisplayKind } from '@/utils/displayKind';
import { createHistorySearchFilter, type HistoryDateFilter } from '@/utils/historyFilters';
import type { HistoryFilter, HistorySort } from '@/types/storage';
import { useHistoryStore } from '@/stores/historyStore';

type SearchItems = (filter?: HistoryFilter, sort?: HistorySort) => Promise<void>;

interface UseHomeHistoryFilterOptions {
  isSearching: boolean;
  searchText: string;
  selectedFilterKinds: DisplayKind[];
  selectedDateFilter: HistoryDateFilter;
  searchItems: SearchItems;
}

export function useHomeHistoryFilter({
  isSearching,
  searchText,
  selectedFilterKinds,
  selectedDateFilter,
  searchItems,
}: UseHomeHistoryFilterOptions): void {
  useEffect(() => {
    const filter = createHistorySearchFilter({
      keyword: isSearching ? searchText : undefined,
      displayKinds: selectedFilterKinds,
      dateFilter: selectedDateFilter,
    });
    const hasFilter = Object.keys(filter).length > 0;

    // Avoid racing the initial unfiltered load. Clearing an active filter still needs a query.
    if (!hasFilter && !useHistoryStore.getState().filter) return;

    const timer = setTimeout(() => {
      void searchItems(hasFilter ? filter : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [isSearching, searchText, selectedFilterKinds, selectedDateFilter, searchItems]);
}
