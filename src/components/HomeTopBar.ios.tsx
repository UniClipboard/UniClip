import React from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Check, Ellipsis, Search, SquareCheckBig, Square, X, XCircle } from 'lucide-react-native';
import { Menu, Button as SwiftUIButton, Host } from '@expo/ui/swift-ui';
import { GlassContainer } from '@/components/ui';
import { iosDimensions, iosColors } from '@/theme/iosDesignTokens';
import { useLayoutMode } from '@/hooks/useLayoutMode';
import type {
  DefaultTopBarProps,
  SearchTopBarProps,
  SelectModeTopBarProps,
} from './HomeTopBar.types';

export function DefaultTopBar({ onSearch, onSettings, onSelectMode, theme }: DefaultTopBarProps) {
  const { t } = useTranslation('home');
  return (
    <View style={s.row}>
      <Pressable
        onPress={onSearch}
        accessibilityRole="search"
        accessibilityLabel={t('a11y.search')}
        style={s.boxWrap}
      >
        <SearchFieldFrame theme={theme}>
          <Text
            numberOfLines={1}
            style={[s.searchPlaceholder, { color: theme.colors.textSecondary }]}
          >
            {t('topBar.searchPlaceholder')}
          </Text>
        </SearchFieldFrame>
      </Pressable>

      <Host style={s.moreButton}>
        <Menu
          label={
            <View style={s.moreButton}>
              <Ellipsis size={22} color={theme.colors.textSecondary} />
            </View>
          }
        >
          <SwiftUIButton
            systemImage="checkmark.circle"
            label={t('action.select', { ns: 'common' })}
            onPress={onSelectMode}
          />
          <SwiftUIButton
            systemImage="gearshape"
            label={t('action.settings', { ns: 'common' })}
            onPress={onSettings}
          />
        </Menu>
      </Host>
    </View>
  );
}

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
  const layoutMode = useLayoutMode();

  return (
    <View style={s.searchWrap}>
      <View style={s.row}>
        <View style={s.boxWrap}>
          <SearchFieldFrame theme={theme}>
            <TextInput
              style={[s.searchInput, { color: theme.colors.textPrimary }]}
              value={searchText}
              onChangeText={onChangeText}
              placeholder={t('topBar.searchPlaceholder')}
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel={t('a11y.search')}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={Keyboard.dismiss}
              autoFocus
            />
            {searchText.length > 0 && (
              <Pressable
                onPress={() => onChangeText('')}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.clearSearch')}
                style={s.clearButton}
              >
                <XCircle size={19} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </SearchFieldFrame>
        </View>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('action.cancel', { ns: 'common' })}
          style={s.moreButton}
        >
          <X size={22} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      {layoutMode === 'expanded' ? (
        <View style={s.statusRow}>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[s.statusText, { color: theme.colors.textSecondary }]}
          >
            {isLoading ? t('search.loading') : t('search.resultCount', { count: resultCount ?? 0 })}
          </Text>
          {(searchText.length > 0 || hasActiveFilters) && onReset ? (
            <Pressable onPress={onReset} accessibilityRole="button" style={s.resetButton}>
              <Text style={[s.statusText, { color: theme.colors.textPrimary }]}>
                {t('search.reset')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SearchFieldFrame({
  theme,
  children,
}: {
  theme: SearchTopBarProps['theme'];
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        s.searchField,
        { backgroundColor: iosColors?.tertiarySystemFill ?? theme.colors.surfaceLow },
      ]}
    >
      <Search size={19} color={theme.colors.textSecondary} />
      {children}
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
    <View style={s.selectionRow}>
      <Text numberOfLines={1} style={[s.selectCount, { color: theme.colors.textPrimary }]}>
        {t('topBar.selectedCount', { n: count })}
      </Text>
      <View style={s.actions}>
        <Pressable
          onPress={onSelectAll}
          accessibilityRole="button"
          accessibilityLabel={
            allSelected ? t('topBar.deselectAll') : t('action.selectAll', { ns: 'common' })
          }
          accessibilityState={{ selected: allSelected }}
        >
          <GlassContainer shape="circle" interactive style={s.selectionButton}>
            {allSelected ? (
              <Square size={22} color={theme.colors.textPrimary} />
            ) : (
              <SquareCheckBig size={22} color={theme.colors.textPrimary} />
            )}
          </GlassContainer>
        </Pressable>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel={t('action.done', { ns: 'common' })}
        >
          <GlassContainer shape="circle" interactive style={s.selectionButton}>
            <Check size={22} color={theme.colors.textPrimary} />
          </GlassContainer>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    gap: 10,
  },
  selectionRow: { flexDirection: 'row', alignItems: 'center', height: 44, gap: 8 },
  selectionButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectCount: { flex: 1, fontSize: 14, fontWeight: '600' },
  searchWrap: { gap: 6 },
  boxWrap: { flex: 1, minWidth: 0 },
  searchField: {
    height: 44,
    borderRadius: iosDimensions.surfaceCornerRadius,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 4,
    gap: 10,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 17, padding: 0 },
  moreButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  searchPlaceholder: { flex: 1, fontSize: 17 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    gap: 12,
  },
  statusText: { fontSize: 13, flexShrink: 1 },
  resetButton: { minHeight: 44, justifyContent: 'center' },
});
