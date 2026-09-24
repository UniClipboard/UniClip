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

/**
 * 搜索态:同一条胶囊变为输入框,前导返回箭头退出搜索(M3 search view)。筛选只在列表上方
 * 的 chip 行里改;有搜索条件时下方一行显示结果数与「重置搜索」。
 */
export function SearchTopBar({
  searchText,
  onChangeText,
  hasActiveFilters,
  resultCount,
  isLoading,
  onReset,
  onClose,
  theme,
}: SearchTopBarProps) {
  const { t } = useTranslation('home');
  const { colors } = theme;
  const hasCriteria = searchText.length > 0 || hasActiveFilters;

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
        </View>
      </View>

      {hasCriteria ? (
        <View style={s.statusRow}>
          <Text
            testID="history-search-result-count"
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[s.statusText, { color: colors.textSecondary }]}
          >
            {isLoading ? t('search.loading') : t('search.resultCount', { count: resultCount ?? 0 })}
          </Text>
          {onReset ? (
            <Pressable
              testID="history-search-reset"
              onPress={onReset}
              accessibilityRole="button"
              android_ripple={{ color: colors.fillSecondary as string }}
              hitSlop={{ top: 8, bottom: 8 }}
              style={s.resetButton}
            >
              <Text style={[s.resetLabel, { color: colors.accent }]}>{t('search.reset')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
  searchWrap: { gap: 4 },
  statusRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
  },
  statusText: { ...m3Type.bodyMedium, flexShrink: 1 },
  resetButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resetLabel: { ...m3Type.labelLarge },
  selectCount: { ...m3Type.titleLarge, flex: 1, marginLeft: 8 },
});
