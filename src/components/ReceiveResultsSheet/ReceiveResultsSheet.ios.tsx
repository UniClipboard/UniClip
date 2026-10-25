import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, Square, SquareCheck } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { AppBottomSheet, AppButton } from '@/components/ui';
import { iosDimensions } from '@/theme/iosDesignTokens';
import type { ColorScheme } from '@/theme/colors.types';
import type { ReceiveResultsSheetProps } from './ReceiveResultsSheet.types';
import {
  useReceiveResultsController,
  type ReceiveEntryModel,
  type ReceiveItemRowModel,
  type ReceiveNoticeTone,
} from './useReceiveResultsController';

/**
 * iOS: grouped sheet listing each received item and its own result. The Home screen owns
 * this sheet; it must never be rendered inside an animated sub-page.
 */
export function ReceiveResultsSheet({ visible, onClose }: ReceiveResultsSheetProps) {
  const c = useReceiveResultsController(visible);
  const { theme } = useTheme();
  const colors = theme.colors;
  return (
    <AppBottomSheet visible={visible} onDismiss={onClose}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
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
    <View testID={`receive-entry-${entry.entryId}`} style={styles.entry}>
      <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>{entry.title}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {entry.summary} · {entry.bytesLabel}
      </Text>
      {entry.membersLabel ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry.membersLabel}</Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surfaceLow }]}>
        {entry.items.map((item, index) => (
          <ItemRow
            key={item.itemId}
            entryId={entry.entryId}
            item={item}
            colors={colors}
            separated={index > 0}
            onToggle={onToggle}
          />
        ))}
      </View>
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
  separated,
  onToggle,
}: {
  entryId: string;
  item: ReceiveItemRowModel;
  colors: ColorScheme;
  separated: boolean;
  onToggle: (entryId: string, itemId: string) => void;
}) {
  const Icon = item.selectable
    ? item.selected
      ? SquareCheck
      : Square
    : item.state === 'completed'
    ? CircleCheck
    : Circle;
  const iconColor = item.selectable
    ? item.selected
      ? colors.accent
      : colors.textSecondary
    : item.state === 'completed'
    ? colors.success
    : colors.textSecondary;
  const content = (
    <>
      <Icon size={22} color={iconColor} />
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
  const rowStyle = [
    styles.row,
    separated ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator } : null,
  ];
  // The whole row is the target: empty trailing space toggles the item as well.
  return item.selectable ? (
    <Pressable
      testID={`receive-item-${entryId}-${item.itemId}`}
      accessibilityRole="checkbox"
      accessibilityLabel={item.label}
      accessibilityState={{ checked: item.selected }}
      onPress={() => onToggle(entryId, item.itemId)}
      style={rowStyle}
    >
      {content}
    </Pressable>
  ) : (
    <View
      testID={`receive-item-${entryId}-${item.itemId}`}
      accessibilityLabel={`${item.label}, ${item.stateLabel}`}
      style={rowStyle}
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
  body: { paddingBottom: 8, maxHeight: 560 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  stale: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 16, paddingBottom: 8 },
  empty: { paddingVertical: 24, textAlign: 'center', fontSize: 15 },
  entry: { gap: 4 },
  entryTitle: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  group: { borderRadius: iosDimensions.surfaceCornerRadius, overflow: 'hidden', marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: iosDimensions.minTapTarget,
    paddingHorizontal: iosDimensions.cardInnerPadding,
    paddingVertical: 6,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15 },
  rowState: { fontSize: 12 },
  notice: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
