import { useCallback, useEffect, useMemo, useState } from 'react';
import { File } from 'expo-file-system';
import { StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Host, NavigationDestination, NavigationStack, ZStack } from '@expo/ui/swift-ui';
import { frame, tint } from '@expo/ui/swift-ui/modifiers';

import { iosAccentColor } from '@/theme/iosDesignTokens';
import { ShareSendSheet } from '@/components/ShareSendSheet';
import { mainTabBarClearance } from '@/components/ios/MainTabBar';
import { IosPageChromeProvider } from '@/components/ui';
import { deleteDiagnosticArchive, type DiagnosticArtifact } from '@/support/diagnostics';
import type { PendingShareJob } from '@/features/transfer';
import { useSettingsStore } from '@/stores';
import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import type { SettingsPage } from './settings/ios/types';
import { SettingsRootPage } from './settings/ios/SettingsRootPage';
import { StoragePage } from './settings/ios/StoragePage';
import { KeyboardPage } from './settings/ios/KeyboardPage';
import { SharePage } from './settings/ios/SharePage';
import { ClipboardAccessPage } from './settings/ios/ClipboardAccessPage';
import { LogSection } from './settings/LogSection';
import { DeveloperPage } from './settings/ios/DeveloperPage';
import { HistoryPage } from './settings/ios/HistoryPage';
import { AppearancePage } from './settings/ios/AppearancePage';
import { PrivacyPage } from './settings/ios/PrivacyPage';
import { AboutPage } from './settings/ios/AboutPage';
import {
  canOpenDeviceTrustPreview,
  openDeviceTrustPreview,
} from '@/devtools/deviceTrustPreviewCoordinator';
import type { DeviceTrustPreviewScenarioId } from '@/devtools/deviceTrustPreviewSession';
import type { RootStackParamList } from '@/navigation/AppNavigator';

const fillModifier = frame({ maxWidth: Infinity, maxHeight: Infinity });

/**
 * iOS「设置」标签页。全屏 Host 内是 SwiftUI NavigationStack:根页为大标题设置总览,
 * 子页原生推入 / 侧滑返回。诊断包分享、连接页预览等 sheet 作为导航栈的兄弟节点,
 * 由本页这个稳定宿主持有。同步通道与空间管理在「设备」标签页。
 */
export const SettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { config, isLoaded, loadConfig } = useSettingsStore();
  const [path, setPath] = useState<string[]>([]);
  const [diagnosticArchive, setDiagnosticArchive] = useState<DiagnosticArtifact | null>(null);
  const [connectionPreviewScenario, setConnectionPreviewScenario] =
    useState<AddSyncConnectionPreviewScenarioId | null>(null);
  const diagnosticJobs = useMemo<PendingShareJob[] | undefined>(
    () =>
      diagnosticArchive
        ? [
            {
              id: diagnosticArchive.uri,
              kind: 'file',
              displayName: diagnosticArchive.fileName,
              fileUri: diagnosticArchive.uri,
              byteCount: new File(diagnosticArchive.uri).size,
              mimeType: 'application/zip',
              createdAtMs: Date.now(),
            },
          ]
        : undefined,
    [diagnosticArchive]
  );

  useEffect(() => {
    return () => {
      if (diagnosticArchive) deleteDiagnosticArchive(diagnosticArchive.uri);
    };
  }, [diagnosticArchive]);

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  const openSubPage = useCallback((page: SettingsPage) => {
    if (page === 'root') return;
    setPath((current) => [...current, page]);
  }, []);
  const back = useCallback(() => setPath((current) => current.slice(0, -1)), []);

  const openPreview = useCallback((scenarioId: DeviceTrustPreviewScenarioId) => {
    if (!canOpenDeviceTrustPreview()) return false;
    openDeviceTrustPreview(scenarioId);
    return true;
  }, []);

  if (!isLoaded || !config) return null;

  return (
    <Host style={styles.host}>
      <IosPageChromeProvider
        value={{ kind: 'navigation', bottomClearance: mainTabBarClearance(insets.bottom) - insets.bottom }}
      >
        <ZStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
          <NavigationStack path={path} onPathChange={setPath}>
            <SettingsRootPage onNavigate={openSubPage} />
            <NavigationDestination value="history">
              <HistoryPage />
            </NavigationDestination>
            <NavigationDestination value="appearance">
              <AppearancePage />
            </NavigationDestination>
            <NavigationDestination value="storage">
              <StoragePage onBack={back} />
            </NavigationDestination>
            <NavigationDestination value="keyboard">
              <KeyboardPage onBack={back} />
            </NavigationDestination>
            <NavigationDestination value="share">
              <SharePage onBack={back} />
            </NavigationDestination>
            <NavigationDestination value="clipboard">
              <ClipboardAccessPage onBack={back} />
            </NavigationDestination>
            <NavigationDestination value="diagnostics">
              <LogSection onBack={back} onSendArchive={setDiagnosticArchive} />
            </NavigationDestination>
            <NavigationDestination value="privacy">
              <PrivacyPage />
            </NavigationDestination>
            <NavigationDestination value="about">
              <AboutPage />
            </NavigationDestination>
            <NavigationDestination value="developer">
              <DeveloperPage
                onBack={back}
                onOpenPreview={openPreview}
                onOpenConnectionSheetPreview={setConnectionPreviewScenario}
                onOpenOnboardingPreview={() => navigation.navigate('OnboardingPreview')}
                onOpenConnectionPreview={() => navigation.navigate('ConnectionPreview')}
              />
            </NavigationDestination>
          </NavigationStack>

          <ShareSendSheet
            visible={diagnosticArchive !== null}
            jobs={diagnosticJobs}
            embeddedInHost
            onClose={() => setDiagnosticArchive(null)}
          />
          <AddSyncConnectionSheet
            visible={connectionPreviewScenario !== null}
            initialMode="choose"
            previewScenario={connectionPreviewScenario ?? undefined}
            embeddedInHost
            persistentPresentation
            onClose={() => setConnectionPreviewScenario(null)}
            onConnected={() => {
              setConnectionPreviewScenario(null);
              return true;
            }}
          />
        </ZStack>
      </IosPageChromeProvider>
    </Host>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
});
