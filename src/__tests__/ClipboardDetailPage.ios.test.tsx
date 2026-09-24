/**
 * iOS 推入式详情页:动作分配(玻璃工具栏 / 原生菜单)与首页卡片「单击看详情、双击复制」。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ActionMenuItem } from '@/utils/actionMenuItems';
import { HistorySyncStatus, type ClipboardItem } from '@/types/clipboard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@expo/ui/swift-ui', () => ({
  Host: 'Host',
  Menu: 'Menu',
  Section: 'Section',
  Button: 'SwiftUIButton',
}));
jest.mock('@/components/ui', () => ({ GlassContainer: 'GlassContainer' }));
jest.mock(
  'lucide-react-native',
  () =>
    new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : String(key)) })
);
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withTiming: (value: number) => value,
  };
});
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { isDark: false, colors: {} } }),
}));
jest.mock('@/hooks/useURLMetadata', () => ({ useURLMetadata: () => null }));
const mockToggleStar = jest.fn();
jest.mock('@/features/history', () => ({
  historyStorage: { toggleStar: (hash: string) => mockToggleStar(hash) },
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ClipboardDetailPage } from '@/components/ios/ClipboardDetailPage';
import { ClipboardCard } from '@/components/ClipboardCard.ios';
import { lightColors } from '@/theme/colors';

function action(key: string, destructive = false): ActionMenuItem {
  return { key, label: key, icon: `${key}-outline`, destructive, onPress: jest.fn() };
}

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
    theme: { colors: { ...lightColors, inverseAccent: '#fff' }, isDark: false },
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${opts.count}` : key,
    makeActionGroups: jest.fn(() => [actions]),
    openSendTo: jest.fn(),
  };
}

function render(element: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
}

describe('ClipboardDetailPage (iOS)', () => {
  it('puts three kind actions and copy in the glass toolbar and the rest in the native menu', () => {
    const actions = [
      action('copy'),
      action('copyPlain'),
      action('selectText'),
      action('share'),
      action('select'),
      action('delete', true),
    ];
    const c = makeController(actions);
    const item = makeItem();
    const view = render(<ClipboardDetailPage c={c as never} item={item} onClose={jest.fn()} />);
    const root = view.root;

    act(() => root.findByProps({ testID: 'detail-copy' }).props.onPress());
    expect(actions[0].onPress).toHaveBeenCalled();
    for (const key of ['selectText', 'sendTo', 'share']) {
      expect(root.findAllByProps({ testID: `detail-quick-${key}` }).length).toBeGreaterThan(0);
    }
    act(() => root.findByProps({ testID: 'detail-quick-sendTo' }).props.onPress());
    expect(c.openSendTo).toHaveBeenCalledWith(item);

    // 删除单独成组放在菜单末尾
    const sections = root.findAllByType('Section' as never);
    expect(sections).toHaveLength(2);
    const keysIn = (section: TestRenderer.ReactTestInstance) =>
      section.findAllByType('SwiftUIButton' as never).map((b) => b.props.testID);
    expect(keysIn(sections[0])).toEqual(['detail-menu-copyPlain', 'detail-menu-select']);
    expect(keysIn(sections[1])).toEqual(['detail-menu-delete']);
    expect(root.findByProps({ testID: 'detail-menu-delete' }).props.role).toBe('destructive');
  });

  it('leaves the page before entering multi-select and toggles the star', () => {
    const actions = [action('copy'), action('select')];
    const onClose = jest.fn();
    const view = render(
      <ClipboardDetailPage c={makeController(actions) as never} item={makeItem()} onClose={onClose} />
    );
    act(() => view.root.findByProps({ testID: 'detail-menu-select' }).props.onPress());
    expect(onClose).toHaveBeenCalled();
    expect(actions[1].onPress).toHaveBeenCalled();

    act(() => view.root.findByProps({ testID: 'detail-star' }).props.onPress());
    expect(mockToggleStar).toHaveBeenCalledWith('hash-1');
    act(() => view.root.findByProps({ testID: 'detail-back' }).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ClipboardCard (iOS) taps', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens details on a single tap and copies on a double tap', async () => {
    const item = makeItem();
    const onPress = jest.fn();
    const onDoublePress = jest.fn(async () => true);
    const view = render(
      <ClipboardCard item={item} isLatest={false} onPress={onPress} onDoublePress={onDoublePress} />
    );
    const card = () => view.root.findByProps({ testID: 'history-card-hash-1' });

    act(() => card().props.onPress());
    act(() => jest.advanceTimersByTime(350));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDoublePress).not.toHaveBeenCalled();

    await act(async () => {
      card().props.onPress();
      card().props.onPress();
    });
    expect(onDoublePress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(view.root.findAllByProps({ testID: 'history-card-copied-hash-1' }).length).toBeGreaterThan(0);
  });

  it('toggles selection immediately without waiting for a double tap', () => {
    const onPress = jest.fn();
    const view = render(
      <ClipboardCard
        item={makeItem()}
        isLatest={false}
        isSelectMode
        onPress={onPress}
        onDoublePress={jest.fn()}
      />
    );
    act(() => view.root.findByProps({ testID: 'history-card-hash-1' }).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
