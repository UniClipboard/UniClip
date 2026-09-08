import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { HomeCompactView } from '@/screens/HomeCompactView';
import { AnimatedCardGrid } from '@/components/AnimatedCardGrid';
import type { HomeController } from '@/screens/useHomeController';

jest.mock('@/components/AnimatedCardGrid', () => ({
  AnimatedCardGrid: require('react').forwardRef(() => null),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@/components/HomeFilterChipsRow', () => ({
  HomeFilterChipsRow: () => null,
}));
jest.mock('@/components/HomeBottomBar', () => ({
  SelectModeBottomBar: () => null,
}));
jest.mock('@/components/AddActionsFab', () => ({ AddActionsFab: () => null }));
jest.mock('@/components/ClipboardCard', () => ({ ClipboardCard: () => null }));
jest.mock('@/screens/HomeChrome', () => ({ HomeTopBarArea: () => null }));
jest.mock('@/screens/HomeOverlays', () => ({ HomeOverlays: () => null }));
jest.mock('@/screens/chipRowGridMetrics', () => ({
  CHIP_ROW_GRID_METRICS: {
    paddingTopExtra: 0,
    contentInsetTop: 46,
    progressViewOffset: 0,
  },
}));
jest.mock('@/screens/useChipRowCollapse', () => ({
  useChipRowCollapse: () => ({ reveal: jest.fn(), rowStyle: {} }),
}));

describe('Home compact list top clearance', () => {
  // The shared setup replaces setImmediate; React's cleanup needs the real scheduler.
  const previousSetImmediate = global.setImmediate;
  beforeAll(() => {
    global.setImmediate = require('node:timers').setImmediate;
  });
  afterAll(() => {
    global.setImmediate = previousSetImmediate;
  });
  it('keeps the same list through empty, first-item, more-item and empty transitions', () => {
    const controller = {
      theme: { colors: {}, isDark: false },
      items: [],
      selectedIds: new Set(),
      insets: { bottom: 34 },
      isInitialHistoryLoadComplete: true,
      emptyContent: {
        icon: 'clipboard',
        title: 'Empty',
        description: 'No items',
      },
      listRef: React.createRef(),
      refreshing: false,
    } as unknown as HomeController;
    const render = () => (
      <HomeCompactView
        c={controller}
        screenWidth={402}
        showFilterRow={false}
        overlayTopBarHeight={118}
      />
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(render());
    });
    const initialGrid = renderer.root.findByType(AnimatedCardGrid);
    for (const count of [1, 2, 0, 1]) {
      controller.items = Array.from({ length: count }, (_, i) => ({
        profileHash: String(i),
      })) as HomeController['items'];
      act(() => {
        renderer.update(render());
      });
      const grid = renderer.root.findByType(AnimatedCardGrid);
      expect(grid === initialGrid).toBe(true);
      expect(grid.props.contentInsetTop).toBe(0);
      const parent = grid.parent!;
      expect(StyleSheet.flatten(parent.props.style).paddingTop).toBe(118);
      expect(grid.props.paddingTop).toBe(8);
      expect(grid.props.refreshControl.props.refreshing).toBe(false);
    }
    controller.refreshing = true;
    act(() => {
      renderer.update(render());
    });
    expect(renderer.root.findByType(AnimatedCardGrid) === initialGrid).toBe(true);
    expect(initialGrid.props.refreshControl.props.refreshing).toBe(true);
    act(() => {
      renderer.unmount();
    });
  });
});
