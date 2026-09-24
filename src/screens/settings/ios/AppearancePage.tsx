import { Picker, Section, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { LANGUAGE_NATIVE_NAMES, type LanguagePreference, SUPPORTED_LANGUAGES } from '@/i18n/languages';

const THEME_MODE: Record<'system' | 'light' | 'dark', ThemeMode> = {
  system: 'auto',
  light: 'light',
  dark: 'dark',
};

/** 外观:主题(跟随系统 / 浅色 / 深色)与应用语言 */
export function AppearancePage() {
  const { t } = useTranslation('settings');
  const { config, updateConfig } = useSettingsStore();
  const { setThemeMode } = useTheme();
  const { preference: languagePref, setLanguage } = useAppLanguage();
  if (!config) return null;

  return (
    <IosSheetPage title={t('appearance.sectionTitle')}>
      <IosSheetForm>
        <Section header={<SwiftUIText>{t('general.theme')}</SwiftUIText>}>
          <Picker
            testID="appearance-theme"
            selection={config.appearance}
            onSelectionChange={(value) => {
              const appearance = value as 'system' | 'light' | 'dark';
              void updateConfig({ appearance });
              setThemeMode(THEME_MODE[appearance] ?? 'auto');
            }}
            modifiers={[pickerStyle('inline')]}
          >
            <SwiftUIText modifiers={[tag('system')]}>{t('appearance.mode.system')}</SwiftUIText>
            <SwiftUIText modifiers={[tag('light')]}>{t('appearance.mode.light')}</SwiftUIText>
            <SwiftUIText modifiers={[tag('dark')]}>{t('appearance.mode.dark')}</SwiftUIText>
          </Picker>
        </Section>

        <Section header={<SwiftUIText>{t('language.title', { ns: 'common' })}</SwiftUIText>}>
          <Picker
            testID="appearance-language"
            label={t('language.title', { ns: 'common' })}
            selection={languagePref}
            onSelectionChange={(value) => void setLanguage(value as LanguagePreference)}
            modifiers={[pickerStyle('menu')]}
          >
            <SwiftUIText modifiers={[tag('system')]}>{t('language.system', { ns: 'common' })}</SwiftUIText>
            {SUPPORTED_LANGUAGES.map((code) => (
              <SwiftUIText key={code} modifiers={[tag(code)]}>
                {LANGUAGE_NATIVE_NAMES[code]}
              </SwiftUIText>
            ))}
          </Picker>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
