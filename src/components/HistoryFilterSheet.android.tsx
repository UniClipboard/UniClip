import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { HistoryFilterSheetProps } from './HistoryFilterSheet.types';
import { getDisplayKindColor, getDisplayKindIcon, getDisplayKindLabel } from '@/utils/displayKind';
import {
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { radius, spacing } from '@/theme';

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
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.backdrop }]}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.separator,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: theme.colors.separator }]} />

        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            {t('filter.title')}
          </Text>
          <View style={styles.headerActions}>
            <Pressable onPress={onClear} style={styles.headerButton}>
              <Text style={[styles.headerButtonText, { color: theme.colors.accent }]}>
                {t('action.reset', { ns: 'common' })}
              </Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.doneButton}>
              <Ionicons name="checkmark" size={20} color={theme.colors.accent} />
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FilterSection title={t('filter.section.kind')} theme={theme}>
            {HISTORY_FILTER_KIND_OPTIONS.map((kind) => {
              const selected = selectedKinds.includes(kind);
              return (
                <FilterRow
                  key={kind}
                  label={getDisplayKindLabel(kind)}
                  icon={getDisplayKindIcon(kind)}
                  iconColor={getDisplayKindColor(kind)}
                  selected={selected}
                  onPress={() => onToggleKind(kind)}
                  theme={theme}
                />
              );
            })}
          </FilterSection>

          <FilterSection title={t('filter.section.date')} theme={theme}>
            {getHistoryFilterDateOptions().map((option) => (
              <FilterRow
                key={option.value}
                label={option.label}
                selected={selectedDate === option.value}
                onPress={() => onSelectDate(option.value)}
                theme={theme}
              />
            ))}
          </FilterSection>
        </ScrollView>
      </View>
    </Modal>
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
      <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceLow }]}>
        {children}
      </View>
    </View>
  );
}

interface FilterRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: HistoryFilterSheetProps['theme'];
  icon?: string;
  iconColor?: string;
}

function FilterRow({ label, selected, onPress, theme, icon, iconColor }: FilterRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.colors.surfaceHigh },
      ]}
    >
      {icon ? <Ionicons name={icon as never} size={20} color={iconColor} /> : null}
      <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={20} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '72%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  headerButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  doneButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
});
