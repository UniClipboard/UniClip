import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HomeController } from '@/screens/useHomeController';
import type { HomeCollectionSlot } from '@/screens/HomeCollectionSlot.types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: {} } }),
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/android/HistoryList', () => ({
  HistoryList: 'HistoryList',
}));

import { DefaultTopBar } from '@/components/HomeTopBar.android';
import { useHistoryDisplaySettings } from '@/hooks/useHistoryDisplaySettings';
import { getHomeHistoryCollection } from '@/screens/android/homeHistoryCollection';

const STORAGE_KEY = '@syncclipboard:history_display_settings';
const theme = { colors: {}, isDark: false } as unknown as React.ComponentProps<
  typeof DefaultTopBar
>['theme'];

type Measure = (cb: (x: number, y: number, w: number, h: number) => void) => void;

function renderTopBar(props: Partial<React.ComponentProps<typeof DefaultTopBar>> = {}) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <DefaultTopBar
        onSearch={jest.fn()}
        onSettings={jest.fn()}
        onSelectMode={jest.fn()}
        theme={theme}
        {...props}
      />
    );
  });
  for (const node of renderer.root.findAll(
    (n) => n.props.collapsable === false && n.instance != null
  )) {
    (node.instance as { measureInWindow: Measure }).measureInWindow = (cb) => cb(300, 44, 48, 48);
  }
  return renderer;
}

describe('Android history display mode menu', () => {
  it('is absent unless the home layout supports switching', () => {
    const renderer = renderTopBar();
    expect(renderer.root.findAll((n) => n.props.testID === 'history-layout-menu')).toHaveLength(0);
  });

  it('lists list / compact / grid, marks the current one and reports the choice', () => {
    const onChange = jest.fn();
    const renderer = renderTopBar({
      historyLayout: 'grid',
      onHistoryLayoutChange: onChange,
    });

    const trigger = renderer.root.findAll(
      (n) => n.props.testID === 'history-layout-menu' && typeof n.props.onPress === 'function'
    )[0];
    act(() => trigger.props.onPress());
    const option = (key: string) =>
      renderer.root.findAll((n) => n.props.testID === `overflow-action-layout-${key}`)[0];
    expect(['list', 'compact', 'grid'].map((k) => option(k).props.accessibilityState)).toEqual([
      { checked: false },
      { checked: false },
      { checked: true },
    ]);

    act(() => option('compact').props.onPress());
    expect(onChange).toHaveBeenCalledWith('compact');
  });
});

describe('history display settings persistence', () => {
  const getItem = AsyncStorage.getItem as jest.Mock;
  const setItem = AsyncStorage.setItem as jest.Mock;

  function mountHook() {
    const result: {
      current: ReturnType<typeof useHistoryDisplaySettings> | null;
    } = {
      current: null,
    };
    function Harness() {
      result.current = useHistoryDisplaySettings();
      return null;
    }
    act(() => {
      TestRenderer.create(<Harness />);
    });
    return result;
  }

  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset().mockResolvedValue(undefined);
  });

  it('defaults existing users to the grid', async () => {
    getItem.mockResolvedValue(JSON.stringify({ showFullImage: true }));
    const result = mountHook();
    await act(async () => {});
    expect(result.current?.isLoading).toBe(false);
    expect(result.current?.historyLayout).toBe('grid');
  });

  it('restores a saved layout, ignores unknown values and persists changes per device', async () => {
    getItem.mockResolvedValue(JSON.stringify({ historyLayout: 'masonry' }));
    const result = mountHook();
    await act(async () => {});
    expect(result.current?.historyLayout).toBe('grid');

    act(() => result.current?.setHistoryLayout('compact'));
    expect(result.current?.historyLayout).toBe('compact');
    expect(setItem).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      expect.stringContaining('"historyLayout":"compact"')
    );

    getItem.mockResolvedValue(setItem.mock.calls[setItem.mock.calls.length - 1][1]);
    const restored = mountHook();
    await act(async () => {});
    expect(restored.current?.historyLayout).toBe('compact');
  });
});

describe('Android home history collection', () => {
  const slot = {
    paddingTop: 8,
    paddingBottom: 120,
    refreshControl: <></>,
  } as unknown as HomeCollectionSlot;
  const controller = (overrides: Partial<HomeController>) =>
    ({
      historyLayout: 'grid',
      isHistoryLayoutLoading: false,
      items: [],
      selectedIds: new Set(),
      handleItemPress: jest.fn(),
      handleItemCopy: jest.fn(),
      handleItemLongPress: jest.fn(),
      handleItemDelete: jest.fn(),
      ...overrides,
    } as unknown as HomeController);

  it('keeps the shared card grid for the grid layout', () => {
    expect(getHomeHistoryCollection(controller({ historyLayout: 'grid' }))).toBeUndefined();
  });

  it('renders nothing until the saved layout is known, so the grid never flashes first', () => {
    const render = getHomeHistoryCollection(controller({ isHistoryLayoutLoading: true }));
    expect(render?.(slot)).toBeNull();
  });

  it('drives the grouped list from the same controller in both list densities', () => {
    const c = controller({ historyLayout: 'compact' });
    const list = getHomeHistoryCollection(c)!(slot) as React.ReactElement<Record<string, unknown>>;
    expect(list.props).toMatchObject({
      density: 'compact',
      paddingBottom: 120,
      onPress: c.handleItemPress,
      onCopy: c.handleItemCopy,
      onLongPress: c.handleItemLongPress,
      onDelete: c.handleItemDelete,
    });
    const comfortable = getHomeHistoryCollection(controller({ historyLayout: 'list' }))!(
      slot
    ) as React.ReactElement<Record<string, unknown>>;
    expect(comfortable.props.density).toBe('comfortable');
  });
});
