import React from 'react';
import { useWindowDimensions } from 'react-native';
import { iosColors } from '@/theme/iosDesignTokens';
import { useHomeController } from './useHomeController';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { HomeCompactView } from './HomeCompactView';
import { HomeExpandedView } from './HomeExpandedView';
import type { HomeViewProps } from './HomeView.types';

/**
 * iOS 首页。两级布局:
 * - compact  : iPhone(含横屏)/ iPad 分屏 —— 单栏(HomeCompactView)。
 * - expanded : iPad 全屏 / 大屏 —— 方案 B 三栏工作台 · inset(HomeExpandedView)。
 *
 * iOS 的 gutter/pane 底色走系统分组背景:gutter=systemGroupedBackground、
 * 浮起面板=secondarySystemGroupedBackground(与卡片同源,层级由系统在明暗下自动处理)。
 */
export function HomeView({ onOpenSettings }: HomeViewProps) {
  const c = useHomeController(onOpenSettings);
  const { width: screenWidth } = useWindowDimensions();
  const mode = getLayoutMode(screenWidth);

  if (mode === 'compact') {
    return <HomeCompactView c={c} screenWidth={screenWidth} refreshTintColor={undefined} />;
  }

  return (
    <HomeExpandedView
      c={c}
      screenWidth={screenWidth}
      refreshTintColor={undefined}
      gutterColor={iosColors?.systemGroupedBackground ?? (c.theme.colors.background as string)}
      paneColor={iosColors?.secondarySystemGroupedBackground ?? c.theme.colors.surfaceLow}
    />
  );
}
