import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DefaultTopBar, SearchTopBar, SelectModeTopBar } from '@/components/HomeTopBar';
import { SyncStatusBanner } from '@/components/SyncStatusBanner';
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
          serverLabel={c.activeServerLabel}
          connectionStatus={c.connectionStatus}
          onSwitchServer={() => c.setShowServerPicker(true)}
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

/**
 * 同步状态 banner:HasNewUnwritten(待应用) / LoopDetected(循环已暂停)。全宽,两种布局共用。
 */
export function HomeSyncBanners({ c }: { c: HomeController }) {
  return (
    <>
      {c.syncState === 'HasNewUnwritten' && (
        <SyncStatusBanner
          variant="staged"
          title={c.t('banner.staged.title', { ns: 'sync' })}
          subtitle={c.stagedPreviewText}
          actionLabel={c.t(c.isApplyingStaged ? 'banner.staged.applying' : 'banner.staged.apply', {
            ns: 'sync',
          })}
          isActionBusy={c.isApplyingStaged}
          onAction={c.handleApplyStagedEntry}
          theme={c.theme}
        />
      )}
      {c.syncState === 'LoopDetected' && (
        <SyncStatusBanner
          variant="loop"
          title={c.t('banner.loop.title', { ns: 'sync' })}
          subtitle={c.t('banner.loop.subtitle', { ns: 'sync' })}
          actionLabel={c.t('banner.loop.dismiss', { ns: 'sync' })}
          onAction={c.handleDismissLoop}
          theme={c.theme}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});
