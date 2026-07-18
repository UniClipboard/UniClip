/**
 * 外观设置 section
 *
 * 外观模式 / 语言用紧凑下拉菜单;隐藏最近任务用 Switch(仅 Android)。
 * 颜色全部走 expo-ui / MaterialTheme 默认,跟随系统深浅色。作为无 Host 的 item,
 * 由父级单 Host 统一组合。
 */
import React, { memo } from 'react';
import { Platform } from 'react-native';
import {
  ListItem,
  Switch as ComposeSwitch,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { useTranslation } from 'react-i18next';
import { AppDropdown } from '@/components/ui';
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
        const { setExcludeFromRecents } = await import('android-util');
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
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('appearance.mode.label')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <AppDropdown
            options={themeOptions}
            selectedValue={themeMode}
            onSelect={(value) => void handleSetThemeMode(value)}
            width={180}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      {/* 语言 — 紧凑设置行,避免选项横向挤压或输入框独占整行 */}
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('language.title', { ns: 'common' })}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <AppDropdown
            options={languageOptions}
            selectedValue={languagePref}
            onSelect={(value) => void handleSetLanguage(value)}
            width={180}
          />
        </ListItem.TrailingContent>
      </ListItem>

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
