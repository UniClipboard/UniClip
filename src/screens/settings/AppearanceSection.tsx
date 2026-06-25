/**
 * 外观设置 section
 *
 * 外观模式用 M3 SingleChoiceSegmentedButtonRow;隐藏最近任务用 Switch(仅 Android)。
 * 颜色全部走 expo-ui / MaterialTheme 默认,跟随系统深浅色。作为无 Host 的 item,
 * 由父级单 Host 统一组合。
 */
import React, { memo } from 'react';
import { Platform } from 'react-native';
import {
  Column,
  ListItem,
  Switch as ComposeSwitch,
  HorizontalDivider,
  SingleChoiceSegmentedButtonRow,
  SegmentedButton,
  Text as ComposeText,
  Spacer,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  padding,
  height as heightModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import { type ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: '跟随系统', value: 'auto' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
];

export const AppearanceSection = memo(function AppearanceSection() {
  const { themeMode, setThemeMode } = useTheme();
  const showMessage = useSettingsToast();
  const hideFromRecents = useSettingsStore((s) => s.config?.hideFromRecents ?? false);

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
    <SettingsSectionItem title="外观">
      {/* 外观模式 — M3 segmented */}
      <Column modifiers={[fillMaxWidth(), padding(16, 12, 16, 12)]}>
        <ComposeText style={{ fontSize: 15, fontWeight: '500' }}>外观模式</ComposeText>
        <Spacer modifiers={[heightModifier(12)]} />
        <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
          {themeOptions.map((opt) => (
            <SegmentedButton
              key={opt.value}
              selected={themeMode === opt.value}
              onClick={() => handleSetThemeMode(opt.value)}
            >
              <SegmentedButton.Label>
                <ComposeText>{opt.label}</ComposeText>
              </SegmentedButton.Label>
            </SegmentedButton>
          ))}
        </SingleChoiceSegmentedButtonRow>
      </Column>

      {Platform.OS === 'android' && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>在最近任务列表中隐藏</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>建议隐藏前先锁定，防止被一键清理</ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <ComposeSwitch
                value={hideFromRecents}
                onCheckedChange={handleToggleHideFromRecents}
              />
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}
    </SettingsSectionItem>
  );
});
