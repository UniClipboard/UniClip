import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useHomeController } from './useHomeController';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { HomeCompactView } from './HomeCompactView';
import { HomeExpandedView } from './HomeExpandedView';
import type { HomeViewProps } from './HomeView.types';
import { APP_VERSION } from '@/constants';
import { checkForAutomaticUpdate } from '@/features/updates';
import { useSettingsStore } from '@/stores';
import { useMessageStore } from '@/stores/messageStore';
import { NAVIGATION_RAIL_WIDTH } from '@/components/android/mainNavigationMetrics';

/**
 * Android 首页。两级布局:
 * - compact  : 手机(含横屏窄场景)/ 分屏 —— 单栏(HomeCompactView)。
 * - expanded : 平板 / 大屏 —— 方案 B 三栏工作台 · inset(HomeExpandedView)。左侧已是应用级
 *   navigation rail,类型筛选回到网格面板顶部的 chip 行,与手机一致。
 *
 * Android 的 gutter/pane 底色走 M3 表面色阶:gutter=background、浮起面板=surfaceHigh。
 * 取 surfaceHigh(而非仅高半阶的 surfaceLow)是为了让面板在浅色下也明显浮起——
 * surfaceLow 与 background 在 light 下仅差 ~2%,肉眼几乎分不出。网格卡片仍是 surfaceLow,
 * 与手机端一致。
 */
export function HomeView({ onOpenSettings, onOpenAbout, onImmersiveModeChange }: HomeViewProps) {
  const c = useHomeController(onOpenSettings);
  const { t: tAbout, i18n } = useTranslation('settingsAbout');
  const { width: screenWidth } = useWindowDimensions();
  const mode = getLayoutMode(screenWidth);
  const autoCheckUpdate = useSettingsStore((state) => state.config?.autoCheckUpdate ?? true);
  const updateToBeta = useSettingsStore((state) => state.config?.updateToBeta ?? false);
  const debugUpdateCheckNoLimit = useSettingsStore(
    (state) => state.config?.debugUpdateCheckNoLimit ?? false
  );
  const activeLanguage = i18n.resolvedLanguage ?? i18n.language;
  const immersive = c.isSearching || c.isSelectMode;

  useEffect(() => {
    onImmersiveModeChange?.(immersive);
  }, [immersive, onImmersiveModeChange]);

  useEffect(() => () => onImmersiveModeChange?.(false), [onImmersiveModeChange]);

  useEffect(() => {
    void checkForAutomaticUpdate(APP_VERSION, {
      autoCheckUpdate,
      updateToBeta,
      debugUpdateCheckNoLimit,
      language: activeLanguage,
    })
      .then((result) => {
        if (!result?.hasUpdate) return;
        // 非阻断提示:不在启动时用对话框打断用户,Snackbar 附「更新」操作进入关于页
        useMessageStore
          .getState()
          .showMessage(`${tAbout('download.newVersionTitle')} · ${result.latestVersion}`, 'info', {
            action: {
              label: tAbout('update.updateTo', { version: result.latestVersion }),
              onPress: () => onOpenAbout(result),
            },
          });
      })
      .catch(() => {});
  }, [activeLanguage, autoCheckUpdate, updateToBeta, debugUpdateCheckNoLimit, onOpenAbout, tAbout]);

  if (mode === 'compact') {
    return (
      <HomeCompactView c={c} screenWidth={screenWidth} refreshTintColor={c.theme.colors.accent} />
    );
  }

  return (
    <HomeExpandedView
      c={c}
      // expanded 时主页面左侧是应用级 navigation rail(含横屏左侧系统栏),首页只占剩余宽度
      screenWidth={screenWidth - NAVIGATION_RAIL_WIDTH - c.insets.left}
      refreshTintColor={c.theme.colors.accent}
      gutterColor={c.theme.colors.background as string}
      paneColor={c.theme.colors.surfaceHigh}
      filterPlacement="chips"
    />
  );
}
