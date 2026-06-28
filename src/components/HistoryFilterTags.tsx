import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { useTheme } from '@/hooks/useTheme';
import { DisplayKind, getDisplayKindLabel } from '@/utils/displayKind';
import { HistoryDateFilter } from '@/utils/historyFilters';
import { getHistoryDateFilterLabel } from '@/utils/historyFilterOptions';

interface HistoryFilterTagsProps {
  selectedKinds: DisplayKind[];
  selectedDate: HistoryDateFilter;
  onRemoveKind: (kind: DisplayKind) => void;
  onClearDateFilter: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export function HistoryFilterTags({
  selectedKinds,
  selectedDate,
  onRemoveKind,
  onClearDateFilter,
  theme,
}: HistoryFilterTagsProps) {
  const hasTags = selectedKinds.length > 0 || selectedDate !== 'all';
  if (!hasTags) return null;

  return (
    <View style={styles.container}>
      {selectedKinds.map((kind) => (
        <FilterTag
          key={kind}
          label={getDisplayKindLabel(kind)}
          onPress={() => onRemoveKind(kind)}
          theme={theme}
        />
      ))}
      {selectedDate !== 'all' && (
        <FilterTag
          label={getHistoryDateFilterLabel(selectedDate)}
          onPress={onClearDateFilter}
          theme={theme}
        />
      )}
    </View>
  );
}

interface FilterTagProps {
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

function FilterTag({ label, onPress, theme }: FilterTagProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tag, { backgroundColor: theme.colors.primaryContainer }]}
    >
      <Text style={[styles.tagText, { color: theme.colors.onPrimaryContainer }]}>{label}</Text>
      <Ionicons name="close" size={12} color={theme.colors.onPrimaryContainer} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 2,
  },
  tag: {
    minHeight: 32,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 4,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
