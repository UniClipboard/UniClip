import { useEngineDiagnosticCapture } from '@/support/diagnostics/useEngineDiagnosticCapture';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Label, Picker, Section, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { AppSettings } from '@/types/settings';
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

const LOG_LEVELS: AppSettings['logLevel'][] = ['debug', 'info', 'warn', 'error'];

export function DiagnosticsPage({ onBack, onSendArchive }: {
  onBack: () => void;
  onSendArchive: (artifact: DiagnosticArtifact) => void;
}) {
  const { t } = useTranslation('settingsIos');
  const capture = useEngineDiagnosticCapture();
  const config = useSettingsStore((state) => state.config);
  const updateConfig = useSettingsStore((state) => state.updateConfig);
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
        <Section
          header={<SwiftUIText>{t('diagnostics.capture.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('diagnostics.capture.description')}</SwiftUIText>}
        >
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
        <Section
          header={<SwiftUIText>{t('log.title', { ns: 'settingsAbout' })}</SwiftUIText>}
          footer={<SwiftUIText>{t('log.storageHint', { ns: 'settingsAbout' })}</SwiftUIText>}
        >
          <SettingsNavRow
            testID="diagnostic-export"
            icon="square.and.arrow.up"
            title={
              isGenerating ? t('diagnostics.action.preparing') : t('diagnostics.action.generate')
            }
            subtitle={t('diagnostics.package.summary')}
            onPress={chooseExportMethod}
            disabled={isGenerating || !config}
            showsChevron={false}
          />
          {config ? (
            <Picker
              testID="diagnostic-log-level"
              label={<Label title={t('log.levelLabel', { ns: 'settingsAbout' })} systemImage="slider.horizontal.3" />}
              selection={config.logLevel}
              onSelectionChange={(value) =>
                void updateConfig({ logLevel: value as AppSettings['logLevel'] })
              }
              modifiers={[pickerStyle('menu')]}
            >
              {LOG_LEVELS.map((level) => (
                <SwiftUIText key={level} modifiers={[tag(level)]}>
                  {t(`log.level.${level}`, { ns: 'settingsAbout' })}
                </SwiftUIText>
              ))}
            </Picker>
          ) : null}
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
