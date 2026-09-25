import { HStack, Section, Text as SwiftUIText, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { APP_VERSION } from '@/constants';
import { isDeviceTrustPreviewAvailable } from '@/devtools/deviceTrustPreviewCoordinator';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { LANGUAGE_NATIVE_NAMES, type LanguagePreference, SUPPORTED_LANGUAGES } from '@/i18n/languages';
import {
  SettingsIconTile,
  SettingsNavRow,
  SettingsPickerRow,
  SettingsToggle,
  settingsTileColors,
  statusGreen,
  statusOrange,
} from './common';
import { useKeyboardStatus } from './useKeyboardStatus';
import type { SettingsPage } from './types';

type Appearance = 'system' | 'light' | 'dark';

const THEME_MODE: Record<Appearance, ThemeMode> = {
  system: 'auto',
  light: 'light',
  dark: 'dark',
};

/** 带图标与说明的开关行(剪贴板同步方向) */
function IconToggleRow({
  testID,
  icon,
  iconColor,
  label,
  description,
  isOn,
  onIsOnChange,
}: {
  testID?: string;
  icon: SFSymbol;
  iconColor: string;
  label: string;
  description: string;
  isOn: boolean;
  onIsOnChange: (v: boolean) => void;
}) {
  return (
    <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <SettingsIconTile systemName={icon} color={iconColor} />
      <SettingsToggle testID={testID} isOn={isOn} onIsOnChange={onIsOnChange}>
        <VStack alignment="leading" spacing={2}>
          <SwiftUIText>{label}</SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
            {description}
          </SwiftUIText>
        </VStack>
      </SettingsToggle>
    </HStack>
  );
}

/**
 * iOS「设置」标签页根页(大标题):剪贴板同步方向 → 通用(历史 / 剪贴板访问 / 主题 / 语言 / 存储)
 * → 扩展(键盘 / 分享)→ 支持(诊断日志)→ 其他(隐私 / 关于 / 开发者选项)。
 * 同步方式与空间设备在「设备」标签页。每行整行可点,推入对应子页;主题与语言整行弹出原生菜单。
 */
export function SettingsRootPage({ onNavigate }: { onNavigate: (page: SettingsPage) => void }) {
  const { t } = useTranslation('settings');
  const { config, updateConfig } = useSettingsStore();
  const keyboard = useKeyboardStatus();
  const { setThemeMode } = useTheme();
  const { preference: languagePref, setLanguage } = useAppLanguage();
  const deviceTrustPreviewAvailable = isDeviceTrustPreviewAvailable();

  if (!config) return null;

  const direct = config.syncChannel === 'p2p';
  const keyboardHint =
    keyboard.state === 'ready'
      ? { value: t('state.enabled', { ns: 'common' }), color: statusGreen }
      : keyboard.state === 'added'
        ? { value: t('ios.keyboardHint.needsFullAccess'), color: statusOrange }
        : keyboard.state === 'notAdded'
          ? { value: t('ios.keyboardHint.notEnabled'), color: undefined }
          : { value: undefined, color: undefined };
  const themeOptions = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`appearance.mode.${value}`),
  }));
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('language.system', { ns: 'common' }) },
    ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NATIVE_NAMES[code] })),
  ];
  const selectAppearance = (appearance: Appearance) => {
    void updateConfig({ appearance });
    setThemeMode(THEME_MODE[appearance]);
  };

  return (
    <IosSheetPage title={t('action.settings', { ns: 'common' })}>
      <IosSheetForm>
        <Section
          header={<SwiftUIText>{t('hub.clipboardSync.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('ios.sync.footer')}</SwiftUIText>}
        >
          <IconToggleRow
            testID="settings-auto-apply"
            icon="arrow.down.doc"
            iconColor={settingsTileColors.green}
            label={t('hub.clipboardSync.autoApply.title')}
            description={t(direct ? 'hub.clipboardSync.autoApply.descP2p' : 'hub.clipboardSync.autoApply.descLan')}
            isOn={config.autoApplyRemote}
            onIsOnChange={(v) => updateConfig({ autoApplyRemote: v })}
          />
          <IconToggleRow
            testID="settings-auto-push"
            icon="arrow.up.doc"
            iconColor={settingsTileColors.teal}
            label={t('hub.clipboardSync.autoPush.title')}
            description={t(direct ? 'hub.clipboardSync.autoPush.descP2p' : 'hub.clipboardSync.autoPush.descLan')}
            isOn={config.autoPushLocal}
            onIsOnChange={(v) => updateConfig({ autoPushLocal: v })}
          />
        </Section>

        <Section header={<SwiftUIText>{t('general.sectionTitle')}</SwiftUIText>}>
          <SettingsNavRow
            testID="settings-history"
            icon="clock.arrow.circlepath"
            iconColor={settingsTileColors.blue}
            title={t('category.history')}
            value={config.maxHistoryItems.toLocaleString()}
            onPress={() => onNavigate('history')}
          />
          <SettingsNavRow
            testID="settings-clipboard-access"
            icon="doc.on.clipboard"
            iconColor={settingsTileColors.orange}
            title={t('ios.extensions.clipboardAccess')}
            onPress={() => onNavigate('clipboard')}
          />
          <SettingsPickerRow
            testID="settings-theme"
            icon="circle.lefthalf.filled"
            iconColor={settingsTileColors.indigo}
            title={t('general.theme')}
            options={themeOptions}
            selection={config.appearance ?? 'system'}
            onSelectionChange={selectAppearance}
          />
          <SettingsPickerRow
            testID="settings-language"
            icon="globe"
            iconColor={settingsTileColors.blue}
            title={t('language.title', { ns: 'common' })}
            options={languageOptions}
            selection={languagePref}
            onSelectionChange={(value) => void setLanguage(value)}
          />
          <SettingsNavRow
            testID="settings-storage"
            icon="externaldrive"
            iconColor={settingsTileColors.purple}
            title={t('category.storage')}
            onPress={() => onNavigate('storage')}
          />
        </Section>

        <Section
          header={<SwiftUIText>{t('category.extensions')}</SwiftUIText>}
          footer={<SwiftUIText>{t('ios.extensions.footer')}</SwiftUIText>}
        >
          <SettingsNavRow
            testID="settings-keyboard"
            icon="keyboard"
            iconColor={settingsTileColors.indigo}
            title={t('ios.extensions.keyboard')}
            value={keyboardHint.value}
            valueColor={keyboardHint.color}
            onPress={() => onNavigate('keyboard')}
          />
          <SettingsNavRow
            testID="settings-share"
            icon="square.and.arrow.up"
            iconColor={settingsTileColors.green}
            title={t('ios.extensions.share')}
            onPress={() => onNavigate('share')}
          />
        </Section>

        <Section header={<SwiftUIText>{t('category.support')}</SwiftUIText>}>
          <SettingsNavRow
            testID="settings-diagnostics"
            icon="waveform.path.ecg"
            iconColor={settingsTileColors.red}
            title={t('category.diagnostics')}
            onPress={() => onNavigate('diagnostics')}
          />
        </Section>

        <Section header={<SwiftUIText>{t('category.other')}</SwiftUIText>}>
          <SettingsNavRow
            testID="settings-privacy"
            icon="hand.raised.fill"
            iconColor={settingsTileColors.blue}
            title={t('category.privacy')}
            onPress={() => onNavigate('privacy')}
          />
          <SettingsNavRow
            testID="settings-about"
            icon="info.circle"
            iconColor={settingsTileColors.gray}
            title={t('category.about')}
            value={APP_VERSION}
            onPress={() => onNavigate('about')}
          />
          {deviceTrustPreviewAvailable ? (
            <SettingsNavRow
              testID="settings-developer"
              icon="wrench.and.screwdriver"
              iconColor={settingsTileColors.indigo}
              title={t('category.developer')}
              onPress={() => onNavigate('developer')}
            />
          ) : null}
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
