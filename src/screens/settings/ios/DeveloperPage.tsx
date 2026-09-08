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
  chevronColor,
  HeaderCircleButton,
  SettingsNavRow,
} from './common';

interface DeveloperPageProps {
  onBack: () => void;
  onOpenPreview: (scenarioId: DeviceTrustPreviewScenarioId) => boolean;
  onOpenOnboardingPreview: () => void;
}

export function DeveloperPage({ onBack, onOpenPreview, onOpenOnboardingPreview }: DeveloperPageProps) {
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
      </IosSheetForm>
    </IosSheetPage>
  );
}
