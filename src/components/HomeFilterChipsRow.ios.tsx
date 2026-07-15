import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  File,
  FileText,
  Folder,
  Image as ImageIcon,
  Link,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Button as SwiftUIButton,
  Host,
  HStack,
  Image,
  Menu,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  frame,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { iosAccent, iosOnAccent, iosSystemHex } from '@/theme/iosDesignTokens';
import { getDisplayKindLabel, type DisplayKind } from '@/utils/displayKind';
import {
  getHistoryDateFilterLabel,
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { FILTER_CHIP_ROW_HEIGHT, type HomeFilterChipsRowProps } from './HomeFilterChipsRow.types';

/**
 * 首页默认态顶栏下方的筛选 chip 行(胶囊药丸,「选中即填充」):类型平铺可横滑、
 * 单选即时生效(点已选类型回到「全部」);时间收进尾部固定的 SwiftUI Menu chip,
 * 菜单由系统呈现。状态与搜索态弹层、平板 FilterRail 是同一份。
 */

const KIND_ICONS: Record<DisplayKind, LucideIcon> = {
  text: FileText,
  url: Link,
  image: ImageIcon,
  file: File,
  group: Folder,
};

const CHIP_HEIGHT = 34;

export function HomeFilterChipsRow({
  selectedKinds,
  selectedDate,
  onToggleKind,
  onClearKinds,
  onSelectDate,
  theme,
}: HomeFilterChipsRowProps) {
  const { t } = useTranslation('history');
  const isDark = useColorScheme() === 'dark';
  const dateActive = selectedDate !== 'all';

  // SwiftUI 侧的 modifier 只吃 hex,不吃 PlatformColor,按明暗手动解析
  const mode = isDark ? 'dark' : 'light';
  const menuChipBg = dateActive
    ? iosAccent[isDark ? 'dark' : 'light']
    : iosSystemHex.secondaryGroupedBackground[mode];
  const menuChipFg = dateActive ? iosOnAccent[mode] : iosSystemHex.secondaryLabel[mode];

  // 滚动区右缘的渐隐过渡:让类型 chip 滑向时间 chip 时淡出,弱化两区边界。
  // 渐变吃不了 PlatformColor,用 systemGroupedBackground 的明暗 hex 近似。
  const fadeSolid = iosSystemHex.groupedBackground[mode];
  const fadeBg = `linear-gradient(to right, ${fadeSolid}00, ${fadeSolid})`;

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
              icon={KIND_ICONS[kind]}
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
        <Host matchContents style={styles.menuHost}>
          <Menu
            label={
              <HStack
                spacing={5}
                modifiers={[
                  padding({ horizontal: 13 }),
                  frame({ height: CHIP_HEIGHT }),
                  background(menuChipBg, shapes.capsule()),
                ]}
              >
                <Image systemName="clock" size={13} color={menuChipFg} />
                <SwiftUIText
                  modifiers={[
                    font({ size: 14, weight: dateActive ? 'semibold' : 'medium' }),
                    foregroundStyle(menuChipFg),
                  ]}
                >
                  {dateActive ? getHistoryDateFilterLabel(selectedDate) : t('filter.chip.date')}
                </SwiftUIText>
                <Image systemName="chevron.down" size={10} color={menuChipFg} />
              </HStack>
            }
          >
            {getHistoryFilterDateOptions().map((option) => (
              <SwiftUIButton
                key={option.value}
                label={option.label}
                systemImage={selectedDate === option.value ? 'checkmark' : undefined}
                onPress={() => onSelectDate(option.value)}
              />
            ))}
          </Menu>
        </Host>
      </View>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: HomeFilterChipsRowProps['theme'];
  icon?: LucideIcon;
}

function Chip({ label, selected, onPress, theme, icon: Icon }: ChipProps) {
  const { colors } = theme;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: colors.accent, borderColor: 'transparent' }
          : { backgroundColor: colors.surfaceLow, borderColor: colors.separator },
      ]}
    >
      {Icon && <Icon size={14} color={selected ? colors.surfaceLowest : colors.textSecondary} />}
      <Text
        style={[
          styles.chipLabel,
          selected
            ? { color: colors.surfaceLowest, fontWeight: '600' }
            : { color: colors.textPrimary },
        ]}
      >
        {label}
      </Text>
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
  menuHost: {
    height: CHIP_HEIGHT,
  },
  chip: {
    height: CHIP_HEIGHT,
    borderRadius: CHIP_HEIGHT / 2,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});
