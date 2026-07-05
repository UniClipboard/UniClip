/**
 * 外观设置 section
 *
 * 外观模式 / 语言用 M3 SingleChoiceSegmentedButtonRow;隐藏最近任务用 Switch(仅 Android)。
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
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

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
      if (Platform.OS === 'android') {
        const { setExcludeFromRecents } = await import('native-util');
        setExcludeFromRecents(enabled);
      }
      await useSettingsStore.getState().updateConfig({ hideFromRecents: enabled });
    } catch (error: unknown) {
      // 失败时 store 已回滚 config，开关回弹
      showMessage(error instanceof Error ? error.message : t('appearance.updateFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem title={t('appearance.sectionTitle')}>
      {/* 外观模式 — M3 segmented */}
      <Column modifiers={[fillMaxWidth(), padding(16, 12, 16, 12)]}>
        <ComposeText style={{ fontSize: 15, fontWeight: '500' }}>
          {t('appearance.mode.label')}
        </ComposeText>
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

      <HorizontalDivider />

      {/* 语言 — M3 segmented */}
      <Column modifiers={[fillMaxWidth(), padding(16, 12, 16, 12)]}>
        <ComposeText style={{ fontSize: 15, fontWeight: '500' }}>
          {t('language.title', { ns: 'common' })}
        </ComposeText>
        <Spacer modifiers={[heightModifier(12)]} />
        <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
          {languageOptions.map((opt) => (
            <SegmentedButton
              key={opt.value}
              selected={languagePref === opt.value}
              onClick={() => handleSetLanguage(opt.value)}
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
              <ComposeText>{t('appearance.hideFromRecents.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('appearance.hideFromRecents.desc')}</ComposeText>
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
