import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/hooks/useTheme';
import { AppBottomSheet, AppButton } from '@/components/ui';
import { m3Type } from '@/theme/m3Typography';
import type { ColorScheme } from '@/theme/colors.types';
import type { ReceiveResultsSheetProps } from './ReceiveResultsSheet.types';
import {
  useReceiveResultsController,
  type ReceiveEntryModel,
  type ReceiveItemRowModel,
  type ReceiveNoticeTone,
} from './useReceiveResultsController';
import { useTranslation } from 'react-i18next';

/** Android: M3 bottom sheet listing each received item and its own result. */
export function ReceiveResultsSheet({ visible, onClose }: ReceiveResultsSheetProps) {
  const c = useReceiveResultsController(visible);
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <AppBottomSheet visible={visible} onDismiss={onClose}>
      <View style={styles.body}>
        <Text style={[styles.title, m3Type.titleLarge, { color: colors.textPrimary }]}>
          {c.title}
        </Text>
        {c.staleLabel ? (
          <Text style={[styles.stale, { color: colors.warning }]}>{c.staleLabel}</Text>
        ) : null}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {c.entries.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>{c.emptyLabel}</Text>
          ) : (
            c.entries.map((entry) => (
              <EntrySection
                key={entry.entryId}
                entry={entry}
                colors={colors}
                onToggle={c.toggleItem}
                onRetry={c.retry}
                onCancel={c.cancel}
              />
            ))
          )}
        </ScrollView>
      </View>
    </AppBottomSheet>
  );
}

function EntrySection({
  entry,
  colors,
  onToggle,
  onRetry,
  onCancel,
}: {
  entry: ReceiveEntryModel;
  colors: ColorScheme;
  onToggle: (entryId: string, itemId: string) => void;
  onRetry: (entryId: string) => void;
  onCancel: (entryId: string) => void;
}) {
  const { t } = useTranslation('home');
  return (
    <View
      testID={`receive-entry-${entry.entryId}`}
      style={[styles.entry, { backgroundColor: colors.surfaceLow }]}
    >
      <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{entry.title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {entry.summary} · {entry.bytesLabel}
      </Text>
      {entry.membersLabel ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry.membersLabel}</Text>
      ) : null}
      {entry.items.map((item) => (
        <ItemRow key={item.itemId} entryId={entry.entryId} item={item} colors={colors} onToggle={onToggle} />
      ))}
      {entry.notice ? (
        <Text style={[styles.notice, { color: noticeColor(entry.notice.tone, colors) }]}>
          {entry.notice.text}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {entry.canCancel ? (
          <AppButton
            testID={`receive-cancel-${entry.entryId}`}
            title={t('receive.action.cancel')}
            variant="outlined"
            onPress={() => onCancel(entry.entryId)}
          />
        ) : null}
        {entry.items.some((item) => item.selectable) ? (
          <AppButton
            testID={`receive-retry-${entry.entryId}`}
            title={t('receive.action.retrySelected', { count: entry.selectedCount })}
            variant="filled"
            disabled={!entry.canRetry}
            onPress={() => onRetry(entry.entryId)}
          />
        ) : null}
      </View>
    </View>
  );
}

function ItemRow({
  entryId,
  item,
  colors,
  onToggle,
}: {
  entryId: string;
  item: ReceiveItemRowModel;
  colors: ColorScheme;
  onToggle: (entryId: string, itemId: string) => void;
}) {
  const content = (
    <>
      {item.selectable ? (
        <Ionicons
          name={item.selected ? 'checkbox' : 'square-outline'}
          size={24}
          color={item.selected ? colors.accent : colors.textSecondary}
        />
      ) : (
        <Ionicons
          name={item.state === 'completed' ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={item.state === 'completed' ? colors.success : colors.textSecondary}
        />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.label}
        </Text>
        <Text
          style={[
            styles.rowState,
            { color: item.state === 'failed' ? colors.error : colors.textSecondary },
          ]}
        >
          {item.reasonLabel ? `${item.stateLabel} · ${item.reasonLabel}` : item.stateLabel}
        </Text>
      </View>
    </>
  );
  // The whole row is the target: empty trailing space toggles the item as well.
  return item.selectable ? (
    <Pressable
      testID={`receive-item-${entryId}-${item.itemId}`}
      accessibilityRole="checkbox"
      accessibilityLabel={item.label}
      accessibilityState={{ checked: item.selected }}
      android_ripple={{ color: colors.fillSecondary as string }}
      onPress={() => onToggle(entryId, item.itemId)}
      style={styles.row}
    >
      {content}
    </Pressable>
  ) : (
    <View
      testID={`receive-item-${entryId}-${item.itemId}`}
      accessibilityLabel={`${item.label}, ${item.stateLabel}`}
      style={styles.row}
    >
      {content}
    </View>
  );
}

function noticeColor(tone: ReceiveNoticeTone, colors: ColorScheme) {
  switch (tone) {
    case 'error':
      return colors.error;
    case 'warning':
      return colors.warning;
    case 'success':
      return colors.success;
    default:
      return colors.textSecondary;
  }
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, maxHeight: 560 },
  title: { marginBottom: 8 },
  stale: { fontSize: 12, marginBottom: 8 },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 12, paddingBottom: 8 },
  empty: { paddingVertical: 24, textAlign: 'center', fontSize: 14 },
  entry: { borderRadius: 16, padding: 12, gap: 4 },
  entryTitle: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 4 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14 },
  rowState: { fontSize: 12 },
  notice: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
