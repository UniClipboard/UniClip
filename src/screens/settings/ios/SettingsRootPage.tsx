import { useEffect } from 'react';
import {
  HStack,
  Image,
  LabeledContent,
  Link,
  Picker,
  Section,
  Spacer,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { useTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/constants';
import type { ThemeMode } from '@/theme';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import {
  LANGUAGE_NATIVE_NAMES,
  type LanguagePreference,
  SUPPORTED_LANGUAGES,
} from '@/i18n/languages';
import {
  chevronColor,
  SettingsIconTile,
  SettingsNavRow,
  SettingsToggle,
  settingsTileColors,
  statusGreen,
  statusOrange,
} from './common';
import { useKeyboardStatus } from './useKeyboardStatus';
import type { SettingsPage } from './types';

function IconToggleRow({
  icon,
  iconColor,
  label,
  isOn,
  onIsOnChange,
}: {
  icon: SFSymbol;
  iconColor: string;
  label: string;
  isOn: boolean;
  onIsOnChange: (v: boolean) => void;
}) {
  return (
    <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <SettingsIconTile systemName={icon} color={iconColor} />
      <SettingsToggle label={label} isOn={isOn} onIsOnChange={onIsOnChange} />
    </HStack>
  );
}

export function SettingsRootPage({
  onNavigate,
  active = true,
}: {
  onNavigate: (page: SettingsPage) => void;
  active?: boolean;
}) {
  const { t } = useTranslation('settings');
  const { config, updateConfig } = useSettingsStore();
  const { setThemeMode } = useTheme();
  const { preference: languagePref, setLanguage } = useAppLanguage();
  const keyboard = useKeyboardStatus();
  const refreshKeyboard = keyboard.refresh;

  // The page stays mounted while sub-pages are shown; re-check the keyboard
  // hint when the user slides back (they may have just finished the setup).
  useEffect(() => {
    if (active) refreshKeyboard();
  }, [active, refreshKeyboard]);

  if (!config) return null;

  const servers = config.servers ?? [];

  const keyboardHint =
    keyboard.state === 'ready'
      ? { value: t('state.enabled', { ns: 'common' }), color: statusGreen }
      : keyboard.state === 'added'
        ? { value: t('ios.keyboardHint.needsFullAccess'), color: statusOrange }
        : keyboard.state === 'notAdded'
          ? { value: t('ios.keyboardHint.notEnabled'), color: undefined }
          : { value: undefined, color: undefined };

  return (
    <IosSheetPage title={t('action.settings', { ns: 'common' })}>
      <IosSheetForm>
        {/* ── 服务器 ── */}
        <Section>
          <SettingsNavRow
            icon="server.rack"
            iconColor={settingsTileColors.blue}
            title={t('category.server')}
            value={t('server.count', { count: servers.length })}
            onPress={() => onNavigate('servers')}
          />
        </Section>

        {/* ── 同步 ── */}
        <Section
          header={<SwiftUIText>{t('category.sync')}</SwiftUIText>}
          footer={<SwiftUIText>{t('ios.sync.footer')}</SwiftUIText>}
        >
          <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <SettingsIconTile systemName="network" color={settingsTileColors.blue} />
            <Picker
              label={t('syncChannel.title')}
              selection={config.syncChannel}
              onSelectionChange={(value) => {
                void useSettingsStore.getState().setSyncChannel(value as 'p2p' | 'lan');
              }}
              modifiers={[pickerStyle('segmented')]}
            >
              <SwiftUIText modifiers={[tag('p2p')]}>{t('syncChannel.p2p')}</SwiftUIText>
              <SwiftUIText modifiers={[tag('lan')]}>{t('syncChannel.lan')}</SwiftUIText>
            </Picker>
          </HStack>
          {config.syncChannel === 'p2p' ? (
            <SettingsNavRow
              icon="person.2"
              iconColor={settingsTileColors.indigo}
              title={t('space.title', { ns: 'settingsSync' })}
              onPress={() => onNavigate('space')}
            />
          ) : null}
          <IconToggleRow
            icon="arrow.down.doc"
            iconColor={settingsTileColors.green}
            label={t('ios.sync.autoApply')}
            isOn={config.autoApplyRemote}
            onIsOnChange={(v) => updateConfig({ autoApplyRemote: v })}
          />
          <IconToggleRow
            icon="arrow.up.doc"
            iconColor={settingsTileColors.teal}
            label={t('ios.sync.autoPush')}
            isOn={config.autoPushLocal}
            onIsOnChange={(v) => updateConfig({ autoPushLocal: v })}
          />
          <IconToggleRow
            icon="bolt.horizontal"
            iconColor={settingsTileColors.orange}
            label={t('ios.sync.sse')}
            isOn={config.enableSse}
            onIsOnChange={(v) => useSettingsStore.getState().setEnableSse(v)}
          />
        </Section>

        {/* ── 扩展与权限 ── */}
        <Section
          header={<SwiftUIText>{t('category.extensions')}</SwiftUIText>}
          footer={<SwiftUIText>{t('ios.extensions.footer')}</SwiftUIText>}
        >
          <SettingsNavRow
            icon="keyboard"
            iconColor={settingsTileColors.indigo}
            title={t('ios.extensions.keyboard')}
            value={keyboardHint.value}
            valueColor={keyboardHint.color}
            onPress={() => onNavigate('keyboard')}
          />
          <SettingsNavRow
            icon="square.and.arrow.up"
            iconColor={settingsTileColors.green}
            title={t('ios.extensions.share')}
            onPress={() => onNavigate('share')}
          />
          <SettingsNavRow
            icon="doc.on.clipboard"
            iconColor={settingsTileColors.orange}
            title={t('ios.extensions.clipboardAccess')}
            onPress={() => onNavigate('clipboard')}
          />
        </Section>

        {/* ── 存储 ── */}
        <Section>
          <SettingsNavRow
            icon="externaldrive"
            iconColor={settingsTileColors.purple}
            title={t('category.storage')}
            onPress={() => onNavigate('storage')}
          />
        </Section>

        {/* ── 通用 ── */}
        <Section header={<SwiftUIText>{t('general.sectionTitle')}</SwiftUIText>}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <SettingsIconTile systemName="circle.lefthalf.filled" color={settingsTileColors.gray} />
            <Picker
              label={t('general.theme')}
              selection={config.appearance}
              onSelectionChange={(v) => {
                const appearance = v as 'system' | 'light' | 'dark';
                updateConfig({ appearance });
                const modeMap: Record<string, ThemeMode> = {
                  system: 'auto',
                  light: 'light',
                  dark: 'dark',
                };
                setThemeMode(modeMap[appearance] ?? 'auto');
              }}
              modifiers={[pickerStyle('menu')]}
            >
              <SwiftUIText modifiers={[tag('system')]}>{t('appearance.mode.system')}</SwiftUIText>
              <SwiftUIText modifiers={[tag('light')]}>{t('appearance.mode.light')}</SwiftUIText>
              <SwiftUIText modifiers={[tag('dark')]}>{t('appearance.mode.dark')}</SwiftUIText>
            </Picker>
          </HStack>

          {/* 语言 */}
          <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <SettingsIconTile systemName="globe" color={settingsTileColors.blue} />
            <Picker
              label={t('language.title', { ns: 'common' })}
              selection={languagePref}
              onSelectionChange={(v) => {
                void setLanguage(v as LanguagePreference);
              }}
              modifiers={[pickerStyle('menu')]}
            >
              <SwiftUIText modifiers={[tag('system')]}>
                {t('language.system', { ns: 'common' })}
              </SwiftUIText>
              {SUPPORTED_LANGUAGES.map((code) => (
                <SwiftUIText key={code} modifiers={[tag(code)]}>
                  {LANGUAGE_NATIVE_NAMES[code]}
                </SwiftUIText>
              ))}
            </Picker>
          </HStack>

          <IconToggleRow
            icon="arrow.triangle.2.circlepath"
            iconColor={settingsTileColors.red}
            label={t('ios.general.checkUpdateOnLaunch')}
            isOn={config.autoCheckUpdate}
            onIsOnChange={(v) => updateConfig({ autoCheckUpdate: v })}
          />
        </Section>

        {/* ── 关于 ── */}
        <Section header={<SwiftUIText>{t('category.about')}</SwiftUIText>}>
          <SettingsNavRow
            icon="waveform.path.ecg"
            iconColor={settingsTileColors.red}
            title={t('diagnostics.title', { ns: 'settingsIos' })}
            onPress={() => onNavigate('diagnostics')}
          />

          <Link destination="https://github.com/UniClipboard/UniClipboard">
            <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
              <SettingsIconTile systemName="globe" color={settingsTileColors.gray} />
              <SwiftUIText>{t('ios.about.projectHome')}</SwiftUIText>
              <Spacer />
              <Image systemName="arrow.up.right" size={12} color={chevronColor} />
            </HStack>
          </Link>

          <LabeledContent
            label={
              <HStack spacing={12}>
                <SettingsIconTile systemName="info.circle" color={settingsTileColors.gray} />
                <SwiftUIText>{t('ios.about.version')}</SwiftUIText>
              </HStack>
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{APP_VERSION}</SwiftUIText>
          </LabeledContent>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
