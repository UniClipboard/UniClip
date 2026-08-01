import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopRightMenu } from './TopRightMenu';
import type {
  DefaultTopBarProps,
  SearchTopBarProps,
  SelectModeTopBarProps,
} from './HomeTopBar.types';
import { HistoryFilterTags } from '@/components/HistoryFilterTags';

export function DefaultTopBar({
  onOpenSpace,
  onSearch,
  onSettings,
  onSelectMode,
  theme,
}: DefaultTopBarProps) {
  const { t } = useTranslation('home');
  return (
    <View style={s.row}>
      <Pressable
        onPress={onOpenSpace}
        style={({ pressed }) => [
          s.spaceStatus,
          { backgroundColor: theme.colors.surfaceHigh },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={t('topBar.openSpaceA11y')}
      >
        <Text style={[s.label, { color: theme.colors.textPrimary }]} numberOfLines={1}>
          {t('topBar.mySpace')}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.colors.textSecondary} />
      </Pressable>
      <View style={s.actions}>
        <Pressable
          onPress={onSelectMode}
          style={[s.pill, { backgroundColor: theme.colors.surfaceHigh }]}
        >
          <Text style={[s.pillText, { color: theme.colors.textPrimary }]}>
            {t('action.select', { ns: 'common' })}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSearch}
          style={s.iconBtn}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <Ionicons name="search" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <TopRightMenu
          items={[{ label: t('action.settings', { ns: 'common' }), onPress: onSettings }]}
        />
      </View>
    </View>
  );
}

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
  const bg = { backgroundColor: theme.colors.surfaceHigh };

  return (
    <View style={s.searchWrap}>
      <View style={s.searchRow}>
        <View style={s.boxWrap}>
          <View style={[s.searchBox, bg]}>
            <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: theme.colors.textPrimary }]}
              value={searchText}
              onChangeText={onChangeText}
              placeholder={t('topBar.searchPlaceholder')}
              placeholderTextColor={theme.colors.textSecondary}
              autoFocus
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => onChangeText('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </View>
        </View>
        <Pressable onPress={onOpenFilters} style={[s.circle, bg]}>
          <Ionicons
            name={hasActiveFilters ? 'filter-circle' : 'filter-circle-outline'}
            size={21}
            color={hasActiveFilters ? theme.colors.accent : theme.colors.textPrimary}
          />
        </Pressable>
        <Pressable onPress={onClose} style={[s.circle, bg]}>
          <Ionicons name="close" size={20} color={theme.colors.textPrimary} />
        </Pressable>
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

export function SelectModeTopBar({
  count,
  allSelected,
  onSelectAll,
  onDone,
  theme,
}: SelectModeTopBarProps) {
  const { t } = useTranslation('home');
  return (
    <View style={s.row}>
      <Text style={[s.selectCount, { color: theme.colors.textPrimary }]}>
        {t('topBar.selectedCount', { n: count })}
      </Text>
      <View style={s.actions}>
        <Pressable
          onPress={onSelectAll}
          style={[s.pill, { backgroundColor: theme.colors.surfaceHigh }]}
        >
          <Text style={[s.pillText, { color: theme.colors.textPrimary }]}>
            {allSelected ? t('topBar.deselectAll') : t('action.selectAll', { ns: 'common' })}
          </Text>
        </Pressable>
        <Pressable onPress={onDone} style={[s.pill, { backgroundColor: theme.colors.surfaceHigh }]}>
          <Text style={[s.pillText, { color: theme.colors.textPrimary }]}>
            {t('action.done', { ns: 'common' })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52 },
  spaceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    height: 36,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 18,
  },
  label: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { justifyContent: 'center', alignItems: 'center' },
  selectCount: { fontSize: 14, fontWeight: '600' },
  pill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: { fontSize: 14, fontWeight: '500' },
  searchWrap: { gap: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 8 },
  boxWrap: { flex: 1 },
  searchBox: {
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
