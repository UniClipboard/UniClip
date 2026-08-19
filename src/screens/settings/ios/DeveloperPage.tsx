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
import {
  DEVICE_TRUST_PREVIEW_SCENARIOS,
  type DeviceTrustPreviewScenarioId,
} from '@/devtools/deviceTrustPreviewSession';
import {
  chevronColor,
  HeaderCircleButton,
  SettingsIconTile,
  settingsTileColors,
} from './common';

interface DeveloperPageProps {
  onBack: () => void;
  onOpenPreview: (scenarioId: DeviceTrustPreviewScenarioId) => boolean;
}

export function DeveloperPage({ onBack, onOpenPreview }: DeveloperPageProps) {
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
                <SettingsIconTile
                  systemName="rectangle.stack.badge.play"
                  color={settingsTileColors.indigo}
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
