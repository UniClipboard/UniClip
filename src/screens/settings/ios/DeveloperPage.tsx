import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button as SwiftUIButton, Section, Text as SwiftUIText } from '@expo/ui/swift-ui';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  DEVICE_TRUST_PREVIEW_SCENARIOS,
  type DeviceTrustPreviewScenarioId,
} from '@/devtools/deviceTrustPreviewSession';
import {
  ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS,
} from '@/devtools/useAddSyncConnectionPreviewFlow';
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import {
  HeaderCircleButton,
  SettingsMenuRow,
  SettingsNavRow,
  settingsTileColors,
} from './common';

interface DeveloperPageProps {
  onBack: () => void;
  onOpenPreview: (scenarioId: DeviceTrustPreviewScenarioId) => boolean;
  onOpenConnectionSheetPreview: (scenarioId: AddSyncConnectionPreviewScenarioId) => void;
  onOpenOnboardingPreview: () => void;
  onOpenConnectionPreview: () => void;
}

const PREVIEW_ICON = 'play.fill';
const PREVIEW_TILE_COLOR = settingsTileColors.indigo;

/**
 * iOS 开发者选项:一组「预览」入口。Android 的调试开关(调试模式、URL Scheme、
 * 不限次更新检查、统计信息)在 iOS 上没有对应行为,不在此页出现。
 */
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
        <Section
          header={<SwiftUIText>{t('debug.previewsTitle', { ns: 'settingsAbout' })}</SwiftUIText>}
          footer={
            previewUnavailable ? (
              <SwiftUIText>
                {t('debug.deviceTrustPreview.unavailable', { ns: 'settingsAbout' })}
              </SwiftUIText>
            ) : undefined
          }
        >
          <SettingsNavRow
            testID="developer-preview-welcome-tour"
            icon={PREVIEW_ICON}
            iconColor={PREVIEW_TILE_COLOR}
            title={t('debug.previewRows.welcomeTour', { ns: 'settingsAbout' })}
            onPress={onOpenOnboardingPreview}
          />
          <SettingsNavRow
            testID="developer-preview-connection-screens"
            icon={PREVIEW_ICON}
            iconColor={PREVIEW_TILE_COLOR}
            title={t('debug.previewRows.connectionScreens', { ns: 'settingsAbout' })}
            onPress={onOpenConnectionPreview}
          />
          <SettingsMenuRow
            testID="developer-preview-connection-sheet"
            icon={PREVIEW_ICON}
            iconColor={PREVIEW_TILE_COLOR}
            title={t('debug.previewRows.connectionSheet', { ns: 'settingsAbout' })}
          >
            {ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS.map((scenario) => (
              <SwiftUIButton
                key={scenario.id}
                label={t(scenario.labelKey, { ns: 'settingsAbout' })}
                onPress={() => onOpenConnectionSheetPreview(scenario.id)}
              />
            ))}
          </SettingsMenuRow>
          <SettingsMenuRow
            testID="developer-preview-device-relationship"
            icon={PREVIEW_ICON}
            iconColor={PREVIEW_TILE_COLOR}
            title={t('debug.previewRows.deviceRelationship', { ns: 'settingsAbout' })}
          >
            {DEVICE_TRUST_PREVIEW_SCENARIOS.map((scenario) => (
              <SwiftUIButton
                key={scenario.id}
                label={t(scenario.labelKey, { ns: 'settingsAbout' })}
                onPress={() => openScenario(scenario.id)}
              />
            ))}
          </SettingsMenuRow>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
