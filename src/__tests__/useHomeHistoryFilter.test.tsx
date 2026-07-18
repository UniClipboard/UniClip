import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryFilter } from '@/types/storage';
import { useHomeHistoryFilter } from '@/screens/useHomeHistoryFilter';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockStoredFilter: HistoryFilter | null = null;

jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({ filter: mockStoredFilter }),
  },
}));

interface HarnessProps {
  selectedFilterKinds?: DisplayKind[];
  searchItems: (filter?: HistoryFilter) => Promise<void>;
}

function Harness({ selectedFilterKinds = [], searchItems }: HarnessProps) {
  useHomeHistoryFilter({
    isSearching: false,
    searchText: '',
    selectedFilterKinds,
    selectedDateFilter: 'all',
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
});
