/**
 * Android 全屏详情页:动作分配(浮动工具栏 / 内联 / 溢出菜单)与页面行为,
 * 以及首页卡片「单击看详情、双击复制、长按多选」的平台接线。
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import TestRenderer, { act } from 'react-test-renderer';
import type { ActionMenuItem } from '@/utils/actionMenuItems';
import type { DisplayKind } from '@/utils/displayKind';
import { getDetailPageActionLayout } from '@/utils/detailActionLayout';
import { HistorySyncStatus, type ClipboardItem } from '@/types/clipboard';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@/hooks/useURLMetadata', () => ({ useURLMetadata: () => null }));
const overflowItems: { current: ActionMenuItem[] } = { current: [] };
jest.mock('@/components/android/OverflowMenu', () => ({
  OverflowMenu: ({ items }: { items: ActionMenuItem[] }) => {
    overflowItems.current = items;
    return null;
  },
}));

import { ClipboardDetailPage } from '@/components/android/ClipboardDetailPage';
import { lightColors } from '@/theme/colors';

function action(key: string): ActionMenuItem {
  return { key, label: key, icon: `${key}-outline`, onPress: jest.fn() };
}

const ALL_KEYS = [
  'copy',
  'copyPlain',
  'selectText',
  'openBrowser',
  'saveImage',
  'saveFile',
  'resend',
  'sendTo',
  'share',
  'select',
  'delete',
];

describe('getDetailPageActionLayout', () => {
  const expected: Record<DisplayKind, { quick: string[]; inline: string[] }> = {
    text: { quick: ['selectText', 'sendTo', 'share'], inline: [] },
    url: { quick: ['selectText', 'sendTo', 'share'], inline: ['openBrowser'] },
    image: { quick: ['saveImage', 'sendTo', 'share'], inline: [] },
    file: { quick: ['saveFile', 'sendTo', 'share'], inline: [] },
    group: { quick: ['saveFile', 'sendTo', 'share'], inline: [] },
  };

  it.each(Object.entries(expected) as [DisplayKind, (typeof expected)['text']][])(
    'places every %s action exactly once',
    (kind, { quick, inline }) => {
      const layout = getDetailPageActionLayout(ALL_KEYS.map(action), kind);
      expect(layout.primary?.key).toBe('copy');
      expect(layout.quick.map((a) => a.key)).toEqual(quick);
      expect(Object.keys(layout.inline)).toEqual(inline);

      const placed = [
        layout.primary!.key,
        ...layout.quick.map((a) => a.key),
        ...Object.keys(layout.inline),
        ...layout.overflow.map((a) => a.key),
      ];
      expect([...placed].sort()).toEqual([...ALL_KEYS].sort());
    }
  );

  it('skips quick actions the item does not offer', () => {
    const layout = getDetailPageActionLayout(
      ['copy', 'share', 'select', 'delete'].map(action),
      'text'
    );
    expect(layout.quick.map((a) => a.key)).toEqual(['share']);
    expect(layout.overflow.map((a) => a.key)).toEqual(['select', 'delete']);
  });
});

function makeItem(overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  return {
    type: 'Text',
    text: 'hello\nworld',
    profileHash: 'hash-1',
    hasData: false,
    timestamp: Date.now(),
    starred: false,
    syncStatus: HistorySyncStatus.Synced,
    version: 1,
    lastModified: 0,
    lastAccessed: 0,
    isDeleted: false,
    pinned: false,
    isLocalFileReady: true,
    ...overrides,
  } as ClipboardItem;
}

function makeController(actions: ActionMenuItem[]) {
  return {
    theme: { colors: lightColors, isDark: false },
    insets: { top: 24, bottom: 16, left: 0, right: 0 },
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${opts.count}` : key,
    makeActionGroups: jest.fn(() => [actions]),
    openSendTo: jest.fn(),
  } as never;
}

describe('ClipboardDetailPage (Android)', () => {
  it('renders quick actions and copy in the floating toolbar and the rest in the menu', () => {
    const actions = ['copy', 'copyPlain', 'selectText', 'share', 'select', 'delete'].map(action);
    const controller = makeController(actions) as unknown as { openSendTo: jest.Mock };
    const item = makeItem();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ClipboardDetailPage c={controller as never} item={item} onClose={jest.fn()} />
      );
    });
    const root = renderer!.root;

    root.findByProps({ testID: 'detail-primary-action' }).props.onPress();
    expect(actions[0].onPress).toHaveBeenCalled();
    expect(root.findAllByProps({ testID: 'detail-quick-selectText' }).length).toBeGreaterThan(0);
    // 系统分享保持原样;「发送到」是独立动作,经同步通道发给所选设备。
    const share = root.findAllByProps({ testID: 'detail-quick-share' })[0];
    expect(share.props.accessibilityLabel).toBe('share');
    share.props.onPress();
    expect(actions[3].onPress).toHaveBeenCalled();
    const sendTo = root.findAllByProps({ testID: 'detail-quick-sendTo' })[0];
    expect(sendTo.props.accessibilityLabel).toBe('detail.sendTo');
    expect(sendTo.props.icon).toBe('paper-plane-outline');
    sendTo.props.onPress();
    expect(controller.openSendTo).toHaveBeenCalledWith(item);
    expect(overflowItems.current.map((a) => a.key)).toEqual(['copyPlain', 'select', 'delete']);
  });

  it('closes the page before entering multi-select from the menu', () => {
    const actions = ['copy', 'select'].map(action);
    const onClose = jest.fn();
    act(() => {
      TestRenderer.create(
        <ClipboardDetailPage c={makeController(actions)} item={makeItem()} onClose={onClose} />
      );
    });
    overflowItems.current.find((a) => a.key === 'select')!.onPress();
    expect(onClose).toHaveBeenCalled();
    expect(actions[1].onPress).toHaveBeenCalled();
  });

  it('closes from the back button', () => {
    const onClose = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ClipboardDetailPage
          c={makeController([action('copy')])}
          item={makeItem()}
          onClose={onClose}
        />
      );
    });
    renderer!.root.findByProps({ testID: 'detail-back' }).props.onPress();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Android home card tap wiring', () => {
  const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

  it('opens details on tap and copies on double tap only on Android', () => {
    expect(read('utils/homeCardTapMode.android.ts')).toContain("= 'detail'");
    expect(read('utils/homeCardTapMode.ios.ts')).toContain("= 'copy'");
    expect(read('utils/homeLongPressMode.android.ts')).toContain("= 'select'");

    const controller = read('screens/useHomeController.ts');
    expect(controller).toContain("HOME_CARD_TAP_MODE === 'detail'");
    expect(controller).toContain('openDetailPage(item)');
    expect(controller).toMatch(
      /handleItemDoublePress = HOME_CARD_TAP_MODE === 'detail' \? handleItemCopy : undefined/
    );

    for (const grid of ['screens/HomeCompactView.tsx', 'screens/HomeMasterGrid.tsx']) {
      expect(read(grid)).toContain('onDoublePress={c.handleItemDoublePress}');
    }
    expect(read('components/ClipboardCard.android.tsx')).toContain('useDoubleTap(');
  });

  it('renders the detail page from the stable home overlays', () => {
    const overlays = read('screens/HomeOverlays.tsx');
    expect(overlays).toContain('visible={c.detailPageItem != null}');
    expect(overlays).toContain('item={c.detailPageItem}');
    expect(overlays).toContain('onDismiss={c.closeDetailPage}');
    // 「发送到」页由首页稳定宿主持有,不在详情页内部渲染。
    expect(overlays).toContain('jobs={c.sendToJobs}');
    expect(overlays).toContain('onClose={c.closeSendTo}');
    expect(read('components/android/ClipboardDetailPage.tsx')).not.toContain('ShareSendSheet');
  });
});
