import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, RefreshControl, type ColorValue } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedCardGrid } from '@/components/AnimatedCardGrid';
import { ClipboardCard } from '@/components/ClipboardCard';
import { ClipboardItem } from '@/types/clipboard';
import { computeGridMetrics } from '@/utils/gridLayout';
import type { HomeController } from './useHomeController';
import { iosDimensions } from '@/theme/iosDesignTokens';

const GRID_SPACING = 12;
const GRID_PADDING = 16;

/**
 * Expanded 双栏的左栏:自适应多列历史网格。列数按左栏实测宽度反推(computeGridMetrics,
 * 目标卡宽 160–210pt),因此在不同平板宽度 / 左栏占比下都保持合理密度。
 *
 * 与 Compact 的关键差异:tap 不再直接复制,而是把该项设为右栏详情(master-detail 语义);
 * 复制改由右栏详情面板的显式动作承担。多选模式下 tap 仍是勾选。
 */
export function HomeMasterGrid({
  c,
  paneWidth,
  onSelectItem,
  showDetailSelection = true,
  refreshTintColor,
}: {
  c: HomeController;
  paneWidth: number;
  onSelectItem?: (item: ClipboardItem) => void;
  showDetailSelection?: boolean;
  refreshTintColor?: ColorValue;
}) {
  const { theme, items, selectedIds, isSelectMode, detailItem } = c;

  const { numColumns, cardSize } = useMemo(
    () => computeGridMetrics(paneWidth, GRID_PADDING, GRID_SPACING, 2),
    [paneWidth]
  );

  const handlePress = useCallback(
    (item: ClipboardItem) => {
      if (isSelectMode) {
        c.toggleSelection(item.profileHash);
        return;
      }
      (onSelectItem ?? c.selectDetailItem)(item);
    },
    [isSelectMode, c.toggleSelection, c.selectDetailItem, onSelectItem]
  );

  const renderCard = useCallback(
    (item: ClipboardItem) => {
      const active = isSelectMode
        ? selectedIds.has(item.profileHash)
        : showDetailSelection && detailItem?.profileHash === item.profileHash;
      return (
        <ClipboardCard
          item={item}
          isLatest={item.profileHash === c.latestId}
          isSelected={active}
          isSelectMode={isSelectMode}
          onPress={handlePress}
          onLongPress={c.handleItemLongPress}
        />
      );
    },
    [
      c.latestId,
      c.handleItemLongPress,
      handlePress,
      selectedIds,
      isSelectMode,
      detailItem,
      showDetailSelection,
    ]
  );

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons name={c.emptyContent.icon} size={48} color={c.emptyContent.tint} />
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>
            {c.emptyContent.title}
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary }]}>
            {c.emptyContent.description}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AnimatedCardGrid
        ref={c.listRef}
        items={items}
        numColumns={numColumns}
        cardSize={cardSize}
        renderCardSize={iosDimensions.gridAdaptiveMax}
        spacing={GRID_SPACING}
        paddingHorizontal={GRID_PADDING - GRID_SPACING / 2}
        paddingTop={8}
        paddingBottom={80}
        keyExtractor={c.keyExtractor}
        renderItem={renderCard}
        refreshControl={
          <RefreshControl
            refreshing={c.refreshing}
            onRefresh={c.handleRefresh}
            tintColor={refreshTintColor}
            colors={[theme.colors.accent]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
