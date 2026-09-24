import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { getDisplayKindLabel } from '@/utils/displayKind';
import {
  getHistoryDateFilterLabel,
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { m3Type } from '@/theme/m3Typography';
import { OverflowMenu } from './android/OverflowMenu';
import { FILTER_CHIP_ROW_HEIGHT, type HomeFilterChipsRowProps } from './HomeFilterChipsRow.types';

/**
 * 首页唯一的筛选入口(M3 chip 行),默认态与搜索态共用同一份状态:
 * - 类型:单选,平铺可横滑;选中只换填充色、不加对勾,切换时 chip 宽度不变、整行不抖动。
 *   点已选类型回到「全部」。
 * - 时间:尾部固定 chip,显示当前值;点开是 M3 菜单,生效时尾部 × 一键清除。
 */
export function HomeFilterChipsRow({
  selectedKinds,
  selectedDate,
  onToggleKind,
  onClearKinds,
  onSelectDate,
  surfaceColor,
  theme,
}: HomeFilterChipsRowProps) {
  const { t } = useTranslation('history');
  const { colors } = theme;
  const dateActive = selectedDate !== 'all';

  // 滚动区右缘的渐隐过渡:让类型 chip 滑向时间 chip 时淡出,弱化两区边界。
  // 底色是 6 位 hex,追加 00 得到同色全透明端;须与行所在表面同色,否则留下色带。
  const fadeColor = surfaceColor ?? String(colors.background);
  const fadeBg = `linear-gradient(to right, ${fadeColor}00, ${fadeColor})`;

  const dateItems = getHistoryFilterDateOptions().map((option) => ({
    key: option.value,
    label: option.label,
    selected: selectedDate === option.value,
    onPress: () => onSelectDate(option.value),
  }));

  return (
    <View style={styles.row}>
      <View style={styles.scrollWrap} accessibilityRole="radiogroup">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Chip
            testID="history-filter-all"
            label={t('filter.chip.all')}
            selected={selectedKinds.length === 0}
            onPress={onClearKinds}
            theme={theme}
          />
          {HISTORY_FILTER_KIND_OPTIONS.map((kind) => (
            <Chip
              key={kind}
              testID={`history-filter-${kind}`}
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

      <View style={styles.tail}>
        <OverflowMenu
          items={dateItems}
          renderTrigger={(open) => (
            <Chip
              testID="history-filter-date"
              role="button"
              label={dateActive ? getHistoryDateFilterLabel(selectedDate) : t('filter.chip.date')}
              selected={dateActive}
              onPress={open}
              trailing={
                dateActive ? (
                  <Pressable
                    testID="history-filter-date-clear"
                    onPress={() => onSelectDate('all')}
                    hitSlop={{ top: 12, bottom: 12, left: 6, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('search.anyTime', { ns: 'home' })}
                  >
                    <Ionicons name="close" size={16} color={colors.onAccentContainer} />
                  </Pressable>
                ) : (
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                )
              }
              theme={theme}
            />
          )}
        />
      </View>
    </View>
  );
}

interface ChipProps {
  testID?: string;
  /** 类型 chip 是单选组成员(radio);时间 chip 打开菜单(button) */
  role?: 'radio' | 'button';
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: HomeFilterChipsRowProps['theme'];
  trailing?: React.ReactNode;
}

function Chip({ testID, role = 'radio', label, selected, onPress, theme, trailing }: ChipProps) {
  const { colors } = theme;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      // M3 chip 视觉高 32dp,上下 hitSlop 补足 48dp 触控目标
      hitSlop={{ top: 8, bottom: 8 }}
      android_ripple={{ color: colors.fillSecondary as string }}
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      style={[
        styles.chip,
        trailing ? styles.chipWithTrailing : null,
        selected
          ? { backgroundColor: colors.accentContainer, borderColor: colors.accentContainer }
          : { backgroundColor: 'transparent', borderColor: colors.separator },
      ]}
    >
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
    gap: 8,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  chipWithTrailing: {
    paddingRight: 8,
  },
  chipLabel: {
    ...m3Type.labelLarge,
  },
});
