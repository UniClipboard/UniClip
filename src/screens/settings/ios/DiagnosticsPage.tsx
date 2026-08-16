import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button as SwiftUIButton,
  Label,
  LabeledContent,
  Section,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { disabled, foregroundStyle } from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { APP_VERSION } from '@/constants';
import {
  classifyDiagnosticReason,
  createDiagnosticArchive,
  deleteDiagnosticArchive,
  DiagnosticArchiveError,
  type DiagnosticArtifact,
} from '@/support/diagnostics';
import { useSettingsStore } from '@/stores';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/features/space';
import { getLogger } from '@/support/observability';
import { shareFile } from '@/utils/fileActions';
import { HeaderCircleButton } from './common';

export function DiagnosticsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settingsIos');
  const config = useSettingsStore((state) => state.config);
  const engineStatus = useUnifiedEngineStore((state) => state.status);
  const peerConnectionStatus = useUnifiedEngineStore((state) => state.peerConnectionStatus);
  const engineError = useUnifiedEngineStore((state) => state.lastError);
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const deviceCount = useUnifiedSpaceStore((state) => state.devices.length);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateAndShare = useCallback(async () => {
    if (!config || isGenerating) return;

    setIsGenerating(true);
    let artifact: DiagnosticArtifact | null = null;
    try {
      artifact = await createDiagnosticArchive({
        settings: {
          autoApplyRemote: config.autoApplyRemote,
          autoPushLocal: config.autoPushLocal,
          attachmentAutoDownload: config.attachmentAutoDownload,
          logLevel: config.logLevel,
        },
        sync: {
          status: engineStatus,
          peerConnectionStatus,
          hasSpace: spaceId !== null,
          deviceCount,
          lastErrorReason: engineError ? classifyDiagnosticReason(engineError) : null,
        },
      });
      await shareFile(artifact.uri, artifact.fileName);
    } catch (error) {
      getLogger().error('DiagnosticsPage: diagnostic package failed', {
        errorName: error instanceof Error ? error.name : String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
        artifactUri: artifact?.uri ?? null,
      });
      let message = t('diagnostics.error.message');
      if (error instanceof DiagnosticArchiveError) {
        if (error.code === 'engine_logs_missing') {
          message = t('diagnostics.error.engineLogsMissing');
        } else if (error.code === 'engine_logs_unreadable') {
          message = t('diagnostics.error.engineLogsUnreadable');
        }
      }
      Alert.alert(t('diagnostics.error.title'), message);
    } finally {
      if (artifact) deleteDiagnosticArchive(artifact.uri);
      setIsGenerating(false);
    }
  }, [config, deviceCount, engineError, engineStatus, isGenerating, peerConnectionStatus, spaceId, t]);

  return (
    <IosSheetPage
      title={t('diagnostics.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        <Section footer={<SwiftUIText>{t('diagnostics.package.footer')}</SwiftUIText>}>
          <LabeledContent
            label={<Label title={t('diagnostics.package.appVersion')} systemImage="app.badge" />}
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{APP_VERSION}</SwiftUIText>
          </LabeledContent>
          <LabeledContent
            label={<Label title={t('diagnostics.package.format')} systemImage="doc.zipper" />}
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('diagnostics.package.zipArchive')}
            </SwiftUIText>
          </LabeledContent>
          <LabeledContent
            label={
              <Label
                title={t('diagnostics.package.logRange')}
                systemImage="clock.arrow.circlepath"
              />
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('diagnostics.package.lastThreeDays')}
            </SwiftUIText>
          </LabeledContent>
          <LabeledContent
            label={<Label title={t('diagnostics.package.appLogs')} systemImage="doc.text" />}
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{t('diagnostics.package.included')}</SwiftUIText>
          </LabeledContent>
          <LabeledContent
            label={<Label title={t('diagnostics.package.engineLogs')} systemImage="gearshape.2" />}
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{t('diagnostics.package.included')}</SwiftUIText>
          </LabeledContent>
          <LabeledContent
            label={
              <Label
                title={t('diagnostics.package.shareAttempts')}
                systemImage="puzzlepiece.extension"
              />
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('diagnostics.package.included')}
            </SwiftUIText>
          </LabeledContent>
        </Section>

        <Section>
          <SwiftUIButton
            systemImage="square.and.arrow.up"
            label={
              isGenerating ? t('diagnostics.action.preparing') : t('diagnostics.action.generate')
            }
            onPress={handleGenerateAndShare}
            modifiers={[disabled(isGenerating || !config)]}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
