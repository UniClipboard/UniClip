/**
 * 二级设置页(Android)。
 *
 * 参数化单容器:route param `section` 决定显示哪个二级页内容。结构与一级页一致——
 * 单个 <Host> + <LazyColumn>,各 section 复用已迁的无 Host item 组件。
 * 用 SettingsToastProvider 包裹,使 section 内的 useSettingsToast 正常工作。
 */
import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host, LazyColumn } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import type { RootStackParamList } from '@/navigation/AppNavigator';
import { SettingsToastProvider } from './SettingsToastContext';
import { UnifiedSpaceSetup } from './UnifiedSpaceSetup';
import { HistorySection } from './HistorySection';
import { BackgroundSection } from './BackgroundSection';
import { AppearanceSection } from './AppearanceSection';
import { StorageSection } from './StorageSection';
import { AboutSection } from './AboutSection';
import { LogSection } from './LogSection';
import { DebugSection } from './DebugSection';
import { QuickActionsSection } from './QuickActionsSection';
import { ClipboardAccessMethodSheetProvider } from './ClipboardAccessMethodSheet';

const SettingsSubScreenInner = memo(function SettingsSubScreenInner() {
  const { theme } = useTheme();
  const route = useRoute<RouteProp<RootStackParamList, 'SettingsSub'>>();
  const section = route.params.section;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <Host
        style={styles.container}
        colorScheme={theme.isDark ? 'dark' : 'light'}
        seedColor={theme.colors.accent}
      >
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 16, bottom: 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          {section === 'space' && <UnifiedSpaceSetup />}

          {section === 'history' && <HistorySection />}

          {section === 'background' && <BackgroundSection />}

          {section === 'appearance' && <AppearanceSection />}

          {section === 'storage' && <StorageSection />}

          {section === 'about' && <AboutSection initialUpdate={route.params.update} />}

          {section === 'developer' && (
            <>
              <LogSection />
              <DebugSection />
              <QuickActionsSection />
            </>
          )}
        </LazyColumn>
      </Host>
    </SafeAreaView>
  );
});

export const SettingsSubScreen = () => (
  <SettingsToastProvider>
    <ClipboardAccessMethodSheetProvider>
      <SettingsSubScreenInner />
    </ClipboardAccessMethodSheetProvider>
  </SettingsToastProvider>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
