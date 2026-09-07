import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  Keyboard,
  Text as RNText,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react-native';
import { Button as SwiftUIButton, Host, HStack, Image, Menu, Text } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers';
import { iosAccent, iosSystemHex } from '@/theme/iosDesignTokens';
import { getDisplayKindLabel } from '@/utils/displayKind';
import {
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { FILTER_CHIP_ROW_HEIGHT, type HomeFilterChipsRowProps } from './HomeFilterChipsRow.types';

export function HomeFilterChipsRow({
  selectedKinds,
  selectedDate,
  resultCount,
  isLoading,
  onResetSearch,
  onToggleKind,
  onClearKinds,
  onSelectDate,
  theme,
}: HomeFilterChipsRowProps) {
  const { t } = useTranslation('home');
  const selectedKind = selectedKinds[0] ?? 'all';
  const hasFilters = selectedKinds.length > 0 || selectedDate !== 'all';

  return (
    <View style={styles.row}>
      <FilterMenu
        id="kind"
        icon="line.3.horizontal.decrease"
        value={selectedKind}
        options={[
          { value: 'all', label: t('search.allTypes') },
          ...HISTORY_FILTER_KIND_OPTIONS.map((kind) => ({
            value: kind,
            label: getDisplayKindLabel(kind),
          })),
        ]}
        onSelect={(kind) => {
          Keyboard.dismiss();
          if (kind === 'all') onClearKinds();
          else if (kind !== selectedKind) onToggleKind(kind);
        }}
        theme={theme}
      />
      <FilterMenu
        id="date"
        icon="calendar"
        value={selectedDate}
        options={getHistoryFilterDateOptions().map((option) => ({
          ...option,
          label: option.value === 'all' ? t('search.anyTime') : option.label,
        }))}
        onSelect={(date) => {
          Keyboard.dismiss();
          onSelectDate(date);
        }}
        theme={theme}
      />
      <View style={styles.resetSlot}>
        {resultCount !== undefined ? (
          isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          ) : (
            <RNText
              testID="history-result-count"
              numberOfLines={1}
              accessibilityLiveRegion="polite"
              style={[styles.resultCount, { color: theme.colors.textSecondary }]}
            >
              {t('search.resultCount', { count: resultCount })}
            </RNText>
          )
        ) : null}
        {hasFilters || onResetSearch ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(onResetSearch ? 'search.reset' : 'search.clearFilters')}
            onPress={() => {
              if (onResetSearch) {
                onResetSearch();
                return;
              }
              onClearKinds();
              onSelectDate('all');
            }}
            style={styles.resetButton}
          >
            <RotateCcw size={18} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function FilterMenu<T extends string>({
  id,
  icon,
  value,
  options,
  onSelect,
  theme,
}: {
  id: string;
  icon: React.ComponentProps<typeof Image>['systemName'];
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  theme: HomeFilterChipsRowProps['theme'];
}) {
  const active = value !== 'all';
  const mode = theme.isDark ? 'dark' : 'light';
  const foreground = active ? iosAccent[mode] : iosSystemHex.secondaryLabel[mode];
  const label = options.find((option) => option.value === value)?.label ?? options[0].label;

  return (
    <Host matchContents style={styles.menuHost}>
      <Menu
        label={
          <HStack spacing={6} modifiers={[frame({ height: 44 }), padding({ horizontal: 4 })]}>
            <Image systemName={icon} size={14} color={foreground} />
            <Text
              modifiers={[
                font({ size: 14, weight: active ? 'semibold' : 'regular' }),
                foregroundStyle(foreground),
              ]}
            >
              {label}
            </Text>
            <Image systemName="chevron.down" size={10} color={foreground} />
          </HStack>
        }
      >
        {options.map((option) => (
          <SwiftUIButton
            key={option.value}
            testID={`history-${id}-${option.value}`}
            label={option.label}
            systemImage={value === option.value ? 'checkmark' : undefined}
            onPress={() => onSelect(option.value)}
          />
        ))}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  row: {
    height: FILTER_CHIP_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
  },
  menuHost: { height: 44, flexShrink: 1 },
  resetSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  resultCount: { fontSize: 12, flexShrink: 1, textAlign: 'right' },
  resetButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
});
