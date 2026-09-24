import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryFilter } from '@/types/storage';
import type { HistorySourceFilter } from '@/utils/historyFilters';
import { KEYWORD_DEBOUNCE_MS, useHomeHistoryFilter } from '@/screens/useHomeHistoryFilter';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockStoredFilter: HistoryFilter | null = null;

jest.mock('@/features/history', () => ({
  useHistoryStore: {
    getState: () => ({ filter: mockStoredFilter }),
  },
}));

interface HarnessProps {
  isSearching?: boolean;
  searchText?: string;
  selectedFilterKinds?: DisplayKind[];
  selectedSourceFilter?: HistorySourceFilter;
  searchItems: (filter?: HistoryFilter) => Promise<void>;
}

function Harness({
  isSearching = false,
  searchText = '',
  selectedFilterKinds = [],
  selectedSourceFilter = 'all',
  searchItems,
}: HarnessProps) {
  useHomeHistoryFilter({
    isSearching,
    searchText,
    selectedFilterKinds,
    selectedDateFilter: 'all',
    selectedSourceFilter,
    searchItems,
  });
  return null;
}

describe('home filter bar', () => {
  beforeEach(() => {
    mockStoredFilter = null;
  });

  it('filters history when a home filter is selected without opening search', async () => {
    const searchItems = jest.fn(async (filter?: HistoryFilter) => {
      mockStoredFilter = filter ?? null;
    });
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Harness searchItems={searchItems} />);
    });
    expect(searchItems).not.toHaveBeenCalled();

    await act(async () => {
      renderer.update(<Harness selectedFilterKinds={['image']} searchItems={searchItems} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(searchItems).toHaveBeenCalledWith({ displayKinds: ['image'] });

    await act(async () => {
      renderer.update(<Harness searchItems={searchItems} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(searchItems).toHaveBeenLastCalledWith(undefined);
    expect(searchItems).toHaveBeenCalledTimes(2);
  });

  it('applies filter changes immediately and only debounces typing', async () => {
    const searchItems = jest.fn(async (filter?: HistoryFilter) => {
      mockStoredFilter = filter ?? null;
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Harness isSearching searchItems={searchItems} />);
    });

    await act(async () => {
      renderer.update(
        <Harness isSearching selectedSourceFilter="remote" searchItems={searchItems} />
      );
    });
    expect(searchItems).toHaveBeenLastCalledWith({ source: 'remote' });

    await act(async () => {
      renderer.update(
        <Harness
          isSearching
          searchText="inv"
          selectedSourceFilter="remote"
          searchItems={searchItems}
        />
      );
    });
    expect(searchItems).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, KEYWORD_DEBOUNCE_MS + 50));
    });
    expect(searchItems).toHaveBeenLastCalledWith({ keyword: 'inv', source: 'remote' });

    // 清空关键词是一次明确操作,不等防抖
    await act(async () => {
      renderer.update(
        <Harness isSearching selectedSourceFilter="remote" searchItems={searchItems} />
      );
    });
    expect(searchItems).toHaveBeenCalledTimes(3);
    expect(searchItems).toHaveBeenLastCalledWith({ source: 'remote' });
  });
});
