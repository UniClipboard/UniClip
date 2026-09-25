/**
 * 设置中枢「通用」分组里的外观行(Android):主题 / 语言 / 隐藏最近任务。
 *
 * 原「外观」二级页已取消,三项直接挂在一级页。主题与语言都是整行下拉选择行
 * (SettingsSelectRow),与 iOS 的菜单 Picker 对齐;隐藏最近任务仅 Android 有,用 Switch。
 * 每个组件只渲染一行,供 SettingsSectionItem 的 grouped 分组按行分配圆角。
 */
import { memo } from 'react';
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
import { SettingsLeadingIcon } from './SettingsLeadingIcon';
import { SettingsSelectRow } from './SettingsSelectRow';
import { SettingsSwitchRow } from './SettingsSwitchRow';

const ICONS = {
  theme: require('../../../assets/icons/palette.xml'),
  language: require('../../../assets/icons/public.xml'),
  hideFromRecents: require('../../../assets/icons/visibility_off.xml'),
};

export const ThemeSelectRow = memo(function ThemeSelectRow() {
  const { t } = useTranslation('settings');
  const { themeMode, setThemeMode } = useTheme();
  const showMessage = useSettingsToast();

  const options: { label: string; value: ThemeMode }[] = [
    { label: t('appearance.mode.system'), value: 'auto' },
    { label: t('appearance.mode.light'), value: 'light' },
    { label: t('appearance.mode.dark'), value: 'dark' },
  ];

  const handleSelect = async (mode: ThemeMode) => {
    try {
      await setThemeMode(mode);
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('appearance.modeChangeFailed'),
        'error'
      );
    }
  };

  return (
    <SettingsSelectRow
      testID="settings-theme"
      icon={ICONS.theme}
      title={t('general.theme')}
      description={t('hub.summary.theme')}
      options={options}
      selectedValue={themeMode}
      onSelect={(mode) => void handleSelect(mode)}
    />
  );
});

export const LanguageSelectRow = memo(function LanguageSelectRow() {
  const { t } = useTranslation('settings');
  const { preference, setLanguage } = useAppLanguage();
  const showMessage = useSettingsToast();

  const options: { label: string; value: LanguagePreference }[] = [
    { label: t('language.system', { ns: 'common' }), value: 'system' },
    ...SUPPORTED_LANGUAGES.map((code) => ({
      label: LANGUAGE_NATIVE_NAMES[code],
      value: code as LanguagePreference,
    })),
  ];

  const handleSelect = async (pref: LanguagePreference) => {
    try {
      await setLanguage(pref);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('appearance.updateFailed'), 'error');
    }
  };

  return (
    <SettingsSelectRow
      testID="settings-language"
      icon={ICONS.language}
      title={t('language.title', { ns: 'common' })}
      description={t('hub.summary.language')}
      options={options}
      selectedValue={preference}
      onSelect={(pref) => void handleSelect(pref)}
    />
  );
});

export const HideFromRecentsRow = memo(function HideFromRecentsRow() {
  const { t } = useTranslation('settings');
  const showMessage = useSettingsToast();
  const hideFromRecents = useSettingsStore((s) => s.config?.hideFromRecents ?? false);

  const handleToggle = async (enabled: boolean) => {
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
    <SettingsSwitchRow
      testID="settings-hide-from-recents"
      title={t('appearance.hideFromRecents.title')}
      description={t('appearance.hideFromRecents.desc')}
      leading={<SettingsLeadingIcon source={ICONS.hideFromRecents} />}
      value={hideFromRecents}
      onValueChange={(enabled) => void handleToggle(enabled)}
    />
  );
});
