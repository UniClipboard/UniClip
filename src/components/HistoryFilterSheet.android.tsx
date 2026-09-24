import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { HistoryFilterSheetProps } from './HistoryFilterSheet.types';
import { getDisplayKindIcon, getDisplayKindLabel } from '@/utils/displayKind';
import {
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { AppBottomSheet, AppButton, AppHost, AppRow } from '@/components/ui';
import { MATERIAL_SEED_COLOR } from '@/theme/colors';
import { m3Type } from '@/theme/m3Typography';

/**
 * 搜索筛选(Android):复用 AppBottomSheet(可下拉关闭),类型为多选复选行、时间为单选行,
 * 筛选即时生效;底部操作条放「重置」(text)与「完成」(filled),不在标题栏放 iOS 式文字按钮。
 */
export function HistoryFilterSheet({
  visible,
  selectedKinds,
  selectedDate,
  onToggleKind,
  onSelectDate,
  onClear,
  onClose,
  theme,
}: HistoryFilterSheetProps) {
  const { t } = useTranslation('history');
  const { colors } = theme;
  return (
    <AppBottomSheet visible={visible} onDismiss={onClose} containerColor={colors.surfaceLow}>
      <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
        {t('filter.title')}
      </Text>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <FilterSection title={t('filter.section.kind')} theme={theme}>
          {HISTORY_FILTER_KIND_OPTIONS.map((kind) => (
            <FilterRow
              key={kind}
              testID={`history-filter-sheet-${kind}`}
              kind="checkbox"
              label={getDisplayKindLabel(kind)}
              icon={getDisplayKindIcon(kind)}
              selected={selectedKinds.includes(kind)}
              onPress={() => onToggleKind(kind)}
              theme={theme}
            />
          ))}
        </FilterSection>

        <FilterSection title={t('filter.section.date')} theme={theme}>
          {getHistoryFilterDateOptions().map((option) => (
            <FilterRow
              key={option.value}
              kind="radio"
              label={option.label}
              selected={selectedDate === option.value}
              onPress={() => onSelectDate(option.value)}
              theme={theme}
            />
          ))}
        </FilterSection>
      </ScrollView>

      <AppHost
        matchContents={{ vertical: true }}
        style={styles.actionsHost}
        colorScheme={theme.isDark ? 'dark' : 'light'}
        seedColor={MATERIAL_SEED_COLOR}
      >
        <AppRow fullWidth justify="end" spacing={8} padding={16}>
          <AppButton
            testID="history-filter-reset"
            title={t('action.reset', { ns: 'common' })}
            onPress={onClear}
            variant="text"
          />
          <AppButton
            testID="history-filter-done"
            title={t('action.done', { ns: 'common' })}
            onPress={onClose}
          />
        </AppRow>
      </AppHost>
    </AppBottomSheet>
  );
}

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  theme: HistoryFilterSheetProps['theme'];
}

function FilterSection({ title, children, theme }: FilterSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

interface FilterRowProps {
  testID?: string;
  kind: 'checkbox' | 'radio';
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: HistoryFilterSheetProps['theme'];
  icon?: string;
}

/** 整行可点的 M3 选择行:前导类型图标、正文标签、尾部复选框 / 单选钮。 */
function FilterRow({ testID, kind, label, selected, onPress, theme, icon }: FilterRowProps) {
  const { colors } = theme;
  const control =
    kind === 'checkbox'
      ? selected
        ? 'checkbox'
        : 'square-outline'
      : selected
      ? 'radio-button-on'
      : 'radio-button-off';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={kind}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      android_ripple={{ color: colors.fillSecondary as string }}
      style={styles.row}
    >
      {icon ? <Ionicons name={icon as never} size={24} color={colors.textSecondary} /> : null}
      <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Ionicons name={control} size={24} color={selected ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    ...m3Type.titleLarge,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  section: {
    paddingBottom: 8,
  },
  sectionTitle: {
    ...m3Type.titleSmall,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  rowLabel: {
    ...m3Type.bodyLarge,
    flex: 1,
  },
  actionsHost: { width: '100%' },
});
