import { HStack, Image, Link, Section, Spacer, Text as SwiftUIText, VStack } from '@expo/ui/swift-ui';
import {
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { APP_VERSION_WITH_BUILD } from '@/constants';
import { useSettingsStore } from '@/stores';
import { iosAccent } from '@/theme/iosDesignTokens';
import { chevronColor, SettingsIconTile, SettingsToggle, settingsTileColors } from './common';

const PROJECT_HOME = 'https://github.com/UniClipboard/UniClipboard';

/** 关于:应用名与版本、启动时检查更新、项目主页 */
export function AboutPage() {
  const { t } = useTranslation('settings');
  const { config, updateConfig } = useSettingsStore();
  if (!config) return null;

  return (
    <IosSheetPage title={t('category.about')}>
      <IosSheetForm>
        <Section modifiers={[listRowBackground('clear')]}>
          <VStack spacing={6} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 8 })]}>
            <Image
              systemName="doc.on.clipboard.fill"
              size={38}
              color="white"
              modifiers={[frame({ width: 84, height: 84 }), background(iosAccent.light), cornerRadius(20)]}
            />
            <SwiftUIText modifiers={[font({ size: 22, weight: 'bold' }), padding({ top: 6 })]}>UniClip</SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {`${t('ios.about.version')} ${APP_VERSION_WITH_BUILD}`}
            </SwiftUIText>
          </VStack>
        </Section>

        <Section header={<SwiftUIText>{t('updatesTitle', { ns: 'settingsAbout' })}</SwiftUIText>}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <SettingsIconTile systemName="arrow.triangle.2.circlepath" color={settingsTileColors.red} />
            <SettingsToggle
              testID="about-auto-check-update"
              label={t('ios.general.checkUpdateOnLaunch')}
              isOn={config.autoCheckUpdate}
              onIsOnChange={(v) => void updateConfig({ autoCheckUpdate: v })}
            />
          </HStack>
        </Section>

        <Section>
          <Link destination={PROJECT_HOME}>
            <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
              <SettingsIconTile systemName="globe" color={settingsTileColors.gray} />
              <SwiftUIText modifiers={[foregroundStyle('primary')]}>{t('ios.about.projectHome')}</SwiftUIText>
              <Spacer />
              <SwiftUIText modifiers={[foregroundStyle('secondary')]}>GitHub</SwiftUIText>
              <Image systemName="arrow.up.right" size={12} color={chevronColor} />
            </HStack>
          </Link>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
