import React, { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { getDisplayKindLabel } from '@/utils/displayKind';
import {
  getHistoryDateFilterLabel,
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { elevation, radius, spacing } from '@/theme';
import { FILTER_CHIP_ROW_HEIGHT, type HomeFilterChipsRowProps } from './HomeFilterChipsRow.types';

/**
 * 首页默认态顶栏下方的筛选 chip 行(M3 FilterChip):类型平铺可横滑、单选即时生效
 * (点已选类型回到「全部」);时间收进尾部固定的下拉 chip。状态与搜索态弹层、
 * 平板 FilterRail 是同一份。
 */
export function HomeFilterChipsRow({
  selectedKinds,
  selectedDate,
  onToggleKind,
  onClearKinds,
  onSelectDate,
  theme,
}: HomeFilterChipsRowProps) {
  const { t } = useTranslation('history');
  const { colors } = theme;
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTop, setMenuTop] = useState(0);
  const dateChipRef = useRef<View>(null);

  const openDateMenu = useCallback(() => {
    dateChipRef.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
      setMenuTop(pageY + h + 4);
      setMenuVisible(true);
    });
  }, []);

  const dateActive = selectedDate !== 'all';

  // 滚动区右缘的渐隐过渡:让类型 chip 滑向时间 chip 时淡出,弱化两区边界。
  // background 是 6 位 hex,追加 00 得到同色全透明端。
  const fadeBg = `linear-gradient(to right, ${String(colors.background)}00, ${String(colors.background)})`;

  return (
    <View style={styles.row}>
      <View style={styles.scrollWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Chip
            label={t('filter.chip.all')}
            selected={selectedKinds.length === 0}
            onPress={onClearKinds}
            theme={theme}
          />
          {HISTORY_FILTER_KIND_OPTIONS.map((kind) => (
            <Chip
              key={kind}
              label={getDisplayKindLabel(kind)}
              selected={selectedKinds.includes(kind)}
              onPress={() => onToggleKind(kind)}
              theme={theme}
            />
          ))}
        </ScrollView>
        <View
          pointerEvents="none"
          style={[styles.fade, { experimental_backgroundImage: fadeBg }]}
        />
      </View>

      <View ref={dateChipRef} collapsable={false} style={styles.tail}>
        <Chip
          label={dateActive ? getHistoryDateFilterLabel(selectedDate) : t('filter.chip.date')}
          selected={dateActive}
          onPress={openDateMenu}
          trailing={
            <Ionicons
              name="chevron-down"
              size={13}
              color={dateActive ? colors.onAccentContainer : colors.textSecondary}
            />
          }
          theme={theme}
        />
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="none"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <View style={[styles.menu, { backgroundColor: colors.surfaceHigh, top: menuTop }]}>
            {getHistoryFilterDateOptions().map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  onSelectDate(option.value);
                  setMenuVisible(false);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && { backgroundColor: colors.surfaceHighest },
                ]}
              >
                <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                  {option.label}
                </Text>
                {selectedDate === option.value && (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: HomeFilterChipsRowProps['theme'];
  trailing?: React.ReactNode;
}

function Chip({ label, selected, onPress, theme, trailing }: ChipProps) {
  const { colors } = theme;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: colors.accentContainer, borderColor: 'transparent' }
          : { backgroundColor: 'transparent', borderColor: colors.separator },
      ]}
    >
      {selected && <Ionicons name="checkmark" size={14} color={colors.onAccentContainer} />}
      <Text
        style={[
          styles.chipLabel,
          { color: selected ? colors.onAccentContainer : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: FILTER_CHIP_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scrollWrap: {
    flex: 1,
  },
  scrollContent: {
    gap: 8,
    paddingLeft: 16,
    paddingRight: 28,
    alignItems: 'center',
  },
  fade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
  },
  tail: {
    paddingRight: 16,
  },
  chip: {
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  menuOverlay: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    right: spacing.md,
    minWidth: 168,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: spacing.xs,
    ...elevation.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 44,
    paddingHorizontal: spacing.base,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
