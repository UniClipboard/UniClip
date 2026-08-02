import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { createDefaultClipboardItem, type ClipboardItem } from '@/types/clipboard';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactActual = require('react') as typeof import('react');
  return (props: Record<string, unknown>) => ReactActual.createElement('Ionicons', props);
});

jest.mock('@/components/AnimatedCardGrid', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    AnimatedCardGrid: ReactActual.forwardRef(
      (
        {
          items,
          renderItem,
        }: {
          items: ClipboardItem[];
          renderItem: (item: ClipboardItem) => React.ReactNode;
        },
        _ref
      ) =>
        ReactActual.createElement(
          'AnimatedCardGrid',
          { renderItem },
          items.map((item) =>
            ReactActual.createElement(
              ReactActual.Fragment,
              { key: item.profileHash },
              renderItem(item)
            )
          )
        )
    ),
  };
});

jest.mock('@/components/ClipboardCard', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    ClipboardCard: (props: Record<string, unknown>) =>
      ReactActual.createElement('ClipboardCard', props),
  };
});

import { HomeMasterGrid } from '@/screens/HomeMasterGrid';
import type { HomeController } from '@/screens/useHomeController';

function item(profileHash: string): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Text',
    text: profileHash,
    profileHash,
    hasData: false,
    timestamp: Date.now(),
  });
}

describe('HomeMasterGrid 详情选择', () => {
  it('首次历史还没读完时不显示空状态', () => {
    const controller = {
      theme: {
        colors: {
          accent: '#6750a4',
          textPrimary: '#111111',
          textSecondary: '#666666',
        },
      },
      items: [],
      isInitialHistoryLoadComplete: false,
      selectedIds: new Set<string>(),
      isSelectMode: false,
      detailItem: null,
      emptyContent: {
        icon: 'clipboard-outline',
        title: 'empty-title',
        description: 'empty-description',
        tint: '#666666',
      },
    } as unknown as HomeController;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<HomeMasterGrid c={controller} paneWidth={900} />);
    });

    expect(renderer.root.findAllByType('Ionicons' as never)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ children: 'empty-title' })).toHaveLength(0);
  });

  it('首次历史读完后确实无数据时显示空状态', () => {
    const controller = {
      theme: {
        colors: {
          accent: '#6750a4',
          textPrimary: '#111111',
          textSecondary: '#666666',
        },
      },
      items: [],
      isInitialHistoryLoadComplete: true,
      selectedIds: new Set<string>(),
      isSelectMode: false,
      detailItem: null,
      emptyContent: {
        icon: 'clipboard-outline',
        title: 'empty-title',
        description: 'empty-description',
        tint: '#666666',
      },
    } as unknown as HomeController;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<HomeMasterGrid c={controller} paneWidth={900} />);
    });

    expect(renderer.root.findAllByType('Ionicons' as never)).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.type === ('Text' as never) && node.props.children === 'empty-title'
      )
    ).toHaveLength(1);
  });

  it('点击非首项时记录为用户主动选择', () => {
    const first = item('first');
    const second = item('second');
    const selectDetailItem = jest.fn();
    const setDetailItem = jest.fn();
    const controller = {
      theme: {
        colors: {
          accent: '#6750a4',
          textPrimary: '#111111',
          textSecondary: '#666666',
        },
      },
      items: [first, second],
      selectedIds: new Set<string>(),
      isSelectMode: false,
      detailItem: first,
      latestId: first.profileHash,
      listRef: React.createRef(),
      keyExtractor: (entry: ClipboardItem) => entry.profileHash,
      handleItemLongPress: jest.fn(),
      handleRefresh: jest.fn(),
      refreshing: false,
      toggleSelection: jest.fn(),
      selectDetailItem,
      setDetailItem,
    } as unknown as HomeController;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<HomeMasterGrid c={controller} paneWidth={900} />);
    });

    expect(renderer.root.findAll((node) => typeof node.props.onLayout === 'function')).toHaveLength(
      0
    );
    const cards = renderer.root.findAll((node) => node.type === ('ClipboardCard' as never));
    act(() => {
      cards[1].props.onPress(second);
    });

    expect(selectDetailItem).toHaveBeenCalledWith(second);
    expect(setDetailItem).not.toHaveBeenCalled();
  });

  it('changing pane width keeps the card renderer stable', () => {
    const first = item('first');
    const controller = {
      theme: {
        colors: {
          accent: '#6750a4',
          textPrimary: '#111111',
          textSecondary: '#666666',
        },
      },
      items: [first],
      selectedIds: new Set<string>(),
      isSelectMode: false,
      detailItem: first,
      latestId: first.profileHash,
      listRef: React.createRef(),
      keyExtractor: (entry: ClipboardItem) => entry.profileHash,
      handleItemLongPress: jest.fn(),
      handleRefresh: jest.fn(),
      refreshing: false,
      toggleSelection: jest.fn(),
      selectDetailItem: jest.fn(),
    } as unknown as HomeController;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<HomeMasterGrid c={controller} paneWidth={603} />);
    });
    const firstRenderItem = renderer.root.findByType('AnimatedCardGrid' as never).props.renderItem;
    act(() => {
      renderer.update(<HomeMasterGrid c={controller} paneWidth={676} />);
    });

    const grid = renderer.root.findByType('AnimatedCardGrid' as never);
    expect(grid.props.renderItem).toBe(firstRenderItem);
    expect(renderer.root.findByType('ClipboardCard' as never).props.cardSize).toBeUndefined();
  });

  it('does not highlight the retained detail item while overlay detail is closed', () => {
    const first = item('first');
    const controller = {
      theme: {
        colors: {
          accent: '#6750a4',
          textPrimary: '#111111',
          textSecondary: '#666666',
        },
      },
      items: [first],
      selectedIds: new Set<string>(),
      isSelectMode: false,
      detailItem: first,
      latestId: first.profileHash,
      listRef: React.createRef(),
      keyExtractor: (entry: ClipboardItem) => entry.profileHash,
      handleItemLongPress: jest.fn(),
      handleRefresh: jest.fn(),
      refreshing: false,
      toggleSelection: jest.fn(),
      selectDetailItem: jest.fn(),
    } as unknown as HomeController;

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <HomeMasterGrid c={controller} paneWidth={603} showDetailSelection={false} />
      );
    });

    expect(renderer.root.findByType('ClipboardCard' as never).props.isSelected).toBe(false);
  });
});
