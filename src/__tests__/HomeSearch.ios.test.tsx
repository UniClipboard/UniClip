import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Keyboard, Text, TextInput, StyleSheet } from 'react-native';
import fs from 'fs';
import path from 'path';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@expo/ui/swift-ui', () => ({
  Host: 'Host',
  Menu: 'Menu',
  Button: 'SwiftUIButton',
  HStack: 'HStack',
  Image: 'Image',
  Text: 'SwiftUIText',
  Label: 'Label',
  Picker: 'Picker',
  Section: 'Section',
}));
jest.mock(
  '@expo/ui/swift-ui/modifiers',
  () =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === '__esModule'
            ? false
            : key === 'shapes'
            ? { capsule: () => ({}) }
            : (...args: unknown[]) => ({ name: key, args }),
      }
    )
);
jest.mock('@/components/ui', () => ({ GlassContainer: 'GlassContainer' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@/hooks/useLayoutMode', () => ({ useLayoutMode: () => 'compact' }));
jest.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      {},
      {
        get: (_target, key) => (key === '__esModule' ? false : String(key)),
      }
    )
);
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
  interpolate: () => 1,
  Easing: { out: () => undefined, cubic: undefined },
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DefaultTopBar, SearchTopBar, SelectModeTopBar } from '@/components/HomeTopBar.ios';
import { HomeSearchDock } from '@/screens/ios/HomeSearchDock';
import { getHomeSearchSlots } from '@/screens/ios/homeSearchSlots';
import type { HomeController } from '@/screens/useHomeController';

const theme = {
  colors: {
    textPrimary: '#111111',
    textSecondary: '#666666',
    surfaceLow: '#EEEEEE',
    accent: '#111111',
  },
} as never;

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

