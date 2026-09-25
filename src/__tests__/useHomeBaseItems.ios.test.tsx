import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockStoreFilter: object | null | undefined = null;
jest.mock('@/features/history', () => ({
  useHistoryStore: (selector: (s: { filter: unknown }) => unknown) => selector({ filter: mockStoreFilter }),
}));

import { useHomeBaseItems } from '@/screens/ios/useHomeBaseItems';
import type { HomeController } from '@/screens/useHomeController';
import type { ClipboardItem } from '@/types/clipboard';

const item = (profileHash: string) => ({ profileHash }) as ClipboardItem;
const home = [item('a'), item('b'), item('c')];
const results = [item('b')];

function mount(initial: Partial<HomeController>) {
  let result!: ClipboardItem[];
  function Probe({ c }: { c: HomeController }) {
    result = useHomeBaseItems(c);
    return null;
  }
  let props = { isSearching: false, isHistoryLoading: false, items: home, ...initial } as HomeController;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe c={props} />);
  });
  return {
    get: () => result,
    update: (next: Partial<HomeController>) => {
      props = { ...props, ...next } as HomeController;
      act(() => renderer.update(<Probe c={props} />));
    },
  };
}

describe('iOS home under the search layer', () => {
  beforeEach(() => {
    mockStoreFilter = null;
  });

  it('keeps showing the home history while search results replace the shared query', () => {
    const view = mount({});
    expect(view.get()).toBe(home);

    view.update({ isSearching: true });
    mockStoreFilter = { keyword: 'b' };
    view.update({ items: results });
    expect(view.get()).toBe(home);

    // 退出搜索后,清空筛选的查询还没回来:仍是首页
    view.update({ isSearching: false });
    expect(view.get()).toBe(home);
    mockStoreFilter = undefined;
    view.update({ isHistoryLoading: true });
    expect(view.get()).toBe(home);

    const reloaded = [item('a'), item('b'), item('c')];
    view.update({ isHistoryLoading: false, items: reloaded });
    expect(view.get()).toBe(reloaded);
  });
});
