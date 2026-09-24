/**
 * 外观设置 section
 *
 * 外观模式只有三个短选项,用顶部整宽 M3 分段按钮一步切换;语言用整行下拉选择行,隐藏最近
 * 任务用 Switch(仅 Android),两者放在 grouped 分组里。颜色全部走 expo-ui / MaterialTheme
 * 默认,跟随系统深浅色。作为无 Host 的 item,由父级单 Host 统一组合。
 */
import React, { memo } from 'react';
import {
  Column,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Spacer,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  testID,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { type ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import {
  LANGUAGE_NATIVE_NAMES,
  type LanguagePreference,
  SUPPORTED_LANGUAGES,
} from '@/i18n/languages';
import { useSettingsToast } from '../SettingsToastContext';
import { SettingsSectionItem } from '../SettingsSectionItem';
import { SettingsSelectRow } from './SettingsSelectRow';
import { SettingsSwitchRow } from './SettingsSwitchRow';

export const AppearanceSection = memo(function AppearanceSection() {
  const { t } = useTranslation('settings');
  const { themeMode, setThemeMode } = useTheme();
  const { preference: languagePref, setLanguage } = useAppLanguage();
  const showMessage = useSettingsToast();
  const hideFromRecents = useSettingsStore((s) => s.config?.hideFromRecents ?? false);

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t('appearance.mode.system'), value: 'auto' },
    { label: t('appearance.mode.light'), value: 'light' },
    { label: t('appearance.mode.dark'), value: 'dark' },
  ];

  const languageOptions: { label: string; value: LanguagePreference }[] = [
    { label: t('language.system', { ns: 'common' }), value: 'system' },
    ...SUPPORTED_LANGUAGES.map((code) => ({
      label: LANGUAGE_NATIVE_NAMES[code],
      value: code as LanguagePreference,
    })),
  ];

  const handleSetThemeMode = async (mode: ThemeMode) => {
    try {
      await setThemeMode(mode);
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('appearance.modeChangeFailed'),
        'error'
      );
    }
  };

  const handleSetLanguage = async (pref: LanguagePreference) => {
    try {
      await setLanguage(pref);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('appearance.updateFailed'), 'error');
    }
  };

  const handleToggleHideFromRecents = async (enabled: boolean) => {
    try {
      const { setExcludeFromRecents } = await import('android-util');
      setExcludeFromRecents(enabled);
      await useSettingsStore.getState().updateConfig({ hideFromRecents: enabled });
    } catch (error: unknown) {
      // 失败时 store 已回滚 config，开关回弹
      showMessage(error instanceof Error ? error.message : t('appearance.updateFailed'), 'error');
    }
  };

  return (
    <Column modifiers={[fillMaxWidth()]}>
      <SettingsSectionItem variant="plain" title={t('appearance.mode.label')}>
        <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
          {themeOptions.map((option) => (
            <SegmentedButton
              key={option.value}
              selected={themeMode === option.value}
              onClick={() => {
                if (themeMode !== option.value) void handleSetThemeMode(option.value);
              }}
              modifiers={[testID(`appearance-mode-${option.value}`)]}
            >
              <SegmentedButton.Label>
                <ComposeText maxLines={1}>{option.label}</ComposeText>
              </SegmentedButton.Label>
            </SegmentedButton>
          ))}
        </SingleChoiceSegmentedButtonRow>
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem variant="grouped" title={t('appearance.displayTitle')}>
        <SettingsSelectRow
          key="language"
          title={t('language.title', { ns: 'common' })}
          options={languageOptions}
          selectedValue={languagePref}
          onSelect={(value) => void handleSetLanguage(value)}
        />
        <SettingsSwitchRow
          key="hideFromRecents"
          title={t('appearance.hideFromRecents.title')}
          description={t('appearance.hideFromRecents.desc')}
          value={hideFromRecents}
          onValueChange={(enabled) => void handleToggleHideFromRecents(enabled)}
        />
      </SettingsSectionItem>
    </Column>
  );
});
