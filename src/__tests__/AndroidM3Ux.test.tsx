import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useMessageStore } from '@/stores/messageStore';
import { useUndoableHistoryDelete } from '@/screens/useUndoableHistoryDelete';
import type { HistoryDeleteMode } from '@/utils/historyDeleteMode.types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

const read = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

type Api = ReturnType<typeof useUndoableHistoryDelete>;

function renderDeleteHook(mode: HistoryDeleteMode) {
  const deleteItems = jest.fn(async (_ids: string[]) => {});
  const api: { current: Api | null } = { current: null };
  const messages = {
    deleted: 'Deleted',
    deletedCount: (n: number) => `${n} deleted`,
    undo: 'Undo',
  };
  function Harness() {
    api.current = useUndoableHistoryDelete({
      deleteItems,
      showMessage: useMessageStore.getState().showMessage,
      messages,
      mode,
    });
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness />);
  });
  return { api, deleteItems, unmount: () => act(() => renderer.unmount()) };
}

describe('Android undoable history delete', () => {
  beforeEach(() => useMessageStore.setState({ message: null }));

  it('hides items immediately and offers Undo without deleting', async () => {
    const { api, deleteItems } = renderDeleteHook('undo');
    await act(async () => {
      await api.current!.requestDelete(['a', 'b'], { announce: false });
    });

    expect(api.current!.pendingIds.has('a')).toBe(true);
    const message = useMessageStore.getState().message!;
    expect(message.text).toBe('2 deleted');
    expect(message.action?.label).toBe('Undo');

    act(() => message.action!.onPress());
    expect(api.current!.pendingIds.size).toBe(0);
    // 撤销后即便 snackbar 超时回调也不能再提交删除
    message.onTimeout?.();
    expect(deleteItems).not.toHaveBeenCalled();
  });

  it('commits the soft delete exactly once when the snackbar times out', async () => {
    const { api, deleteItems } = renderDeleteHook('undo');
    await act(async () => {
      await api.current!.requestDelete(['a'], { announce: true });
    });
    const message = useMessageStore.getState().message!;
    await act(async () => {
      message.onTimeout?.();
      message.onTimeout?.();
    });
    expect(deleteItems).toHaveBeenCalledTimes(1);
    expect(deleteItems).toHaveBeenCalledWith(['a']);
    expect(api.current!.pendingIds.size).toBe(0);
  });

  it('commits a pending delete when a newer message replaces the snackbar', async () => {
    const { api, deleteItems } = renderDeleteHook('undo');
    await act(async () => {
      await api.current!.requestDelete(['a'], { announce: true });
    });
    act(() => useMessageStore.getState().showMessage('Copied', 'success'));
    expect(deleteItems).toHaveBeenCalledWith(['a']);
  });

  it('commits outstanding deletes when the screen unmounts', async () => {
    const { api, deleteItems, unmount } = renderDeleteHook('undo');
    await act(async () => {
      await api.current!.requestDelete(['a'], { announce: true });
    });
    unmount();
    expect(deleteItems).toHaveBeenCalledWith(['a']);
  });

  it('keeps the iOS immediate policy: delete at once, announce single deletes only', async () => {
    const { api, deleteItems } = renderDeleteHook('immediate');
    await act(async () => {
      await api.current!.requestDelete(['a', 'b'], { announce: false });
    });
    expect(deleteItems).toHaveBeenCalledWith(['a', 'b']);
    expect(useMessageStore.getState().message).toBeNull();
    expect(api.current!.pendingIds.size).toBe(0);
  });
});

