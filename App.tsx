import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  StyleSheet,
  Linking,
  ToastAndroid,
  StatusBar,
  View,
  Platform,
  AppState,
} from 'react-native';
import { useEffect, useState } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { QuickTileLoadingScreen } from './src/screens/QuickTileLoadingScreen';
import { ShareReceiveScreen } from './src/screens/ShareReceiveScreen';
import { ProcessTextScreen } from './src/screens/ProcessTextScreen';
import { useSettingsStore, useHistoryStore } from './src/stores';
import { applyLanguagePreference } from './src/i18n/useAppLanguage';
import { initLogger, setLogLevel } from './src/support/observability';
import { useTheme } from './src/hooks/useTheme';
import { setDynamicShortcuts } from 'shortcut';
import { moveTaskToBack, setExcludeFromRecents } from 'android-util';
import { getAppRuntime } from './src/app/runtime/composition';
import { historyStorage } from './src/features/history';
import { startAppGroupSync } from './src/platform/app-group';
import { startNetworkContextMonitor } from './src/platform/network';
import { resumeOutboundShareHandoffs } from './src/features/transfer';
import { startPostHogAnalytics, stopPostHogAnalytics } from './src/support/observability';

const QUICK_UPLOAD_URL = 'uniclipboard://quick-upload';
const PROCESS_TEXT_URL = 'uniclipboard://process-text';
function parseProcessTextUrl(url: string | null): string | null {
  if (!url || !url.startsWith(PROCESS_TEXT_URL)) return null;
  try {
    return new URL(url).searchParams.get('text');
  } catch {
    return null;
  }
}

function parseQuickUploadUrl(url: string | null): {
  isQuickUpload: boolean;
  fromForeground: boolean;
} {
  if (!url) return { isQuickUpload: false, fromForeground: false };
  return {
    isQuickUpload: url.startsWith(QUICK_UPLOAD_URL),
    fromForeground: url.includes('fg=1'),
  };
}

function debugUrlLabel(url: string | null): string {
  if (!url) return 'null';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

function isShareIntentUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'expo-sharing';
  } catch {
    return false;
  }
}

