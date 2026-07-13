import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, StatusBar, type ColorValue } from 'react-native';
import { SelectModeBottomBar } from '@/components/HomeBottomBar';
import { AddActionsFab } from '@/components/AddActionsFab';
import { ClipboardDetailPane } from '@/components/ClipboardDetailPane';
import { ClipboardDetailModal } from '@/components/ClipboardDetailModal';
import { useHomeController } from './useHomeController';
import { HomeMasterGrid } from './HomeMasterGrid';
import { HomeFilterRail } from './HomeFilterRail';
import { HomeTopBarArea, HomeSyncBanners } from './HomeChrome';
import { HomeOverlays } from './HomeOverlays';
import { computeExpandedWorkspaceLayout } from '@/utils/gridLayout';
import type { ClipboardItem } from '@/types/clipboard';

type Controller = ReturnType<typeof useHomeController>;

const RAIL_WIDTH = 72;
const GUTTER = 12; // 面板之间 / 面板与屏幕边的缝隙

/**
 * 平板首页 —— 自适应的筛选栏、历史网格与详情工作台。
 *
 * 足够宽时详情显示在网格右侧;窄平板保留筛选栏与完整网格,点击卡片后打开独立详情页。
 * 各区域使用浮起的圆角面板(paneColor),靠 GUTTER 缝隙分区,不画分割线。Android 面板取
 * surfaceHigh、卡片 surfaceLow ——
 * 卡片明显区别于面板背景(light 卡片更亮浮起、dark 卡片更暗内嵌,两主题都有清晰对比);
 * iOS 走系统分组背景,面板/卡片层级由系统在明暗下自动处理。gutter=background/systemGroupedBackground。
 *
 * 详情在首次点选前只显示轻量占位,避免旋转时在后台重排未使用的图片预览。
 * iOS / Android 差异仅在 gutter/pane 两个底色 token,由各自平台的 HomeView 传入。
 */
export function HomeExpandedView({
  c,
  screenWidth,
  refreshTintColor,
  gutterColor,
  paneColor,
}: {
  c: Controller;
  screenWidth: number;
  refreshTintColor?: ColorValue;
  /** 面板之间缝隙露出的底色(Android=background / iOS=systemGroupedBackground)。
   *  iOS 是 PlatformColor 对象,故用 string | object。 */
  gutterColor: string | object;
  /** 浮起面板的表面色(Android=surfaceHigh / iOS=secondarySystemGroupedBackground) */
  paneColor: string | object;
}) {
  const { theme } = c;
  const workspace = useMemo(() => computeExpandedWorkspaceLayout(screenWidth), [screenWidth]);
  const [detailActivated, setDetailActivated] = useState(false);

  const handleSelectItem = useCallback(
    (item: ClipboardItem) => {
      c.selectDetailItem(item);
      setDetailActivated(true);
    },
    [c.selectDetailItem]
  );

  const panePlaceholder = paneColor as never;
  const showSideDetail = workspace.detailPlacement === 'side';

  return (
    <View style={[styles.container, { backgroundColor: gutterColor as never }]}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <HomeTopBarArea c={c} />
      <HomeSyncBanners c={c} />

      <View style={[styles.split, { padding: GUTTER, gap: GUTTER }]}>
        {/* ── 导航轨(浮起面板)── */}
        <View style={[styles.pane, styles.railPane, { backgroundColor: panePlaceholder }]}>
          <HomeFilterRail c={c} />
        </View>

        {/* ── 历史网格(面板)── 卡片(surfaceLow)在 surfaceHigh 面板上浮起,三栏统一为面板 */}
        <View
          style={[
            styles.pane,
            styles.gridWell,
            { width: workspace.gridWidth },
            { backgroundColor: panePlaceholder },
          ]}
        >
          <HomeMasterGrid
            c={c}
            paneWidth={workspace.gridWidth}
            onSelectItem={handleSelectItem}
            showDetailSelection={detailActivated}
            refreshTintColor={refreshTintColor}
          />
          {c.isSelectMode && (
            <View style={[styles.bottomBar, { paddingBottom: c.insets.bottom + 10 }]}>
              <SelectModeBottomBar
                disabled={c.selectedIds.size === 0}
                onCopy={c.handleBatchCopy}
                onShare={c.handleBatchShare}
                onDelete={c.handleBatchDelete}
                theme={theme}
              />
            </View>
          )}
        </View>

        {showSideDetail && (
          <View
            style={[
              styles.pane,
              styles.sideDetail,
              { width: workspace.detailWidth, backgroundColor: panePlaceholder },
            ]}
          >
            <ClipboardDetailPane c={c} item={detailActivated ? c.detailItem : null} />
          </View>
        )}
      </View>

      <ClipboardDetailModal
        visible={!showSideDetail && detailActivated}
        onDismiss={() => setDetailActivated(false)}
        c={c}
        containerColor={paneColor as ColorValue}
      />

      {/* 上传融合按钮:锚定整屏右下 */}
      {!c.isSelectMode && !c.isSearching && (
        <AddActionsFab
          open={c.showAddMenu}
          onOpenChange={c.setShowAddMenu}
          onTakePhoto={c.handleTakePhoto}
          onPickImage={c.handleUploadImage}
          onPickFile={c.handleUploadFile}
          onUploadClipboard={c.handleUpload}
          onSync={c.handleSyncHistory}
          theme={theme}
        />
      )}

      <HomeOverlays c={c} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  split: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  pane: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  railPane: {
    width: RAIL_WIDTH,
  },
  gridWell: {
    flexGrow: 0,
    flexShrink: 0,
    position: 'relative',
  },
  sideDetail: {
    position: 'absolute',
    top: GUTTER,
    right: GUTTER,
    bottom: GUTTER,
    zIndex: 2,
    elevation: 8,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
