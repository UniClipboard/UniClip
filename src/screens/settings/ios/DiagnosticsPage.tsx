import { useEngineDiagnosticCapture } from '@/support/diagnostics/useEngineDiagnosticCapture';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Label,
  LabeledContent,
  Section,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';

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
import { HeaderCircleButton, SettingsNavRow } from './common';

export function DiagnosticsPage({ onBack, onSendArchive }: {
  onBack: () => void;
  onSendArchive: (artifact: DiagnosticArtifact) => void;
}) {
  const { t } = useTranslation('settingsIos');
  const capture = useEngineDiagnosticCapture();
  const config = useSettingsStore((state) => state.config);
  const engineStatus = useUnifiedEngineStore((state) => state.status);
  const peerConnectionStatus = useUnifiedEngineStore((state) => state.peerConnectionStatus);
  const engineError = useUnifiedEngineStore((state) => state.lastError);
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const deviceCount = useUnifiedSpaceStore((state) => state.devices.length);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = useCallback(async (method: 'share' | 'send') => {
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
      if (method === 'send') {
        onSendArchive(artifact);
        artifact = null;
      } else {
        await shareFile(artifact.uri, artifact.fileName);
      }
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
  }, [config, deviceCount, engineError, engineStatus, isGenerating, onSendArchive, peerConnectionStatus, spaceId, t]);

  const chooseExportMethod = () => {
    Alert.alert(t('diagnostics.action.generate'), undefined, [
      { text: t('action.share', { ns: 'common' }), onPress: () => void handleExport('share') },
      { text: t('diagnostics.action.sendTo'), onPress: () => void handleExport('send') },
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
    ]);
  };

  return (
    <IosSheetPage
      title={t('diagnostics.title')}
      leftSlots={[<HeaderCircleButton testID="diagnostics-back" key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        <Section footer={<SwiftUIText>{t('diagnostics.capture.description')}</SwiftUIText>}>
          <SettingsNavRow
            testID="engine-diagnostic-capture"
            icon="waveform.path"
            title={capture.active ? t('diagnostics.capture.stop') : t('diagnostics.capture.start')}
            subtitle={capture.failed ? t('diagnostics.capture.failed') : !capture.available ? t('diagnostics.capture.unavailable') : capture.active ? t('diagnostics.capture.remaining', { count: capture.remainingMinutes }) : undefined}
            disabled={!capture.available || capture.busy}
            showsChevron={false}
            onPress={() => void capture.toggle()}
          />
        </Section>
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
          <SettingsNavRow
            testID="diagnostic-export"
            icon="square.and.arrow.up"
            title={
              isGenerating ? t('diagnostics.action.preparing') : t('diagnostics.action.generate')
            }
            onPress={chooseExportMethod}
            disabled={isGenerating || !config}
            showsChevron={false}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
