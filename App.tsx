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
import { ShareReceiveRedirector } from './src/screens/ShareReceiveRedirector';
import { ProcessTextScreen } from './src/screens/ProcessTextScreen';
import { useSettingsStore, useHistoryStore } from './src/stores';
import { applyLanguagePreference } from './src/i18n/useAppLanguage';
import { initLogger, setLogLevel } from './src/support/observability';
import { useTheme } from './src/hooks/useTheme';
import { setDynamicShortcuts } from 'shortcut';
import { moveTaskToBack, setExcludeFromRecents } from 'android-util';
import { configureAppRuntime, getAppRuntime } from './src/app/runtime/composition';
import { historyStorage } from './src/features/history';
import { startAppGroupSync } from './src/platform/app-group';
import { startNetworkContextMonitor } from './src/platform/network';
import { startPostHogAnalytics, stopPostHogAnalytics } from './src/support/observability';
import { getSpaceSetupCompletion } from './src/features/space';
import { useShareSheetStore } from './src/stores/shareSheetStore';
import { DeviceTrustDecision } from './src/components/DeviceTrustDecision';
import { DeviceTrustNotificationObserver } from './src/components/DeviceTrustNotificationObserver';

const QUICK_UPLOAD_URL = 'uniclipboard://quick-upload';
const PROCESS_TEXT_URL = 'uniclipboard://process-text';
const SHARE_URLS = ['uniclipboard://share', 'uniclipboard-dev://share'];
function isShareUrl(url: string | null): boolean {
  return url != null && SHARE_URLS.some((scheme) => url.startsWith(scheme));
}
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
  const [shareReceiveOverlay, setShareReceiveOverlay] = useState<number | null>(null);
  const [processTextOverlay, setProcessTextOverlay] = useState<string | null>(null);
  const [quickActionOverlay, setQuickActionOverlay] = useState<{
    exitAfterSync: boolean;
  } | null>(null);
  const { config, loadConfig, isLoaded } = useSettingsStore();
  const isInitialHistoryLoadComplete = useHistoryStore((state) => state.isInitialLoadComplete);

  useEffect(() => {
    configureAppRuntime();
    initLogger();
    setDynamicShortcuts();
  }, []);

  useEffect(() => {
    const completion = getSpaceSetupCompletion();
    void completion.load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void completion.retryPendingWrite();
    });
    return () => subscription.remove();
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

  // A Share extension can update the shared iOS history while this process is
  // backgrounded. Refresh the visible list whenever the user returns to the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useHistoryStore.getState().loadItems();
    });
    return () => subscription.remove();
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

  // 引擎与首屏历史并行启动:设置加载完成后立即恢复空间(前台时),让
  // “我的空间”的名单在用户打开面板前尽可能就绪。历史维护仍等首屏历史完成。
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    let servicesStarted = false;
    const startServices = () => {
      if (cancelled || servicesStarted || AppState.currentState !== 'active') return;
      servicesStarted = true;
      getAppRuntime()
        .start()
        .catch(() => {
          servicesStarted = false;
        });
    };
    startServices();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') startServices();
    });
    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, [isLoaded]);

  // 首批历史提交到界面后,再启动旧数据整理,避免冷启动时争抢本地存储。
  useEffect(() => {
    if (!isLoaded || !isInitialHistoryLoadComplete) return;

    let cancelled = false;
    let startupPromise: Promise<void> | null = null;
    let maintenanceComplete = false;
    let historyReloadComplete = false;
    const runStartupWork = () => {
      if (startupPromise || historyReloadComplete || AppState.currentState !== 'active') return;
      startupPromise = (async () => {
        if (cancelled || AppState.currentState !== 'active') return;
        if (!maintenanceComplete) {
          await historyStorage.runStartupMaintenance();
          maintenanceComplete = true;
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
        setShareReceiveOverlay(useShareSheetStore.getState().beginParsing());
        return;
      }
      if (isShareUrl(url)) {
        // iOS 哑扩展暂存完成后的唤醒:打开分享弹层(冷启动)
        setAppMode('home');
        useShareSheetStore.getState().open();
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
        setShareReceiveOverlay(useShareSheetStore.getState().beginParsing());
        return;
      }
      if (isShareUrl(url)) {
        // iOS 哑扩展暂存完成后的唤醒:打开分享弹层(热启动)
        useShareSheetStore.getState().open();
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
        <DeviceTrustNotificationObserver />
        {appMode === 'checking' ? null : <AppNavigator />}
        {shareReceiveOverlay !== null && (
          <View style={StyleSheet.absoluteFill}>
            <ShareReceiveRedirector
              key={shareReceiveOverlay}
              sessionId={shareReceiveOverlay}
              onComplete={() => {
                setShareReceiveOverlay((current) =>
                  current === shareReceiveOverlay ? null : current
                );
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
        <DeviceTrustDecision />
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
