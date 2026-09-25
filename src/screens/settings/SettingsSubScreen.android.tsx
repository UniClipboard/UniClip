/**
 * 二级设置页(Android)。
 *
 * 参数化单容器:`section` 决定显示哪个二级页内容。结构与一级页一致——
 * 单个 <Host> + <LazyColumn>,各 section 复用已迁的无 Host item 组件。
 * 用 SettingsToastProvider 包裹,使 section 内的 useSettingsToast 正常工作。
 * 顶级「设备」目的地复用同一容器(`SettingsSectionPage` + syncChannel)。
 */
import React, { memo, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFloatingNavigationClearance,
  useFloatingNavigationSnackbarOffset,
} from '@/components/android/floatingNavigationClearance';
import { Host, LazyColumn } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import type {
  RootStackParamList,
  SettingsSubSection,
  SpaceDeviceTarget,
} from '@/navigation/AppNavigator.types';
import type { UpdateCheckResult } from '@/features/updates';
import { SettingsToastProvider } from './SettingsToastContext';
import { UnifiedSpaceSetup } from './UnifiedSpaceSetup';
import { HistorySection } from './HistorySection';
import { BackgroundSection } from './android/BackgroundSection';
import { StorageSection } from './StorageSection';
import { AboutSection } from './AboutSection';
import { LogSection } from './LogSection';
import { DebugSection } from './android/DebugSection';
import { SpaceSettingsSection } from './android/SpaceSettingsSection';
import { QuickActionsSection } from './QuickActionsSection';
import { AnalyticsConsentControl } from './AnalyticsConsentControl';
import { ClipboardAccessMethodSheetProvider } from './ClipboardAccessMethodSheet';
import { LanServersPage } from './LanServersPage';
import { SyncChannelSection } from './SyncChannelSection.android';
import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import { MATERIAL_SEED_COLOR } from '@/theme/colors';

interface SettingsSectionPageProps extends SpaceDeviceTarget {
  section: SettingsSubSection;
  update?: UpdateCheckResult;
}

const SettingsSectionPageInner = memo(function SettingsSectionPageInner({
  section,
  update,
  deviceId,
  notificationNavigationRequestId,
}: SettingsSectionPageProps) {
  const { theme } = useTheme();
  // 列表延伸到系统导航栏(及顶级目的地的悬浮导航胶囊)之下,末项需让出这部分
  const insets = useSafeAreaInsets();
  const navClearance = useFloatingNavigationClearance();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [connectionSheetPreview, setConnectionSheetPreview] =
    useState<AddSyncConnectionPreviewScenarioId | null>(null);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <Host
        style={styles.container}
        colorScheme={theme.isDark ? 'dark' : 'light'}
        seedColor={MATERIAL_SEED_COLOR}
      >
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 16, bottom: insets.bottom + navClearance + 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          {section === 'syncChannel' && (
            <SyncChannelSection
              initialDeviceId={deviceId}
              notificationNavigationRequestId={notificationNavigationRequestId}
            />
          )}

          {section === 'space' && (
            <UnifiedSpaceSetup
              initialDeviceId={deviceId}
              notificationNavigationRequestId={notificationNavigationRequestId}
            />
          )}

          {section === 'spaceSettings' && <SpaceSettingsSection />}

          {section === 'lanServers' && <LanServersPage />}

          {section === 'history' && <HistorySection />}

          {section === 'background' && <BackgroundSection />}

          {section === 'storage' && <StorageSection />}

          {section === 'privacy' && <AnalyticsConsentControl />}

          {section === 'diagnostics' && <LogSection />}

          {section === 'about' && (
            <AboutSection initialUpdate={update} />
          )}

          {section === 'developer' && (
            <>
              <DebugSection
                onOpenOnboardingPreview={() =>
                  navigation.navigate('OnboardingPreview')
                }
                onOpenConnectionPreview={() =>
                  navigation.navigate('ConnectionPreview')
                }
                onOpenConnectionSheetPreview={setConnectionSheetPreview}
              />
              <QuickActionsSection />
            </>
          )}
        </LazyColumn>
      </Host>
      <AddSyncConnectionSheet
        visible={connectionSheetPreview !== null}
        previewScenario={connectionSheetPreview ?? undefined}
        onClose={() => setConnectionSheetPreview(null)}
      />
    </SafeAreaView>
  );
});

export const SettingsSectionPage = (props: SettingsSectionPageProps) => {
  const snackbarOffset = useFloatingNavigationSnackbarOffset();
  return (
    <SettingsToastProvider bottomOffset={snackbarOffset}>
      <ClipboardAccessMethodSheetProvider>
        <SettingsSectionPageInner {...props} />
      </ClipboardAccessMethodSheetProvider>
    </SettingsToastProvider>
  );
};

export const SettingsSubScreen = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SettingsSub'>>();
  return <SettingsSectionPage {...route.params} />;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
