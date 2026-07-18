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
  createDiagnosticPackage,
  deleteDiagnosticPackage,
  type DiagnosticArtifact,
} from '@/services/DiagnosticPackage';
import { classifyDiagnosticReason } from '@/services/DiagnosticEventClassifier';
import { useSettingsStore, useSyncEngineStore } from '@/stores';
import { shareFile } from '@/utils/fileActions';
import { HeaderCircleButton } from './common';

export function DiagnosticsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settingsIos');
  const config = useSettingsStore((state) => state.config);
  const syncStatus = useSyncEngineStore((state) => state.status);
  const isSyncEngineRunning = useSyncEngineStore((state) => state.isRunning);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateAndShare = useCallback(async () => {
    if (!config || isGenerating) return;

    setIsGenerating(true);
    let artifact: DiagnosticArtifact | null = null;
    try {
      const activeServer = config.servers[config.activeServerIndex];
      const candidateAddressCount = activeServer?.urls?.filter(Boolean).length ?? 0;
      const activeServerAddressCount = activeServer
        ? candidateAddressCount || (activeServer.url ? 1 : 0)
        : 0;
      artifact = await createDiagnosticPackage({
        settings: {
          configuredServerCount: config.servers.length,
          activeServerConfigured: activeServer !== undefined,
          activeServerType: activeServer?.type ?? null,
          activeServerAddressCount,
          trustInsecureCert: config.trustInsecureCert,
          autoApplyRemote: config.autoApplyRemote,
          autoPushLocal: config.autoPushLocal,
          enableSse: config.enableSse,
          attachmentAutoDownload: config.attachmentAutoDownload,
          logLevel: config.logLevel,
        },
        sync: {
          isRunning: isSyncEngineRunning,
          state: syncStatus.state,
          isExplicitlyRefreshing: syncStatus.isExplicitlyRefreshing,
          hasStagedEntry: syncStatus.stagedEntry !== null,
          lastSyncedAt: syncStatus.lastSyncedAt,
          lastErrorReason: syncStatus.lastError
            ? classifyDiagnosticReason(syncStatus.lastError)
            : null,
        },
      });
      await shareFile(artifact.uri, artifact.fileName);
    } catch {
      Alert.alert(t('diagnostics.error.title'), t('diagnostics.error.message'));
    } finally {
      if (artifact) deleteDiagnosticPackage(artifact.uri);
      setIsGenerating(false);
    }
  }, [config, isGenerating, isSyncEngineRunning, syncStatus, t]);

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
            label={
              <Label
                title={t('diagnostics.package.extensions')}
                systemImage="puzzlepiece.extension"
              />
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('diagnostics.package.notIncluded')}
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
