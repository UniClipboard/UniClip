import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, Linking, ToastAndroid, StatusBar, View, Platform, Alert } from 'react-native';
import { useEffect, useState } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { navigateWhenReady } from './src/navigation/navigationRef';
import { QuickTileLoadingScreen } from './src/screens/QuickTileLoadingScreen';
import { ShareReceiveScreen } from './src/screens/ShareReceiveScreen';
import { ProcessTextScreen } from './src/screens/ProcessTextScreen';
import { SyncDirection } from './src/types/sync';
import { useSettingsStore, usePendingConnectStore } from './src/stores';
import i18n from './src/i18n';
import { applyLanguagePreference } from './src/i18n/useAppLanguage';
import { initLogger, setLogLevel } from './src/services/Logger';
import { useTheme } from './src/hooks/useTheme';
import { setDynamicShortcuts } from 'shortcut';
import { moveTaskToBack, setExcludeFromRecents } from 'android-util';
import { getBackgroundServiceManager } from './src/services/BackgroundServiceManager';
import { startAppGroupSync } from './src/services/appGroupSync';
import { startNetworkContextMonitor } from './src/services/networkContext';
import {
  parseConnectUri,
  CONNECT_URI_ERROR_MESSAGES,
  CONNECT_URI_SCHEME,
  CONNECT_URI_HOST,
} from './src/utils/connectUri';

const QUICK_UPLOAD_URL = 'uniclipboard://quick-upload';
const QUICK_DOWNLOAD_URL = 'uniclipboard://quick-download';
const PROCESS_TEXT_URL = 'uniclipboard://process-text';
const CONNECT_URL_PREFIX = `${CONNECT_URI_SCHEME}://${CONNECT_URI_HOST}`;

/**
 * 检测并处理 uniclipboard://connect 接入凭据 URI。
 * 解析成功 → 写入 pendingConnectStore + 导航到服务器配置页，由 ServerModals(Android) /
 * SettingsScreen(iOS) 消费凭据弹出预填表单。
 * 解析失败 → 弹 Alert 提示错误文案。
 *
 * 安全：本函数绝不 log URI 原文或 payload。
 * 返回值：true 表示本 URL 是 connect URI（无论成败，主流程应短路）。
 */
function handleConnectUrlIfMatched(url: string | null | undefined): boolean {
  if (!url || !url.startsWith(CONNECT_URL_PREFIX)) return false;
  const parsed = parseConnectUri(url);
  if (!parsed.ok) {
    console.log(`[QR][deeplink] failed: ${parsed.error}`);
    Alert.alert(i18n.t('connect:scanFailed'), CONNECT_URI_ERROR_MESSAGES[parsed.error]);
    return true;
  }
  console.log('[QR][deeplink] succeeded');
  usePendingConnectStore.getState().set({
    url: parsed.value.url,
    urls: parsed.value.urls.length > 0 ? parsed.value.urls : undefined,
    user: parsed.value.user,
    pwd: parsed.value.pwd,
    ...(parsed.value.label !== undefined ? { label: parsed.value.label } : {}),
  });
  // iOS 走 BottomSheet（SettingsScreen.ios 的内部子页），导航到 Settings 即可，凭据由其自身消费；
  // Android 直达同步子页 SettingsSub{sync}——ServerModals 只在此挂载，是唯一消费 pendingConnect 的地方。
  if (Platform.OS === 'ios') {
    navigateWhenReady('Settings');
  } else {
    navigateWhenReady('SettingsSub', { section: 'sync' });
  }
  return true;
}

function parseProcessTextUrl(url: string | null): string | null {
  if (!url || !url.startsWith(PROCESS_TEXT_URL)) return null;
  try {
    return new URL(url).searchParams.get('text');
  } catch {
    return null;
  }
}

function parseQuickTileUrl(url: string | null): {
  isQuickTile: boolean;
  fromForeground: boolean;
  direction: SyncDirection;
} {
  if (!url) return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
  const fromForeground = url.includes('fg=1');
  // Check upload first — its URL is a superset of the download prefix
  if (url.startsWith(QUICK_UPLOAD_URL))
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Upload };
  if (url.startsWith(QUICK_DOWNLOAD_URL))
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Download };
  return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
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
    direction: SyncDirection;
    exitAfterSync: boolean;
  } | null>(null);
  const { config, loadConfig, isLoaded } = useSettingsStore();

  useEffect(() => {
    initLogger();
    setDynamicShortcuts();
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
    if (!isLoaded) return;
    return startAppGroupSync();
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    return startNetworkContextMonitor();
  }, [isLoaded]);

  // 启动所有服务（冷启动时保证剪贴板监控、远程同步、后台任务正常运行，后续由 BackgroundServiceManager 维护）
  useEffect(() => {
    if (!isLoaded) return;
    getBackgroundServiceManager()
      .start()
      .catch(() => {});
    // 应用启动时恢复「最近任务隐藏」设置（仅 Android）
    if (Platform.OS === 'android' && config?.hideFromRecents) {
      setExcludeFromRecents(true);
    }
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;

    // Cold start: app launched via URL scheme
    Linking.getInitialURL().then((url) => {
      if (config?.debugUrlScheme && Platform.OS === 'android') {
        const safeForDebug =
          url && url.startsWith(CONNECT_URL_PREFIX) ? `${CONNECT_URL_PREFIX}?<redacted>` : url;
        ToastAndroid.show(`getInitialURL: ${safeForDebug ?? 'null'}`, ToastAndroid.LONG);
      }
      // connect URI 优先短路，进 home 模式让 SettingsScreen 挂载
      if (handleConnectUrlIfMatched(url)) {
        setAppMode('home');
        return;
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
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      // 始终进入 home 模式（挂载 AppNavigator/HomeScreen 以启动后台任务）
      setAppMode('home');
      if (isQuickTile) {
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ direction, exitAfterSync: !fromForeground });
      }
    });

    // Hot start: app already running, receives URL deep link event
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (config?.debugUrlScheme && Platform.OS === 'android') {
        const safeForDebug =
          url && url.startsWith(CONNECT_URL_PREFIX) ? `${CONNECT_URL_PREFIX}?<redacted>` : url;
        ToastAndroid.show(`addEventListener url: ${safeForDebug ?? 'null'}`, ToastAndroid.LONG);
      }
      if (handleConnectUrlIfMatched(url)) {
        return;
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
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      if (isQuickTile) {
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ direction, exitAfterSync: !fromForeground });
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
              direction={quickActionOverlay.direction}
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
