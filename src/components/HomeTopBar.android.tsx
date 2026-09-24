import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { M3IconButton } from './android/M3IconButton';
import { OverflowMenu } from './android/OverflowMenu';
import type {
  DefaultTopBarProps,
  SearchTopBarProps,
  SelectModeTopBarProps,
} from './HomeTopBar.types';
import { HistoryFilterTags } from '@/components/HistoryFilterTags';
import { m3Type } from '@/theme/m3Typography';

/**
 * 首页默认态:M3 Search bar。整条胶囊点按进入搜索,尾部是设置入口。
 * 多选不在这里提供入口——Android 由长按卡片进入多选。
 */
export function DefaultTopBar({ onSearch, onSettings, theme }: DefaultTopBarProps) {
  const { t } = useTranslation('home');
  const { colors } = theme;
  return (
    <View style={s.row}>
      <View style={[s.searchBar, { backgroundColor: colors.surfaceHigh }]}>
        <Pressable
          testID="history-search-open"
          onPress={onSearch}
          android_ripple={{ color: colors.fillSecondary as string }}
          style={s.searchTrigger}
          accessibilityRole="search"
          accessibilityLabel={t('a11y.search')}
        >
          <Ionicons name="search" size={24} color={colors.textPrimary} />
          <Text style={[s.hint, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('topBar.searchPlaceholder')}
          </Text>
        </Pressable>
        <M3IconButton
          testID="home-settings"
          icon="settings-outline"
          accessibilityLabel={t('action.settings', { ns: 'common' })}
          onPress={onSettings}
          colors={colors}
        />
      </View>
    </View>
  );
}

/** 搜索态:同一条胶囊变为输入框,前导返回箭头退出搜索(M3 search view)。 */
export function SearchTopBar({
  searchText,
  onChangeText,
  selectedKinds,
  selectedDate,
  hasActiveFilters,
  onOpenFilters,
  onRemoveKind,
  onClearDateFilter,
  onClose,
  theme,
}: SearchTopBarProps) {
  const { t } = useTranslation('home');
  const { colors } = theme;

  return (
    <View style={s.searchWrap}>
      <View style={s.row}>
        <View style={[s.searchBar, { backgroundColor: colors.surfaceHigh }]}>
          <M3IconButton
            testID="history-search-close"
            icon="arrow-back"
            accessibilityLabel={t('action.close', { ns: 'common' })}
            onPress={onClose}
            iconColor={colors.textPrimary}
            colors={colors}
          />
          <TextInput
            testID="history-search-input"
            style={[s.searchInput, { color: colors.textPrimary }]}
            value={searchText}
            onChangeText={onChangeText}
            placeholder={t('topBar.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            cursorColor={colors.accent as string}
            selectionColor={colors.accentContainer as string}
            returnKeyType="search"
            autoFocus
          />
          {searchText.length > 0 && (
            <M3IconButton
              testID="history-search-clear"
              icon="close"
              accessibilityLabel={t('a11y.clearSearch')}
              onPress={() => onChangeText('')}
              colors={colors}
            />
          )}
          <M3IconButton
            icon={hasActiveFilters ? 'filter-circle' : 'filter-circle-outline'}
            accessibilityLabel={t('a11y.searchFilters')}
            onPress={onOpenFilters}
            iconColor={hasActiveFilters ? colors.accent : undefined}
            colors={colors}
          />
        </View>
      </View>

      <HistoryFilterTags
        selectedKinds={selectedKinds}
        selectedDate={selectedDate}
        onRemoveKind={onRemoveKind}
        onClearDateFilter={onClearDateFilter}
        theme={theme}
      />
    </View>
  );
}

/**
 * 多选态:M3 上下文操作栏。前导 × 退出,标题为已选数量,尾部全选;
 * 恰好选中一项时追加溢出菜单承载该项的内容类动作(原长按菜单)。
 */
export function SelectModeTopBar({
  count,
  allSelected,
  onSelectAll,
  onDone,
  itemActions,
  theme,
}: SelectModeTopBarProps) {
  const { t } = useTranslation('home');
  const { colors } = theme;
  return (
    <View testID="history-selection-bar" style={s.row}>
      <M3IconButton
        testID="history-selection-close"
        icon="close"
        accessibilityLabel={t('action.close', { ns: 'common' })}
        onPress={onDone}
        iconColor={colors.textPrimary}
        colors={colors}
      />
      <Text
        testID="history-selection-count"
        style={[s.selectCount, { color: colors.textPrimary }]}
        accessibilityLiveRegion="polite"
        numberOfLines={1}
      >
        {t('topBar.selectedCount', { n: count })}
      </Text>
      <M3IconButton
        testID="history-selection-all"
        icon={allSelected ? 'checkbox' : 'checkbox-outline'}
        accessibilityLabel={
          allSelected ? t('topBar.deselectAll') : t('action.selectAll', { ns: 'common' })
        }
        onPress={onSelectAll}
        colors={colors}
      />
      {itemActions && itemActions.length > 0 ? (
        <OverflowMenu testID="history-selection-more" items={itemActions} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, gap: 4 },
  searchBar: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  searchTrigger: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingLeft: 12,
  },
  hint: { ...m3Type.bodyLarge, flexShrink: 1 },
  searchInput: { ...m3Type.bodyLarge, flex: 1, padding: 0, marginLeft: 4 },
  searchWrap: { gap: 6 },
  selectCount: { ...m3Type.titleLarge, flex: 1, marginLeft: 8 },
});
