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
import { useSettingsStore } from './stores';
import { initLogger } from './support/observability';
import { getAppRuntime } from './app/runtime/composition';

interface QuickActionAppProps {
  systemTheme?: 'light' | 'dark';
}

export default function QuickActionApp({ systemTheme }: QuickActionAppProps) {
  const { loadConfig, isLoaded } = useSettingsStore();

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 启动所有后台服务（冷启动 / 快速操作时保证后台任务正常运行）
  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android') return;
    getAppRuntime()
      .start()
      .catch(() => {});
  }, [isLoaded]);

  const handleComplete = useCallback(() => {
    BackHandler.exitApp();
  }, []);

  if (!isLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider systemColorSchemeOverride={systemTheme}>
        <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
        <QuickTileLoadingScreen onLoadingComplete={handleComplete} overlayMode />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