describe('iOS search workflow', () => {
  it('shows select all, the selected count and a done button in select mode', () => {
    const onSelectAll = jest.fn();
    const onDone = jest.fn();
    const view = render(
      <SelectModeTopBar
        count={2}
        allSelected={false}
        onSelectAll={onSelectAll}
        onDone={onDone}
        theme={theme}
      />
    );
    const texts = () =>
      view.root.findAllByType(Text).map((node) => node.props.children as string);
    expect(texts()).toEqual(['action.selectAll', 'topBar.selectedCount']);
    act(() => view.root.findByProps({ testID: 'history-select-all' }).props.onPress());
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    act(() =>
      view.update(
        <SelectModeTopBar count={48} allSelected onSelectAll={onSelectAll} onDone={onDone} theme={theme} />
      )
    );
    expect(texts()[0]).toBe('topBar.deselectAll');
    act(() => view.root.findByProps({ accessibilityLabel: 'action.done' }).props.onPress());
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('keeps filters out of the phone home page', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    expect(source).not.toContain('<ListFilter');
    expect(source).not.toContain("c.t('filter.section.kind'");
  });
  it('keeps the bottom search field and action slot the same size when entering search', () => {
    const c = {
      theme,
      insets: { bottom: 34 },
      t: (key: string) => key,
      isSearching: false,
      searchText: '',
      openSearch: jest.fn(),
      closeSearch: jest.fn(),
      setSearchText: jest.fn(),
    } as unknown as HomeController;
    const view = render(<HomeSearchDock c={c} />);
    const field = () => view.root.findAllByType('GlassContainer' as never)[0].props.style;
    const before = StyleSheet.flatten(field());
    act(() => view.root.findByProps({ accessibilityLabel: 'a11y.search' }).props.onPress());
    expect(c.openSearch).toHaveBeenCalledTimes(1);
    act(() => view.update(<HomeSearchDock c={{ ...c, isSearching: true }} />));
    expect(StyleSheet.flatten(field())).toEqual(before);
    expect(before.height).toBe(56);
    const input = view.root.findByType(TextInput);
    act(() => input.props.onChangeText('design'));
    expect(c.setSearchText).toHaveBeenCalledWith('design');
    act(() => view.root.findByProps({ accessibilityLabel: 'action.cancel' }).props.onPress());
    expect(c.closeSearch).toHaveBeenCalledTimes(1);
  });
  it('puts add and more menus in one glass button group on the home page', () => {
    const onSelectMode = jest.fn();
    const onLayout = jest.fn();
    const onSync = jest.fn();
    const view = render(
      <DefaultTopBar
        theme={theme}
        onSearch={jest.fn()}
        onSettings={jest.fn()}
        onSelectMode={onSelectMode}
        historyLayout="grid"
        onHistoryLayoutChange={onLayout}
        addActions={{
          onTakePhoto: jest.fn(),
          onPickImage: jest.fn(),
          onPickFile: jest.fn(),
          onUploadClipboard: jest.fn(),
          onSync,
        }}
      />
    );
    expect(view.root.findAllByType('GlassContainer' as never)).toHaveLength(1);
    expect(view.root.findByProps({ testID: 'home-add-menu' })).toBeTruthy();
    act(() => view.root.findByProps({ label: 'fab.syncNow' }).props.onPress());
    expect(onSync).toHaveBeenCalledTimes(1);
    act(() => view.root.findByProps({ testID: 'home-menu-select' }).props.onPress());
    expect(onSelectMode).toHaveBeenCalledTimes(1);
    const picker = view.root.findByProps({ testID: 'home-menu-layout' });
    expect(picker.props.selection).toBe('grid');
    act(() => picker.props.onSelectionChange('compact'));
    expect(onLayout).toHaveBeenCalledWith('compact');
  });

  it('separates clearing text, ending input, and leaving search without a filter sheet', () => {
    const onChangeText = jest.fn();
    const onClose = jest.fn();
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const view = render(
      <SearchTopBar
        searchText="invoice"
        onChangeText={onChangeText}
        selectedKinds={['file']}
        selectedDate="today"
        hasActiveFilters
        onOpenFilters={jest.fn()}
        onRemoveKind={jest.fn()}
        onClearDateFilter={jest.fn()}
        onClose={onClose}
        theme={theme}
      />
    );
    const input = view.root.findByType(TextInput);
    expect(input.props.returnKeyType).toBe('search');
    expect(input.props.autoCorrect).toBe(false);
    act(() => input.props.onSubmitEditing());
    expect(dismiss).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => view.root.findByProps({ accessibilityLabel: 'a11y.clearSearch' }).props.onPress());
    expect(onChangeText).toHaveBeenCalledWith('');
    act(() => view.root.findByProps({ accessibilityLabel: 'action.cancel' }).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(view.toJSON())).not.toContain('ListFilter');
    expect(view.root.findAllByType('X' as never)).toHaveLength(1);
    expect(view.root.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(0);
    dismiss.mockRestore();
  });

  it('clears filters with the query only where filters live inside search', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/useHomeController.ts'), 'utf8');
    const close = source.match(/const closeSearch = useCallback\([\s\S]*?\n  },[^\n]*\n/)?.[0];
    expect(close).toBeDefined();
    expect(close).not.toContain('searchItems(undefined)');
    expect(close).toContain('if (clearFiltersOnCloseSearch) handleClearFilters();');
    // iPhone 的筛选只在搜索视图里;iPad 的筛选在常驻侧栏,退出搜索时保留
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    expect(home).toContain("{ clearFiltersOnCloseSearch: mode === 'compact' }");
  });

  it('shows suggestions for an empty query and a fixed filter row for results', () => {
    const slots = fs.readFileSync(path.join(__dirname, '../screens/ios/homeSearchSlots.tsx'), 'utf8');
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    const bar = fs.readFileSync(path.join(__dirname, '../screens/ios/HomeSearchFilterBar.tsx'), 'utf8');
    expect(slots).toMatch(
      /if \(!hasKeyword && !c\.hasActiveFilters\) \{\s*return \{\s*gridOverlay: <HomeSearchSuggestions c=\{c\} pullToDismiss=\{pullToDismiss\} \/>,/
    );
    expect(slots).toContain("c.t(hasKeyword ? 'search.clearFiltersKeepQuery' : 'search.clearFilters')");
    expect(home).toContain('<HomeSearchFilterBar c={c} />');
    // each chip is a native menu with a single-choice picker; "all" clears the dimension
    expect(bar.match(/<FilterMenu\b/g)).toHaveLength(3);
    expect(bar).toContain("pickerStyle('inline')");
    expect(bar).toContain('c.handleSelectFilterKind(value === ALL ? null : (value as DisplayKind))');
    expect(bar).toContain('onPress={c.handleClearFilters}');
  });

  it('reports pulls from both search forms to the shared pull-to-dismiss handlers', () => {
    const c = {
      theme,
      insets: { top: 47, bottom: 34 },
      t: (key: string) => key,
      isSearching: true,
      searchText: '',
      hasActiveFilters: false,
    } as unknown as HomeController;
    const handlers = { onPull: jest.fn(), onRelease: jest.fn() };
    const scrollEvent = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y } } });

    const suggestions = getHomeSearchSlots(c, 4, handlers)!;
    expect(suggestions.pullToDismiss).toBe(handlers);
    const view = render(<>{suggestions.gridOverlay}</>);
    const scroll = view.root.findByProps({ testID: 'history-search-shortcuts' });
    expect(scroll.props.alwaysBounceVertical).toBe(true);
    act(() => scroll.props.onScroll(scrollEvent(-30)));
    expect(handlers.onPull).toHaveBeenCalledWith(-30);
    act(() => scroll.props.onScrollEndDrag(scrollEvent(-80)));
    expect(handlers.onRelease).toHaveBeenCalledWith(-80);

    // 结果形态把下拉关闭交给共享布局,由网格 / 列表的滚动视图接住
    const results = getHomeSearchSlots({ ...c, searchText: 'invoice' } as HomeController, 4, handlers)!;
    expect(results.gridOverlay).toBeUndefined();
    expect(results.pullToDismiss).toBe(handlers);
  });

  it('routes pull-to-dismiss to the grid and list instead of pull-to-refresh', () => {
    const compact = fs.readFileSync(path.join(__dirname, '../screens/HomeCompactView.tsx'), 'utf8');
    expect(compact).toContain('const refreshControl = pullToDismiss ? undefined : (');
    expect(compact).toContain('pullToDismiss={pullToDismiss}');
    expect(compact).toMatch(/refreshControl,\s*pullToDismiss,\s*\}\)/);
    const grid = fs.readFileSync(path.join(__dirname, '../components/AnimatedCardGrid.tsx'), 'utf8');
    expect(grid).toContain('scheduleOnRN(pullToDismiss.onPull, pull)');
    expect(grid).toContain('scheduleOnRN(pullToDismiss.onRelease, event.contentOffset.y + contentInsetTop)');
    const collection = fs.readFileSync(path.join(__dirname, '../screens/ios/homeHistoryCollection.tsx'), 'utf8');
    expect(collection).toContain('pullToDismiss={slot.pullToDismiss}');
    const list = fs.readFileSync(path.join(__dirname, '../components/ios/HistoryList.tsx'), 'utf8');
    expect(list).toContain('pullToDismiss.onPull(event.nativeEvent.contentOffset.y)');
    expect(list).toContain('pullToDismiss.onRelease(event.nativeEvent.contentOffset.y)');
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    expect(home).toContain('<HomeSearchDock c={c} style={pullToDismiss.dockStyle} />');
  });

  it('lays search over a frozen home page so leaving search never waits for the history reload', () => {
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    // 搜索层自带退场动画,关闭搜索时露出下面已经渲染好的首页
    expect(home).toMatch(/\{c\.isSearching \? \(\s*<Animated\.View\s+style=\{StyleSheet\.absoluteFill\}\s+entering=\{SEARCH_LAYER_ENTERING\}\s+exiting=\{SEARCH_LAYER_EXITING\}/);
    expect(home).toContain('{frozenHome.current}');
    // 被盖住的首页不接收触摸,也不出现在读屏里
    expect(home).toContain("pointerEvents={c.isSearching ? 'none' : 'auto'}");
    expect(home).toContain('accessibilityElementsHidden={c.isSearching}');
    expect(home).toContain('const home: HomeController = { ...c, items: baseItems, isSearching: false };');
    expect(home).toContain('if (!c.isSearching || !frozenHome.current) {');
    // 两层都不各自渲染浮层,首页浮层由外层渲染一份,盖在搜索层之上
    expect(home.match(/renderOverlays=\{false\}/g)).toHaveLength(2);
    expect(home.match(/<HomeOverlays c=\{c\} \/>/g)).toHaveLength(1);
    expect(home.indexOf('<HomeOverlays c={c} />')).toBeGreaterThan(home.indexOf('exiting={SEARCH_LAYER_EXITING}'));
    // 搜索层列表用自己的句柄,c.listRef 留给首页
    expect(home).toContain('const searchC: HomeController = { ...c, listRef: searchListRef };');
    const compact = fs.readFileSync(path.join(__dirname, '../screens/HomeCompactView.tsx'), 'utf8');
    expect(compact).toContain('{renderOverlays ? <HomeOverlays c={c} /> : null}');
  });
});