describe('Android Material 3 interaction contracts', () => {
  it('enters selection mode on long press on Android and keeps the iOS context menu', () => {
    const controller = read('screens/useHomeController.ts');
    expect(read('utils/homeLongPressMode.android.ts')).toContain("= 'select'");
    expect(read('utils/homeLongPressMode.ios.ts')).toContain("= 'contextMenu'");
    expect(controller).toContain("if (HOME_LONG_PRESS_MODE === 'select')");
  });

  it('uses a search bar and a contextual action bar instead of iOS header pills', () => {
    const topBar = read('components/HomeTopBar.android.tsx');
    expect(topBar).not.toContain("t('action.select', { ns: 'common' })");
    // 设置是底部导航的顶级目的地,搜索栏不再承载设置入口
    expect(topBar).not.toContain('testID="home-settings"');
    expect(topBar).not.toContain('onSettings');
    expect(topBar).toContain('icon="arrow-back"');
    expect(topBar).toContain(
      '<OverflowMenu testID="history-selection-more" items={itemActions} />'
    );
  });

  it('renders messages as a bottom M3 snackbar with an optional action', () => {
    const snackbar = read('components/MessageToast.android.tsx');
    expect(snackbar).toContain('theme.colors.inverseSurface');
    expect(snackbar).toContain('theme.colors.inverseAccent');
    expect(snackbar).toContain('testID="snackbar-action"');
    expect(snackbar).not.toContain('topOffset');
    expect(read('screens/HomeOverlays.tsx')).toContain(
      '<ConnectedMessageToast bottomOffset={c.insets.bottom + 12 + 56 + 12} />'
    );
  });

  it('does not interrupt launch with a blocking update dialog', () => {
    const home = read('screens/HomeView.android.tsx');
    expect(home).not.toContain('Alert.alert');
    expect(home).toMatch(/useMessageStore\s*\.getState\(\)\s*\.showMessage\(/);
  });

  it('enables the Android predictive back gesture', () => {
    const appJson = JSON.parse(read('../app.json')) as {
      expo: { android: { predictiveBackGestureEnabled: boolean } };
    };
    expect(appJson.expo.android.predictiveBackGestureEnabled).toBe(true);
  });

  it('gives Android icon buttons a 48dp target and ripple feedback', () => {
    const button = read('components/android/M3IconButton.tsx');
    expect(button).toContain('width: M3_MIN_TOUCH_TARGET');
    expect(button).toContain('android_ripple=');
    expect(read('theme/m3Typography.ts')).toContain('export const M3_MIN_TOUCH_TARGET = 48;');
  });
});

describe('Android Material 3 sheets, feedback and tokens', () => {
  it('lets the bottom sheet drag handle actually dismiss the sheet', () => {
    const sheet = read('components/ui/AppBottomSheet.android.tsx');
    expect(sheet).toContain('<GestureDetector gesture={dragGesture}>');
    expect(sheet).toContain('scheduleOnRN(onDismiss)');
    expect(sheet).toContain('onAccessibilityTap={onDismiss}');
  });

  it('keeps history filters inside the search view only', () => {
    const topBar = read('components/HomeTopBar.android.tsx');
    expect(topBar).not.toContain('onOpenFilters');
    expect(topBar).not.toContain('HistoryFilterTags');
    expect(topBar).not.toContain('history-search-reset');
    expect(fs.existsSync(path.join(__dirname, '..', 'components/HistoryFilterSheet.tsx'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(__dirname, '..', 'components/HomeFilterChipsRow.tsx'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(__dirname, '..', 'screens/useChipRowCollapse.ts'))).toBe(false);
    expect(read('screens/HomeCompactView.tsx')).not.toContain('FilterChipsRow');
    expect(read('screens/HomeOverlays.tsx')).not.toContain('HistoryFilterSheet');
    expect(read('screens/useHomeController.ts')).not.toContain('showFilterSheet');
    expect(read('screens/searchFilterPolicy.android.ts')).toContain(
      'export const CLEAR_FILTERS_ON_CLOSE_SEARCH = true;'
    );
  });

  it('starts full-screen page titles at the leading edge', () => {
    const share = read('components/ShareSendSheet/ShareSendSheet.android.tsx');
    expect(share).not.toMatch(/title: \{[^}]*textAlign: 'center'/);
    expect(share).toContain('<M3IconButton');
  });

  it('uses ripple instead of iOS press scaling on history cards', () => {
    const card = read('components/ClipboardCard.android.tsx');
    expect(card).toContain('foreground: true');
    expect(card).not.toContain('pressScale');
    expect(card).not.toContain('iosDimensions');
  });

  it('gives filter chips a 48dp touch target without width-changing checkmarks', () => {
    const chip = read('components/android/FilterChip.tsx');
    expect(chip).toContain('hitSlop={{ top: 8, bottom: 8 }}');
    expect(chip).toContain('android_ripple=');
    expect(chip).not.toContain('checkmark');
  });

  it('opens each search filter chip as a start-aligned single-choice menu', () => {
    const bar = read('screens/android/HomeSearchFilterBar.tsx');
    expect(bar.match(/<OverflowMenu\n\s+align="start"/g)).toHaveLength(3);
    expect(bar.match(/renderTrigger=\{\(open\) => \(/g)).toHaveLength(3);
    // 清除只走菜单首项「全部」与行尾「清除」,chip 内不嵌套可点的 ×
    expect(bar).not.toContain('history-filter-date-clear');
    expect(bar).not.toContain('<Modal');
    expect(read('components/android/OverflowMenu.tsx')).toContain("align?: 'start' | 'end';");
  });

  it('removes iOS disclosure chevrons and the entry spinner from Android settings', () => {
    const settings = read('screens/SettingsScreen.android.tsx');
    expect(settings).not.toContain('ICONS.chevron');
    expect(settings).not.toContain('ActivityIndicator');
  });

  it('follows the M3 FAB menu: labelled pill items, no icon tiles, no sync entry', () => {
    const fab = read('components/AddActionsFab.android.tsx');
    expect(fab).toContain('const FAB_CORNER = 16;');
    expect(fab).toContain('borderRadius: FAB_CORNER,');
    expect(fab).toContain('accessibilityRole="menuitem"');
    expect(fab).not.toContain('onSync');
    expect(fab).not.toContain('borderCurve');
    // 同步改由下拉刷新承担,失败必须可见
    expect(read('screens/useHomeController.ts')).toMatch(
      /synchronize\(\);\n\s+await loadItems\(\);\n\s+\} catch \{[\s\S]*?toast\.syncFailed/
    );
  });

  it('keeps iOS system colors out of the Android palette', () => {
    const palette = read('theme/colors.android.ts');
    for (const iosColor of ['#34C759', '#FF9500', '#5AC8FA', '#8E8E93', '#F44336']) {
      expect(palette).not.toContain(iosColor);
    }
    expect(read('theme/colors.types.ts')).toContain('inverseAccent: Color;');
  });
});
