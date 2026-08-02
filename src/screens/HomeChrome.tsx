import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DefaultTopBar, SearchTopBar, SelectModeTopBar } from '@/components/HomeTopBar';
import type { HomeController } from './useHomeController';

/**
 * 顶栏区域(三态:默认 / 搜索 / 多选)。Compact 与 Expanded 都把它铺在全宽顶部,
 * 因此抽成共享组件。各 TopBar 子组件本身已按平台拆分。
 */
export function HomeTopBarArea({ c }: { c: HomeController }) {
  return (
    <View style={[styles.topBar, { paddingTop: c.insets.top + 4 }]}>
      {c.isSelectMode ? (
        <SelectModeTopBar
          count={c.selectedIds.size}
          allSelected={c.allSelected}
          onSelectAll={c.handleSelectAll}
          onDone={c.exitSelectMode}
          theme={c.theme}
        />
      ) : c.isSearching ? (
        <SearchTopBar
          searchText={c.searchText}
          onChangeText={c.setSearchText}
          selectedKinds={c.selectedFilterKinds}
          selectedDate={c.selectedDateFilter}
          hasActiveFilters={c.hasActiveFilters}
          onOpenFilters={() => c.setShowFilterSheet(true)}
          onRemoveKind={c.handleToggleFilterKind}
          onClearDateFilter={() => c.setSelectedDateFilter('all')}
          onClose={c.closeSearch}
          theme={c.theme}
        />
      ) : (
        <DefaultTopBar
          onOpenSpace={() => c.setShowMySpace(true)}
          onSearch={c.openSearch}
          onSettings={c.onOpenSettings}
          theme={c.theme}
          onSelectMode={() => {
            c.setIsSelectMode(true);
            c.clearSelection();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});
