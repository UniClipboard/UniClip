import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Keyboard, StyleSheet } from 'react-native';
import type { HomeController } from '@/screens/useHomeController';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('@/components/ui', () => ({
  AppHost: ({ children }: { children: React.ReactNode }) => children,
  AppButton: 'AppButton',
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { getHomeSearchSlots } from '@/screens/android/homeSearchSlots';
import { HomeSearchFilterBar } from '@/screens/android/HomeSearchFilterBar';
import { HomeSearchShortcuts } from '@/screens/android/HomeSearchShortcuts';

function controller(overrides: Partial<HomeController> = {}): HomeController {
  return {
    t: (key: string) => key,
    theme: { colors: {}, isDark: false },
    isSearching: true,
    searchText: '',
    hasActiveFilters: false,
    selectedFilterKinds: [],
    selectedDateFilter: 'all',
    selectedSourceFilter: 'all',
    resultCount: 4,
    isHistoryLoading: false,
    handleSelectFilterKind: jest.fn(),
    setSelectedDateFilter: jest.fn(),
    setSelectedSourceFilter: jest.fn(),
    handleClearFilters: jest.fn(),
    ...overrides,
  } as unknown as HomeController;
}

type Measure = (cb: (x: number, y: number, w: number, h: number) => void) => void;

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  // OverflowMenu 打开前测量触发器(collapsable={false} 的锚点 View)在窗口中的位置
  for (const node of renderer.root.findAll(
    (n) => n.props.collapsable === false && n.instance != null
  )) {
    (node.instance as { measureInWindow: Measure }).measureInWindow = (cb) => cb(16, 108, 80, 32);
  }
  return renderer;
}

const press = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  act(() => renderer.root.findByProps({ testID }).props.onPress());

describe('Android search view slots', () => {
  it('keeps the home screen free of filter UI outside search', () => {
    expect(getHomeSearchSlots(controller({ isSearching: false }))).toBeUndefined();
  });

  it('shows only the shortcut panel for an empty query without filters', () => {
    const slots = getHomeSearchSlots(controller());
    expect(slots?.gridOverlay).toBeDefined();
    expect(slots?.topBarAccessory).toBeUndefined();
    expect(slots?.gridHeader).toBeUndefined();
  });

  it('switches to the fixed filter bar and a scrolling result count once there are criteria', () => {
    const slots = getHomeSearchSlots(controller({ searchText: 'invoice' }))!;
    expect(slots.gridOverlay).toBeUndefined();
    expect(slots.topBarAccessory).toBeDefined();
    expect(slots.gridHeader?.height).toBeGreaterThan(0);
    expect(slots.emptyAction).toBeUndefined();

    const header = render(<>{slots.gridHeader!.node}</>);
    const count = header.root.findByProps({ testID: 'history-search-result-count' });
    expect(count.props.accessibilityLiveRegion).toBe('polite');
    expect(count.props.children).toBe('search.resultCount');
  });

  it('offers clearing filters from an empty result, keeping the keyword when there is one', () => {
    const withKeyword = controller({ searchText: 'invoice', hasActiveFilters: true });
    const view = render(<>{getHomeSearchSlots(withKeyword)!.emptyAction}</>);
    const button = view.root.findByProps({ testID: 'history-search-empty-clear-filters' });
    expect(button.props.title).toBe('search.clearFiltersKeepQuery');
    act(() => button.props.onPress());
    expect(withKeyword.handleClearFilters).toHaveBeenCalledTimes(1);

    const filtersOnly = controller({ hasActiveFilters: true });
    const other = render(<>{getHomeSearchSlots(filtersOnly)!.emptyAction}</>);
    expect(
      other.root.findByProps({ testID: 'history-search-empty-clear-filters' }).props.title
    ).toBe('search.clearFilters');
  });
});

describe('Android search shortcuts', () => {
  it('applies a shortcut immediately and dismisses the keyboard', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const c = controller();
    const view = render(<HomeSearchShortcuts c={c} />);

    press(view, 'history-shortcut-kind-image');
    expect(c.handleSelectFilterKind).toHaveBeenCalledWith('image');
    press(view, 'history-shortcut-date-today');
    expect(c.setSelectedDateFilter).toHaveBeenCalledWith('today');
    press(view, 'history-shortcut-source-remote');
    expect(c.setSelectedSourceFilter).toHaveBeenCalledWith('remote');
    expect(dismiss).toHaveBeenCalledTimes(3);
    expect(view.root.findAllByProps({ testID: 'history-shortcut-date-all' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'history-shortcut-source-all' })).toHaveLength(0);
    dismiss.mockRestore();
  });

  it('makes the whole type tile the touch target', () => {
    const view = render(<HomeSearchShortcuts c={controller()} />);
    const tile = view.root.findByProps({ testID: 'history-shortcut-kind-file' });
    // 可点的就是整块 72dp 瓷砖本身,而不是其中的图标或文字
    expect(typeof tile.props.onPress).toBe('function');
    const style = StyleSheet.flatten(tile.props.style);
    expect(style.flex).toBe(1);
    expect(style.height).toBe(72);
  });
});

describe('Android search filter bar', () => {
  it('labels each chip with its current value and hides clear until a filter is active', () => {
    const idle = render(<HomeSearchFilterBar c={controller({ searchText: 'x' })} />);
    const label = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root
        .findByProps({ testID })
        .findAll((node) => typeof node.props.children === 'string')[0].props.children;
    expect(label(idle, 'history-filter-kind')).toBe('filter.chip.kind');
    expect(label(idle, 'history-filter-date')).toBe('filter.chip.date');
    expect(label(idle, 'history-filter-source')).toBe('filter.chip.source');
    expect(idle.root.findAllByProps({ testID: 'history-filter-clear' })).toHaveLength(0);

    const c = controller({
      hasActiveFilters: true,
      selectedDateFilter: 'pastWeek',
      selectedSourceFilter: 'local',
    } as Partial<HomeController>);
    const active = render(<HomeSearchFilterBar c={c} />);
    expect(label(active, 'history-filter-date')).not.toBe('filter.chip.date');
    expect(label(active, 'history-filter-source')).not.toBe('filter.chip.source');
    press(active, 'history-filter-clear');
    expect(c.handleClearFilters).toHaveBeenCalledTimes(1);
  });

  it('selects a type from its menu and clears it with the first item', () => {
    const c = controller({ selectedFilterKinds: ['file'], hasActiveFilters: true });
    const view = render(<HomeSearchFilterBar c={c} />);

    press(view, 'history-filter-kind');
    const all = view.root.findByProps({ testID: 'overflow-action-kind-all' });
    const file = view.root.findByProps({ testID: 'overflow-action-kind-file' });
    expect(file.props.accessibilityState).toEqual({ checked: true });
    expect(all.props.accessibilityState).toEqual({ checked: false });
    act(() => all.props.onPress());
    expect(c.handleSelectFilterKind).toHaveBeenCalledWith(null);

    press(view, 'history-filter-kind');
    act(() => view.root.findByProps({ testID: 'overflow-action-kind-image' }).props.onPress());
    expect(c.handleSelectFilterKind).toHaveBeenLastCalledWith('image');
  });

  it('anchors the menu to the chip start edge', () => {
    const view = render(<HomeSearchFilterBar c={controller({ searchText: 'x' })} />);
    press(view, 'history-filter-date');
    const menu = view.root.findByProps({ accessibilityRole: 'menu' });
    const style = StyleSheet.flatten(menu.props.style);
    expect(style.left).toBe(16);
    expect(style.right).toBeUndefined();
    expect(style.top).toBe(140);
  });
});
