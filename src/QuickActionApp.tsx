/**
 * QuickActionApp
 * Lightweight RN root component for the transparent QuickActionActivity.
 * Renders only a semi-transparent overlay with the sync progress card.
 * Registered as "quickAction" in the AppRegistry (separate from "main").
 */

import React, { useCallback, useEffect } from 'react';
import { StyleSheet, StatusBar, Platform, BackHandler } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './contexts/ThemeContext';
import { QuickTileLoadingScreen } from './screens/QuickTileLoadingScreen';
import { SyncDirection } from './types/sync';
import { useSettingsStore } from './stores';
import { initLogger } from './services/Logger';

interface QuickActionAppProps {
  direction?: string;
}

export default function QuickActionApp({ direction = 'download' }: QuickActionAppProps) {
  const syncDirection = direction === 'upload' ? SyncDirection.Upload : SyncDirection.Download;
  const { config, loadConfig, isLoaded } = useSettingsStore();

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // Start foreground service if configured (cold start case)
  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android') return;

    const shouldRun =
      config?.enableBackgroundTasks &&
      config?.enableForegroundNotification &&
      (config?.enableBackgroundDownload ||
        config?.enableBackgroundUpload ||
        config?.enableSmsForwarding);

    if (shouldRun) {
      import('foreground-service').then((ForegroundService) => {
        ForegroundService.startService();
      });
    }
  }, [
    isLoaded,
    config?.enableBackgroundTasks,
    config?.enableForegroundNotification,
    config?.enableBackgroundDownload,
    config?.enableBackgroundUpload,
    config?.enableSmsForwarding,
  ]);

  const handleComplete = useCallback(() => {
    BackHandler.exitApp();
  }, []);

  if (!isLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider initialMode="dark">
        <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
        <QuickTileLoadingScreen
          direction={syncDirection}
          onLoadingComplete={handleComplete}
          overlayMode
        />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
