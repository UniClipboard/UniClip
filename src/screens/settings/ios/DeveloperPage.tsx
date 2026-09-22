import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Menu,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  contentShape,
  foregroundStyle,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { iosAccentColor } from '@/theme/iosDesignTokens';
import {
  DEVICE_TRUST_PREVIEW_SCENARIOS,
  type DeviceTrustPreviewScenarioId,
} from '@/devtools/deviceTrustPreviewSession';
import {
  ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS,
} from '@/devtools/useAddSyncConnectionPreviewFlow';
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import {
  chevronColor,
  HeaderCircleButton,
  SettingsNavRow,
} from './common';

interface DeveloperPageProps {
  onBack: () => void;
  onOpenPreview: (scenarioId: DeviceTrustPreviewScenarioId) => boolean;
  onOpenConnectionSheetPreview: (scenarioId: AddSyncConnectionPreviewScenarioId) => void;
  onOpenOnboardingPreview: () => void;
  onOpenConnectionPreview: () => void;
}

export function DeveloperPage({ onBack, onOpenPreview, onOpenConnectionSheetPreview, onOpenOnboardingPreview, onOpenConnectionPreview }: DeveloperPageProps) {
  const { t } = useTranslation(['settings', 'settingsAbout']);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);

  const openScenario = (scenarioId: DeviceTrustPreviewScenarioId) => {
    setPreviewUnavailable(!onOpenPreview(scenarioId));
  };

  return (
    <IosSheetPage
      title={t('category.developer', { ns: 'settings' })}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        <Section>
          <SettingsNavRow
            icon="rectangle.stack"
            title={t('debug.onboardingPreview', { ns: 'settingsAbout' })}
            onPress={onOpenOnboardingPreview}
          />
          <SettingsNavRow
            icon="qrcode.viewfinder"
            title={t('debug.connectionPreview', { ns: 'settingsAbout' })}
            onPress={onOpenConnectionPreview}
          />
        </Section>
        <Section
          footer={
            <SwiftUIText>
              {t(
                previewUnavailable
                  ? 'debug.deviceTrustPreview.unavailable'
                  : 'debug.deviceTrustPreview.pickerDescription',
                { ns: 'settingsAbout' }
              )}
            </SwiftUIText>
          }
        >
          <Menu
            label={
              <HStack
                spacing={12}
                modifiers={[frame({ maxWidth: Infinity }), contentShape(shapes.rectangle())]}
              >
                <Image
                  systemName="rectangle.stack.badge.play"
                  size={22}
                  color={iosAccentColor}
                  modifiers={[frame({ width: 28, height: 28 })]}
                />
                <VStack
                  spacing={2}
                  alignment="leading"
                  modifiers={[frame({ maxWidth: Infinity })]}
                >
                  <SwiftUIText>
                    {t('debug.deviceTrustPreview.label', { ns: 'settingsAbout' })}
                  </SwiftUIText>
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('debug.deviceTrustPreview.description', { ns: 'settingsAbout' })}
                  </SwiftUIText>
                </VStack>
                <Spacer />
                <Image systemName="chevron.up.chevron.down" size={12} color={chevronColor} />
              </HStack>
            }
          >
            {DEVICE_TRUST_PREVIEW_SCENARIOS.map((scenario) => (
              <SwiftUIButton
                key={scenario.id}
                label={t(scenario.labelKey, { ns: 'settingsAbout' })}
                onPress={() => openScenario(scenario.id)}
              />
            ))}
          </Menu>
        </Section>
        <Section footer={<SwiftUIText>{t('debug.connectionSheetPreview.pickerDescription', { ns: 'settingsAbout' })}</SwiftUIText>}>
          <Menu
            label={
              <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity }), contentShape(shapes.rectangle())]}>
                <Image
                  systemName="iphone.and.arrow.forward"
                  size={22}
                  color={iosAccentColor}
                  modifiers={[frame({ width: 28, height: 28 })]}
                />
                <VStack spacing={2} alignment="leading" modifiers={[frame({ maxWidth: Infinity })]}>
                  <SwiftUIText>{t('debug.connectionSheetPreview.label', { ns: 'settingsAbout' })}</SwiftUIText>
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('debug.connectionSheetPreview.description', { ns: 'settingsAbout' })}
                  </SwiftUIText>
                </VStack>
                <Spacer />
                <Image systemName="chevron.up.chevron.down" size={12} color={chevronColor} />
              </HStack>
            }
          >
            {ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS.map((scenario) => (
              <SwiftUIButton
                key={scenario.id}
                label={t(scenario.labelKey, { ns: 'settingsAbout' })}
                onPress={() => onOpenConnectionSheetPreview(scenario.id)}
              />
            ))}
          </Menu>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
