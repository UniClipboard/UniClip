import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Keyboard, TextInput, View, StyleSheet } from 'react-native';
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
import { HomeFilterChipsRow } from '@/components/HomeFilterChipsRow.ios';
import { HomeSearchDock } from '@/screens/ios/HomeSearchDock';
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
  it('keeps selection capsules fixed while toggling all selected', () => {
    const onSelectAll = jest.fn();
    const onDone = jest.fn();
    const view = render(
      <SelectModeTopBar
        count={0}
        allSelected={false}
        onSelectAll={onSelectAll}
        onDone={onDone}
        theme={theme}
      />
    );
    const sizes = () =>
      view.root.findAllByType('GlassContainer' as never).map((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return [style.width, style.height];
      });
    expect(sizes()).toEqual([
      [44, 44],
      [44, 44],
    ]);
    act(() => view.root.findByProps({ accessibilityLabel: 'action.selectAll' }).props.onPress());
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    act(() =>
      view.update(
        <SelectModeTopBar
          count={48}
          allSelected
          onSelectAll={onSelectAll}
          onDone={onDone}
          theme={theme}
        />
      )
    );
    expect(sizes()).toEqual([
      [44, 44],
      [44, 44],
    ]);
    act(() => view.root.findByProps({ accessibilityLabel: 'action.done' }).props.onPress());
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('consolidates phone filters into the toolbar before the more menu', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/HomeView.ios.tsx'), 'utf8');
    expect(source).toContain('showFilterRow={false}');
    expect(source.indexOf('<ListFilter')).toBeLessThan(source.indexOf('<Ellipsis'));
    expect(source).toContain("c.t('filter.section.kind'");
    expect(source).toContain("c.t('filter.section.date'");
    expect(source).toContain('onPress={c.handleClearFilters}');
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
  it('exposes a full-width search entry on the home page', () => {
    const onSearch = jest.fn();
    const view = render(
      <DefaultTopBar
        theme={theme}
        onSearch={onSearch}
        onSettings={jest.fn()}
        onSelectMode={jest.fn()}
      />
    );
    const entry = view.root.findByProps({ accessibilityLabel: 'a11y.search' });
    act(() => entry.props.onPress());
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(
      view.root.findAllByProps({ children: 'topBar.searchPlaceholder' }).length
    ).toBeGreaterThan(0);
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
    const idle = render(
      <DefaultTopBar
        theme={theme}
        onSearch={jest.fn()}
        onSettings={jest.fn()}
        onSelectMode={jest.fn()}
      />
    );
    const toolbarStyle = (renderer: TestRenderer.ReactTestRenderer) =>
      renderer.root
        .findAllByType(View)
        .map((node) => StyleSheet.flatten(node.props.style))
        .find((style) => style?.height === 52 && style?.flexDirection === 'row');
    expect(toolbarStyle(view)).toEqual(toolbarStyle(idle));
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

  it('offers type and date as menus and keeps the chosen type when selected again', () => {
    const onToggleKind = jest.fn();
    const onClearKinds = jest.fn();
    const onSelectDate = jest.fn();
    const view = render(
      <HomeFilterChipsRow
        resultCount={6}
        selectedKinds={['file']}
        selectedDate="today"
        onToggleKind={onToggleKind}
        onClearKinds={onClearKinds}
        onSelectDate={onSelectDate}
        theme={theme}
      />
    );
    expect(view.root.findAllByType('Menu' as never)).toHaveLength(2);
    expect(
      view.root.findByProps({ testID: 'history-result-count' }).props.accessibilityLiveRegion
    ).toBe('polite');
    const buttons = view.root.findAllByType('SwiftUIButton' as never);
    act(() => buttons.find((node) => node.props.testID === 'history-kind-file')!.props.onPress());
    expect(onToggleKind).not.toHaveBeenCalled();
    act(() => buttons.find((node) => node.props.testID === 'history-kind-image')!.props.onPress());
    expect(onToggleKind).toHaveBeenCalledWith('image');
    act(() => buttons.find((node) => node.props.testID === 'history-date-all')!.props.onPress());
    expect(onSelectDate).toHaveBeenCalledWith('all');
  });

  it('leaves browsing filters intact when search is cancelled', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/useHomeController.ts'), 'utf8');
    const close = source.match(/const closeSearch = useCallback\([\s\S]*?\n  },[^\n]*\n/)?.[0];
    expect(close).toBeDefined();
    expect(close).not.toContain('setSelectedFilterKinds');
    expect(close).not.toContain('setSelectedDateFilter');
    expect(close).not.toContain('searchItems(undefined)');
  });
});
