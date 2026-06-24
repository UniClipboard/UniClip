/**
 * 外观设置 section
 *
 * 主题色 / 外观模式来自 useTheme（主题切换本就触发全局重渲）；隐藏最近任务用选择器
 * 订阅 config.hideFromRecents。
 */
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Host, Switch as ComposeSwitch } from '@expo/ui/jetpack-compose';
import { Check } from 'react-native-feather';
import { useTheme } from '@/hooks/useTheme';
import { radius, PALETTES, type ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: '跟随系统', value: 'auto' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
];

export const AppearanceSection = memo(function AppearanceSection() {
  const { theme, themeMode, setThemeMode, paletteId, setPaletteId } = useTheme();
  const showMessage = useSettingsToast();
  const hideFromRecents = useSettingsStore((s) => s.config?.hideFromRecents ?? false);

  const handleSetPaletteId = async (id: (typeof PALETTES)[number]['id']) => {
    try {
      await setPaletteId(id);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '主题色切换失败', 'error');
    }
  };

  const handleSetThemeMode = async (mode: ThemeMode) => {
    try {
      await setThemeMode(mode);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '外观模式切换失败', 'error');
    }
  };

  const handleToggleHideFromRecents = async (enabled: boolean) => {
    try {
      if (Platform.OS === 'android') {
        const { setExcludeFromRecents } = await import('native-util');
        setExcludeFromRecents(enabled);
      }
      await useSettingsStore.getState().updateConfig({ hideFromRecents: enabled });
    } catch (error: unknown) {
      // 失败时 store 已回滚 config，开关回弹
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderBase}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>外观</Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
        ]}
      >
        {/* 主题色 (source color) */}
        <View
          style={[
            styles.appearanceBlock,
            {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.divider,
            },
          ]}
        >
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>主题色</Text>
          <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
            切换 source color,影响主色调与容器底色
          </Text>
          <View style={styles.swatchRow}>
            {PALETTES.map((p) => {
              const active = p.id === paletteId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => handleSetPaletteId(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`主题色 ${p.label}`}
                  accessibilityState={{ selected: active }}
                  style={styles.swatchWrap}
                >
                  <View
                    style={[styles.swatchRing, { borderColor: active ? p.swatch : 'transparent' }]}
                  >
                    <View style={[styles.swatch, { backgroundColor: p.swatch }]}>
                      {active && (
                        <Check stroke={theme.colors.white} width={16} height={16} strokeWidth={3} />
                      )}
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.swatchLabel,
                      {
                        color: active ? theme.colors.text : theme.colors.textTertiary,
                        fontWeight: active ? '600' : '400',
                      },
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 外观模式 — M3 segmented */}
        <View
          style={[
            styles.appearanceBlock,
            Platform.OS === 'android' && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.divider,
            },
          ]}
        >
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>外观模式</Text>
          <View style={[styles.segmentedTrack, { borderColor: theme.colors.outline }]}>
            {themeOptions.map((opt, i) => {
              const active = themeMode === opt.value;
              const isFirst = i === 0;
              const isLast = i === themeOptions.length - 1;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleSetThemeMode(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.segmentedItem,
                    {
                      backgroundColor: active ? theme.colors.primaryContainer : 'transparent',
                      borderLeftWidth: isFirst ? 0 : StyleSheet.hairlineWidth,
                      borderLeftColor: theme.colors.outline,
                    },
                    isFirst && {
                      borderTopLeftRadius: radius.pill,
                      borderBottomLeftRadius: radius.pill,
                    },
                    isLast && {
                      borderTopRightRadius: radius.pill,
                      borderBottomRightRadius: radius.pill,
                    },
                  ]}
                >
                  {active && (
                    <Check
                      stroke={theme.colors.onPrimaryContainer}
                      width={14}
                      height={14}
                      strokeWidth={3}
                      style={styles.segmentedCheck}
                    />
                  )}
                  <Text
                    style={[
                      styles.segmentedItemText,
                      { color: active ? theme.colors.onPrimaryContainer : theme.colors.text },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {Platform.OS === 'android' && (
          <View style={styles.settingRowNoBorder}>
            <View style={styles.settingInfo}>
              <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                在最近任务列表中隐藏
              </Text>
              <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                建议隐藏前先锁定，防止被一键清理
              </Text>
            </View>
            <Host matchContents>
              <ComposeSwitch
                value={hideFromRecents}
                onCheckedChange={handleToggleHideFromRecents}
                colors={{
                  checkedTrackColor: theme.colors.primary,
                  uncheckedTrackColor: theme.colors.divider,
                  checkedThumbColor: theme.colors.surface,
                  uncheckedThumbColor: theme.colors.textTertiary,
                }}
              />
            </Host>
          </View>
        )}
      </View>
    </View>
  );
});
