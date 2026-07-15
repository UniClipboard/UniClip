import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, RefreshControl, StatusBar, type ColorValue } from 'react-native';
import Animated from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { iosColors } from '@/theme/iosDesignTokens';
import { AnimatedCardGrid } from '@/components/AnimatedCardGrid';
import { HomeFilterChipsRow } from '@/components/HomeFilterChipsRow';
import { FILTER_CHIP_ROW_HEIGHT } from '@/components/HomeFilterChipsRow.types';
import { SelectModeBottomBar } from '@/components/HomeBottomBar';
import { AddActionsFab } from '@/components/AddActionsFab';
import { ClipboardCard } from '@/components/ClipboardCard';
import { ClipboardItem } from '@/types/clipboard';
import { HomeTopBarArea, HomeSyncBanners } from './HomeChrome';
import { HomeOverlays } from './HomeOverlays';
import { CHIP_ROW_GRID_METRICS } from './chipRowGridMetrics';
import { useChipRowCollapse } from './useChipRowCollapse';
import type { HomeController } from './useHomeController';

const GRID_SPACING = 12;
const GRID_PADDING = 16;
const NUM_COLUMNS = 2;

/**
 * 手机(以及 iPad 分屏 / 小平板竖屏)的单栏首页。这是旧 HomeView 的原始布局,行为零回归:
 * 固定 2 列平分屏宽的历史网格、tap 复制、long-press 上下文浮层、右下 FAB。
 * iOS/Android 共用同一份(与拆分前一致),平台差异全在各子组件内部。
 */
export function HomeCompactView({
  c,
  screenWidth,
  refreshTintColor,
}: {
  c: HomeController;
  screenWidth: number;
  refreshTintColor?: ColorValue;
}) {
  const { theme, items, selectedIds, isSelectMode } = c;
  const backgroundColor = iosColors?.systemGroupedBackground ?? theme.colors.background;

  const cardSize =
    (screenWidth - GRID_PADDING * 2 - GRID_SPACING * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  const chipRowCollapse = useChipRowCollapse(CHIP_ROW_GRID_METRICS.contentInsetTop);
  // 筛选后列表为空时强制展开筛选行,保证用户能撤掉筛选
  const revealChipRow = chipRowCollapse.reveal;
  useEffect(() => {
    if (items.length === 0) revealChipRow();
  }, [items.length, revealChipRow]);

  const renderCard = useCallback(
    (item: ClipboardItem) => (
      <View style={styles.cardSlot}>
        <ClipboardCard
          item={item}
          isLatest={item.profileHash === c.latestId}
          isSelected={selectedIds.has(item.profileHash)}
          isSelectMode={isSelectMode}
          onPress={c.handleItemPress}
          onLongPress={c.handleItemLongPress}
        />
      </View>
    ),
    [c.latestId, c.handleItemPress, c.handleItemLongPress, selectedIds, isSelectMode]
  );

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      <HomeTopBarArea c={c} />
      <HomeSyncBanners c={c} />

      {/*
       * 网格区:筛选 chip 行以 overlay 覆盖在网格顶部(网格内容用 paddingTop 预留同等
       * 高度),随滚动 1:1 收展只动 transform/opacity,零布局重排。行在搜索/多选态也保持
       * 挂载:三种模式共享同一份筛选状态,且网格 paddingTop 恒定,卡片坐标不因模式切换跳变。
       */}
      <View style={styles.gridArea}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name={c.emptyContent.icon} size={48} color={c.emptyContent.tint} />
            <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>
              {c.emptyContent.title}
            </Text>
            <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary }]}>
              {c.emptyContent.description}
            </Text>
          </View>
        ) : (
          <AnimatedCardGrid
            ref={c.listRef}
            items={items}
            numColumns={NUM_COLUMNS}
            cardSize={cardSize}
            spacing={GRID_SPACING}
            paddingHorizontal={GRID_PADDING - GRID_SPACING / 2}
            paddingTop={8 + CHIP_ROW_GRID_METRICS.paddingTopExtra}
            paddingBottom={80}
            keyExtractor={c.keyExtractor}
            renderItem={renderCard}
            contentInsetTop={CHIP_ROW_GRID_METRICS.contentInsetTop}
            onScrollWorklet={chipRowCollapse.onScrollWorklet}
            onScrollEndWorklet={chipRowCollapse.onScrollEndWorklet}
            refreshControl={
              <RefreshControl
                refreshing={c.refreshing}
                onRefresh={c.handleRefresh}
                tintColor={refreshTintColor}
                colors={[theme.colors.accent]}
                progressViewOffset={CHIP_ROW_GRID_METRICS.progressViewOffset || undefined}
              />
            }
          />
        )}

        <Animated.View
          style={[styles.chipRowOverlay, { backgroundColor }, chipRowCollapse.rowStyle]}
          accessibilityElementsHidden={chipRowCollapse.isFullyHidden}
          importantForAccessibility={chipRowCollapse.isFullyHidden ? 'no-hide-descendants' : 'auto'}
        >
          <HomeFilterChipsRow
            selectedKinds={c.selectedFilterKinds}
            selectedDate={c.selectedDateFilter}
            onToggleKind={c.handleToggleFilterKind}
            onClearKinds={c.handleClearFilterKinds}
            onSelectDate={c.setSelectedDateFilter}
            theme={theme}
          />
        </Animated.View>
      </View>

      {/* 多选底栏(默认态由右下 FAB 取代) */}
      {isSelectMode && (
        <View style={[styles.bottomBar, { paddingBottom: c.insets.bottom + 10 }]}>
          <SelectModeBottomBar
            disabled={selectedIds.size === 0}
            onCopy={c.handleBatchCopy}
            onShare={c.handleBatchShare}
            onDelete={c.handleBatchDelete}
            theme={theme}
          />
        </View>
      )}

      {/* 右下融合操作按钮 + 上传悬浮菜单(默认态) */}
      {!isSelectMode && !c.isSearching && (
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
  gridArea: {
    flex: 1,
  },
  chipRowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  cardSlot: {
    flex: 1,
    padding: GRID_SPACING / 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingTop: FILTER_CHIP_ROW_HEIGHT,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
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
