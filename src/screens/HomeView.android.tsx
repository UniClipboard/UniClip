import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useHomeController } from './useHomeController';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { HomeCompactView } from './HomeCompactView';
import { HomeExpandedView } from './HomeExpandedView';
import type { HomeViewProps } from './HomeView.types';

/**
 * Android 首页。两级布局:
 * - compact  : 手机(含横屏窄场景)/ 分屏 —— 单栏(HomeCompactView)。
 * - expanded : 平板 / 大屏 —— 方案 B 三栏工作台 · inset(HomeExpandedView)。
 *
 * Android 的 gutter/pane 底色走 M3 表面色阶:gutter=background、浮起面板=surfaceHigh。
 * 取 surfaceHigh(而非仅高半阶的 surfaceLow)是为了让面板在浅色下也明显浮起——
 * surfaceLow 与 background 在 light 下仅差 ~2%,肉眼几乎分不出。网格卡片仍是 surfaceLow,
 * 与手机端一致。
 */
export function HomeView({ onOpenSettings }: HomeViewProps) {
  const c = useHomeController(onOpenSettings);
  const { width: screenWidth } = useWindowDimensions();
  const mode = getLayoutMode(screenWidth);

  if (mode === 'compact') {
    return (
      <HomeCompactView c={c} screenWidth={screenWidth} refreshTintColor={c.theme.colors.accent} />
    );
  }

  return (
    <HomeExpandedView
      c={c}
      screenWidth={screenWidth}
      refreshTintColor={c.theme.colors.accent}
      gutterColor={c.theme.colors.background as string}
      paneColor={c.theme.colors.surfaceHigh}
    />
  );
}
