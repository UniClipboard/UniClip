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

  it('leaves browsing filters intact when search is cancelled', () => {
    const source = fs.readFileSync(path.join(__dirname, '../screens/useHomeController.ts'), 'utf8');
    const close = source.match(/const closeSearch = useCallback\([\s\S]*?\n  },[^\n]*\n/)?.[0];
    expect(close).toBeDefined();
    expect(close).not.toContain('setSelectedFilterKinds');
    expect(close).not.toContain('setSelectedDateFilter');
    expect(close).not.toContain('searchItems(undefined)');
    // 筛选是否随搜索清空由平台策略决定;iOS 保留首页浏览筛选
    expect(close).toContain('if (CLEAR_FILTERS_ON_CLOSE_SEARCH) handleClearFilters();');
    const iosPolicy = fs.readFileSync(
      path.join(__dirname, '../screens/searchFilterPolicy.ios.ts'),
      'utf8'
    );
    expect(iosPolicy).toContain('export const CLEAR_FILTERS_ON_CLOSE_SEARCH = false;');
  });
});
