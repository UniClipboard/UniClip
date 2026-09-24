import React, { useEffect, useMemo, useRef } from 'react';
import { KeyboardAvoidingView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { DefaultTopBar, SelectModeTopBar } from '@/components/HomeTopBar';
import { mainTabBarClearance } from '@/components/ios/MainTabBar';
import { iosColors } from '@/theme/iosDesignTokens';
import { useHomeController } from './useHomeController';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { HomeCompactView } from './HomeCompactView';
import { HomeExpandedView } from './HomeExpandedView';
import { HomeSearchDock } from './ios/HomeSearchDock';
import { HomeLargeTitle, HOME_LARGE_TITLE_HEIGHT } from './ios/HomeLargeTitle';
import { getHomeHistoryCollection } from './ios/homeHistoryCollection';
import { getHomeSearchSlots } from './ios/homeSearchSlots';
import { HomeSearchFilterBar } from './ios/HomeSearchFilterBar';
import type { HomeSearchSlots } from './HomeSearchSlots.types';
import type { HomeViewProps } from './HomeView.types';

/** 顶栏按钮行高度(玻璃胶囊 44pt) */
const TOP_BAR_ROW_HEIGHT = 44;

/**
 * iOS 首页。两级布局:
 * - compact  : iPhone(含横屏)/ iPad 分屏 —— 单栏(HomeCompactView)。
 * - expanded : iPad 全屏 / 大屏 —— 方案 B 三栏工作台 · inset(HomeExpandedView)。
 *
 * 单栏:右上是 Liquid Glass 按钮组(「+」添加菜单、「⋯」选择 / 显示方式),其下是随内容滚动的
 * 大标题;搜索入口是标签栏的搜索圆钮(`searchRequestId`),搜索 / 多选时收起标签栏。
 *
 * iOS 的 gutter/pane 底色走系统分组背景:gutter=systemGroupedBackground、
 * 浮起面板=secondarySystemGroupedBackground(网格区同为该面板色,中间区域是一个整体白面板)。
 */
export function HomeView({ onOpenSettings, onImmersiveModeChange, searchRequestId = 0 }: HomeViewProps) {
  const { width: screenWidth } = useWindowDimensions();
  const mode = getLayoutMode(screenWidth);
  // iPhone 的筛选只在搜索视图里;iPad 的筛选在常驻侧栏,退出搜索不清空
  const c = useHomeController(onOpenSettings, { clearFiltersOnCloseSearch: mode === 'compact' });
  // 搜索、多选、详情页打开时收起标签栏
  const immersive = c.isSearching || c.isSelectMode || c.detailPageItem != null;
  const handledSearchRequest = useRef(searchRequestId);
  const { openSearch } = c;

  useEffect(() => {
    onImmersiveModeChange?.(immersive);
  }, [immersive, onImmersiveModeChange]);
  useEffect(() => () => onImmersiveModeChange?.(false), [onImmersiveModeChange]);

  // 标签栏搜索圆钮:每次按下进入搜索(挂载时的初值不算一次请求)
  useEffect(() => {
    if (searchRequestId === handledSearchRequest.current) return;
    handledSearchRequest.current = searchRequestId;
    openSearch();
  }, [searchRequestId, openSearch]);

  const addActions = useMemo(
    () => ({
      onTakePhoto: c.handleTakePhoto,
      onPickImage: c.handleUploadImage,
      onPickFile: c.handleUploadFile,
      onUploadClipboard: c.handleUpload,
      onSync: c.handleSyncHistory,
    }),
    [c.handleTakePhoto, c.handleUploadImage, c.handleUploadFile, c.handleUpload, c.handleSyncHistory]
  );

  // 网格页眉贴在内容容器边缘,列表页眉在 16pt 内容留白之内;页眉文字都与屏幕左缘保持 20pt
  const headerInset = c.historyLayout === 'grid' ? 20 : 4;
  const search: HomeSearchSlots | undefined = c.isSearching
    ? getHomeSearchSlots(c, headerInset)
    : {
        gridHeader: {
          height: HOME_LARGE_TITLE_HEIGHT,
          node: <HomeLargeTitle title={c.t('nav.clipboard')} horizontalInset={headerInset} />,
        },
      };

  if (mode === 'compact') {
    return (
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <HomeCompactView
          c={c}
          screenWidth={screenWidth}
          refreshTintColor={undefined}
          overlayTopBarHeight={c.insets.top + TOP_BAR_ROW_HEIGHT}
          gridBottomPadding={mainTabBarClearance(c.insets.bottom)}
          showAddActionsFab={false}
          search={search}
          renderCollection={getHomeHistoryCollection(c)}
          topBar={
            <View
              style={[
                styles.topBar,
                { paddingTop: c.insets.top, height: c.insets.top + TOP_BAR_ROW_HEIGHT },
              ]}
            >
              {c.isSelectMode ? (
                <SelectModeTopBar
                  count={c.selectedIds.size}
                  allSelected={c.allSelected}
                  onSelectAll={c.handleSelectAll}
                  onDone={c.exitSelectMode}
                  theme={c.theme}
                />
              ) : c.isSearching ? (
                // 筛选行只在结果视图里出现,空查询时是「建议」
                search?.gridOverlay ? null : (
                  <View style={styles.filterBar}>
                    <HomeSearchFilterBar c={c} />
                  </View>
                )
              ) : (
                <DefaultTopBar
                  onSearch={c.openSearch}
                  onSettings={c.onOpenSettings}
                  onSelectMode={() => {
                    c.setIsSelectMode(true);
                    c.clearSelection();
                  }}
                  historyLayout={c.historyLayout}
                  onHistoryLayoutChange={c.setHistoryLayout}
                  addActions={addActions}
                  theme={c.theme}
                />
              )}
            </View>
          }
          bottomSearch={c.isSearching ? <HomeSearchDock c={c} /> : null}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <HomeExpandedView
        c={c}
        screenWidth={screenWidth}
        refreshTintColor={undefined}
        gutterColor={iosColors?.systemGroupedBackground ?? (c.theme.colors.background as string)}
        paneColor={iosColors?.secondarySystemGroupedBackground ?? c.theme.colors.surfaceLow}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { paddingHorizontal: 16 },
  filterBar: { paddingTop: 4 },
});