type AppMode = 'checking' | 'home';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('checking');
  // 快速操作覆盖层：始终以 overlay 形式显示，不卸载 AppNavigator/HomeScreen
  const [shareReceiveOverlay, setShareReceiveOverlay] = useState(false);
  const [processTextOverlay, setProcessTextOverlay] = useState<string | null>(null);
  const [quickActionOverlay, setQuickActionOverlay] = useState<{
    exitAfterSync: boolean;
  } | null>(null);
  const { config, loadConfig, isLoaded } = useSettingsStore();
  const isInitialHistoryLoadComplete = useHistoryStore((state) => state.isInitialLoadComplete);

  useEffect(() => {
    initLogger();
    setDynamicShortcuts();
  }, []);

  useEffect(() => {
    void startPostHogAnalytics().catch(() => undefined);
    return () => {
      void stopPostHogAnalytics().catch(() => undefined);
    };
  }, []);

  // Start the local history query before settings, networking, and navigation finish loading.
  useEffect(() => {
    const history = useHistoryStore.getState();
    history.setSort({ field: 'lastAccessed', order: 'desc' });
    void history.loadItems();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // config 加载后将持久化的日志级别同步给 logger（initLogger 默认 info，
  // 此处用用户在设置页选择的级别覆盖，使其在重启后依然生效）
  useEffect(() => {
    if (config?.logLevel) {
      setLogLevel(config.logLevel);
    }
  }, [config?.logLevel]);

  // config 加载后应用用户的语言偏好（i18n 初始化时默认取系统语言，此处按持久化偏好覆盖，
  // 'system' 仍跟随系统）。
  useEffect(() => {
    if (config?.language) {
      applyLanguagePreference(config.language);
    }
  }, [config?.language]);

  useEffect(() => {
    if (config?.language !== 'system') return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyLanguagePreference('system');
    });
    return () => subscription.remove();
  }, [config?.language]);

  useEffect(() => {
    if (!isLoaded) return;
    return startAppGroupSync();
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    return startNetworkContextMonitor();
  }, [isLoaded]);

  // 首批历史提交到界面后，再启动同步和旧数据整理，避免冷启动时争抢本地存储。
  useEffect(() => {
    if (!isLoaded || !isInitialHistoryLoadComplete) return;

    let cancelled = false;
    let startupPromise: Promise<void> | null = null;
    let servicesStarted = false;
    let maintenanceComplete = false;
    let handoffResumeComplete = false;
    let historyReloadComplete = false;
    const runStartupWork = () => {
      if (
        startupPromise ||
        (servicesStarted && historyReloadComplete) ||
        AppState.currentState !== 'active'
      )
        return;
      startupPromise = (async () => {
        if (!servicesStarted) {
          try {
            await getAppRuntime().start();
            servicesStarted = true;
          } catch {
            // Individual services report their own failures; history maintenance can still proceed.
          }
        }

        if (cancelled || AppState.currentState !== 'active') return;
        if (!maintenanceComplete) {
          await historyStorage.runStartupMaintenance();
          maintenanceComplete = true;
        }
        if (cancelled || AppState.currentState !== 'active') return;
        if (!handoffResumeComplete) {
          await resumeOutboundShareHandoffs();
          handoffResumeComplete = true;
        }
        if (cancelled || AppState.currentState !== 'active') return;
        if (!historyReloadComplete) {
          await useHistoryStore.getState().loadItems();
          historyReloadComplete = true;
        }
      })().finally(() => {
        startupPromise = null;
      });
    };

    runStartupWork();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runStartupWork();
    });

    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, [isInitialHistoryLoadComplete, isLoaded]);

  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android' || !config?.hideFromRecents) return;
    setExcludeFromRecents(true);
  }, [config?.hideFromRecents, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;

    // Cold start: app launched via URL scheme
    Linking.getInitialURL().then((url) => {
      if (config?.debugUrlScheme && Platform.OS === 'android') {
        ToastAndroid.show(`getInitialURL: ${debugUrlLabel(url)}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        setAppMode('home');
        setShareReceiveOverlay(true);
        return;
      }
      const processText = parseProcessTextUrl(url);
      if (processText) {
        setAppMode('home');
        setProcessTextOverlay(processText);
        return;
      }
      const { isQuickUpload, fromForeground } = parseQuickUploadUrl(url);
      // 始终进入 home 模式（挂载 AppNavigator/HomeScreen 以启动后台任务）
      setAppMode('home');
      if (isQuickUpload) {
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ exitAfterSync: !fromForeground });
      }
    });

    // Hot start: app already running, receives URL deep link event
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (config?.debugUrlScheme && Platform.OS === 'android') {
        ToastAndroid.show(`addEventListener url: ${debugUrlLabel(url)}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        setShareReceiveOverlay(true);
        return;
      }
      const processText = parseProcessTextUrl(url);
      if (processText) {
        setProcessTextOverlay(processText);
        return;
      }
      const { isQuickUpload, fromForeground } = parseQuickUploadUrl(url);
      if (isQuickUpload) {
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ exitAfterSync: !fromForeground });
      }
    });

    return () => urlSub.remove();
  }, [isLoaded, config?.debugUrlScheme]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <ThemedStatusBar />
        {appMode === 'checking' ? null : <AppNavigator />}
        {shareReceiveOverlay && (
          <View style={StyleSheet.absoluteFill}>
            <ShareReceiveScreen
              onComplete={(returnToSource) => {
                // 先关 overlay 露出底层主界面。
                setShareReceiveOverlay(false);
                // 外部 app（相册/浏览器/文件等）发起的分享 → moveTaskToBack 把 task 退到后台，
                // 系统显示 task 栈中 UniClip 下方的来源 app，符合「分享目标」的标准行为。
                // 截图等系统 UI 发起的分享 → returnToSource=false，留在 app 内
                //（这类分享 moveTaskToBack 会退到桌面，体验差）。
                // 用 moveTaskToBack 而非 exitApp，保持 Activity 存活以维持后台同步任务。
                if (returnToSource) {
                  moveTaskToBack();
                }
              }}
            />
          </View>
        )}
        {quickActionOverlay && (
          <View style={StyleSheet.absoluteFill}>
            <QuickTileLoadingScreen
              onLoadingComplete={() => {
                const shouldExit = quickActionOverlay.exitAfterSync;
                setQuickActionOverlay(null);
                if (shouldExit) {
                  // 使用 moveTaskToBack 而非 exitApp，保持 Activity 存活以维持后台任务
                  moveTaskToBack();
                }
              }}
              overlayMode
            />
          </View>
        )}
        {processTextOverlay && (
          <View style={StyleSheet.absoluteFill}>
            <ProcessTextScreen
              text={processTextOverlay}
              onComplete={() => {
                setProcessTextOverlay(null);
                // 使用 moveTaskToBack 而非 exitApp，保持 Activity 存活以维持后台任务
                moveTaskToBack();
              }}
            />
          </View>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStatusBar() {
  const { theme } = useTheme();
  return (
    <StatusBar
      barStyle={theme.isDark ? 'light-content' : 'dark-content'}
      backgroundColor={theme.colors.surface}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
