/**
 * 设置页面
 * 提供主题切换功能、服务器配置、多用户切换
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  Platform,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import {
  Host,
  Column,
  Row,
  Card,
  ListItem,
  Switch as ComposeSwitch,
  HorizontalDivider,
  Button,
  TextButton,
  OutlinedButton,
  AlertDialog,
  ModalBottomSheet,
  Spacer,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  paddingAll,
  width as widthModifier,
  height as heightModifier,
  clickable,
} from '@expo/ui/jetpack-compose/modifiers';
import { APP_VERSION } from '@/constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore, usePendingConnectStore } from '@/stores';
import { ServerConfigModal, ServerListItem, QrScannerModal } from '@/components';
import { ServerConfig } from '@/types/api';
import { settingsStyles as styles } from './settings/settingsStyles';
import { SettingsToastProvider, useSettingsToast } from './settings/SettingsToastContext';
import { SyncSettingsSection } from './settings/SyncSettingsSection';
import { QuickActionsSection } from './settings/QuickActionsSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { DebugSection } from './settings/DebugSection';
import { HistorySection } from './settings/HistorySection';
import { StorageSection } from './settings/StorageSection';
import { LogSection } from './settings/LogSection';
import {
  checkForUpdate,
  getPreferredAbi,
  findAssetForAbi,
  checkApkCache,
  downloadApk,
  installApk,
  cleanOldApkCache,
  type ReleaseAssetInfo,
  type ApkSource,
} from '@/services';
import { Plus, RefreshCw, ChevronDown, ChevronUp } from 'react-native-feather';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import {
  isShizukuAvailable,
  hasShizukuPermission,
  requestShizukuPermission,
} from 'shizuku-clipboard';
const SettingsScreenInner = () => {
  const { theme } = useTheme();
  const {
    config,
    isLoaded,
    loadConfig,
    addServer,
    updateServer,
    deleteServer,
    setActiveServer,
    updateConfig,
    setAutoCheckUpdate,
    setLastUpdateCheckDate,
    setUpdateToBeta,
    setEnableBackgroundDownload,
    setEnableBackgroundUpload,
    setEnableClipboardOverlay,
    setEnableBackgroundTasks,
    setEnableSmsForwarding,
    setEnableShizukuClipboard,
    isTempDisabledBackgroundTasks,
    setTempDisabledBackgroundTasks,
  } = useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const [serversCollapsed, setServersCollapsed] = useState(true);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [prefillFromScan, setPrefillFromScan] = useState<ServerConfig | null>(null);
  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const pendingConnectIntent = usePendingConnectStore((s) => s.intent);
  const showMessage = useSettingsToast();

  // 本地状态用于跟踪Switch的当前值，避免闪烁
  const [localAutoCheckUpdateEnabled, setLocalAutoCheckUpdateEnabled] = useState(
    config?.autoCheckUpdate ?? true
  );
  const [localUpdateToBetaEnabled, setLocalUpdateToBetaEnabled] = useState(
    config?.updateToBeta ?? false
  );
  const [localBackgroundDownloadEnabled, setLocalBackgroundDownloadEnabled] = useState(
    config?.enableBackgroundDownload ?? false
  );
  const [localBackgroundUploadEnabled, setLocalBackgroundUploadEnabled] = useState(
    config?.enableBackgroundUpload ?? false
  );
  const [localBackgroundTasksEnabled, setLocalBackgroundTasksEnabled] = useState(
    (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
  );
  const [localClipboardOverlayEnabled, setLocalClipboardOverlayEnabled] = useState(
    config?.enableClipboardOverlay ?? false
  );
  const [localShizukuClipboardEnabled, setLocalShizukuClipboardEnabled] = useState(
    config?.enableShizukuClipboard ?? false
  );
  const [localSmsForwardingEnabled, setLocalSmsForwardingEnabled] = useState(
    config?.enableSmsForwarding ?? false
  );
  const [localForegroundNotification, setLocalForegroundNotification] = useState(
    config?.enableForegroundNotification ?? true
  );

  // AlertDialog / ModalBottomSheet 可见性状态
  const [showShizukuUnavailableDialog, setShowShizukuUnavailableDialog] = useState(false);
  const [showBatteryOptDialog, setShowBatteryOptDialog] = useState(false);
  const [showAddServerSheet, setShowAddServerSheet] = useState(false);
  const [showCancelDownloadDialog, setShowCancelDownloadDialog] = useState(false);
  const [downloadSourceSheet, setDownloadSourceSheet] = useState<{
    version: string;
    assets: ReleaseAssetInfo[];
    releaseNotes?: string;
  } | null>(null);

  // 更新检查状态
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // APK 下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const latestAssetsRef = useRef<ReleaseAssetInfo[]>([]);
  const latestTagRef = useRef<string>('');
  const releaseNotesRef = useRef<string | undefined>(undefined);

  const appVersion = APP_VERSION;

  // 延迟挂载重内容：本页含 ~11 个独立的 Jetpack Compose Host（ComposeView），
  // 若在导航转场动画期间同步挂载会占满 JS 线程导致进入卡顿。
  // 先渲染轻量占位，待转场动画结束（runAfterInteractions）后再挂载真正的设置项。
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    // runAfterInteractions 语义即「等转场动画结束后执行」，正是此处所需（startTransition
    // 不会等动画结束，requestAnimationFrame 只等一帧不足以覆盖整个转场）。
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const task = InteractionManager.runAfterInteractions(() => {
      setContentReady(true);
    });
    return () => task.cancel();
  }, []);

  // 加载配置
  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 当配置中的autoCheckUpdate值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoCheckUpdateEnabled(config?.autoCheckUpdate ?? true);
  }, [config?.autoCheckUpdate]);

  useEffect(() => {
    setLocalUpdateToBetaEnabled(config?.updateToBeta ?? false);
  }, [config?.updateToBeta]);

  useEffect(() => {
    setLocalBackgroundDownloadEnabled(config?.enableBackgroundDownload ?? false);
  }, [config?.enableBackgroundDownload]);

  useEffect(() => {
    setLocalBackgroundUploadEnabled(config?.enableBackgroundUpload ?? false);
  }, [config?.enableBackgroundUpload]);

  useEffect(() => {
    setLocalBackgroundTasksEnabled(
      (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
    );
  }, [config?.enableBackgroundTasks, isTempDisabledBackgroundTasks]);

  useEffect(() => {
    setLocalClipboardOverlayEnabled(config?.enableClipboardOverlay ?? false);
  }, [config?.enableClipboardOverlay]);

  useEffect(() => {
    setLocalShizukuClipboardEnabled(config?.enableShizukuClipboard ?? false);
  }, [config?.enableShizukuClipboard]);

  useEffect(() => {
    setLocalSmsForwardingEnabled(config?.enableSmsForwarding ?? false);
  }, [config?.enableSmsForwarding]);

  useEffect(() => {
    setLocalForegroundNotification(config?.enableForegroundNotification ?? true);
  }, [config?.enableForegroundNotification]);

  // 刷新权限状态
  const refreshPermissions = async () => {
    if (Platform.OS !== 'android') return;
    setIsRefreshingPermissions(true);
    try {
      const { PermissionsAndroid } = require('react-native');
      const [notif, sms] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
      ]);
      setPermNotification(notif);
      setPermOverlay(hasOverlayPermission());
      setPermSms(sms);
      const { isIgnoringBatteryOptimizations } = await import('native-util');
      setPermBattery(isIgnoringBatteryOptimizations());
      const shizukuUp = isShizukuAvailable();
      setShizukuAvailable(shizukuUp);
      setPermShizuku(shizukuUp && hasShizukuPermission());
    } catch (e) {
      console.warn('[Settings] Failed to check permissions:', e);
    } finally {
      setIsRefreshingPermissions(false);
    }
  };

  useEffect(() => {
    refreshPermissions();
  }, []);

  // 自动检查更新（每天一次）
  useEffect(() => {
    if (!isLoaded) return;
    if (!(config?.autoCheckUpdate ?? true)) return;
    (async () => {
      const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
      const runtimeState = await runtimeStateStorage.load();
      const today = new Date().toISOString().slice(0, 10);
      if (
        !(config?.debugUpdateCheckNoLimit ?? false) &&
        runtimeState.lastUpdateCheckDate === today
      )
        return;
      runUpdateCheck(false, config?.updateToBeta ?? false);
    })();
  }, [isLoaded]);

  // 获取服务器列表
  const servers = config?.servers || [];
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServer = activeServerIndex >= 0 ? servers[activeServerIndex] : null;

  // 权限状态
  const [permNotification, setPermNotification] = useState<boolean>(false);
  const [permOverlay, setPermOverlay] = useState<boolean>(false);
  const [permSms, setPermSms] = useState<boolean>(false);
  const [permBattery, setPermBattery] = useState<boolean>(false);
  const [permShizuku, setPermShizuku] = useState<boolean>(false);
  const [shizukuAvailable, setShizukuAvailable] = useState<boolean>(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState<boolean>(false);
  const hasBatteryOptRequested = useRef<boolean>(false);

  // 打开手动表单（新建态）
  const openManualAddForm = () => {
    setEditingServerIndex(null);
    setPrefillFromScan(null);
    setShowServerModal(true);
  };

  // 用扫码/深链解析出的凭据预填表单
  const openPrefilledAddForm = (config: ServerConfig) => {
    setEditingServerIndex(null);
    setPrefillFromScan(config);
    setShowServerModal(true);
  };

  // 检查 pendingConnectStore，有数据就打开预填表单
  const tryConsumePendingConnect = () => {
    const intent = consumePendingConnect();
    if (!intent) return false;
    openPrefilledAddForm({
      type: 'syncclipboard',
      url: intent.url,
      urls: intent.urls,
      username: intent.user,
      password: intent.pwd,
      ...(intent.label ? { name: intent.label } : {}),
    });
    return true;
  };

  // 处理添加服务器 — 让用户选「扫码 / 手动」
  const handleAddServer = () => {
    setShowAddServerSheet(true);
  };

  // ScannerModal 关闭：只关闭，consume 由下面的 useEffect 统一处理
  const handleScannerClose = () => {
    setShowScannerModal(false);
  };

  // 统一的 consume 时机：pendingIntent 出现且无其它 modal 打开时
  // 覆盖三个来源：1) 扫码 modal 成功扫到后关闭；2) 深链冷启动（intent 在 Settings 挂载前就被 set）；
  // 3) 深链热启动（intent 在 Settings 已挂载时被 set）。
  // 若用户正在编辑/扫码，intent 留在 store 里，等用户关闭当前 modal 后下一帧再处理。
  useEffect(() => {
    if (pendingConnectIntent && !showServerModal && !showScannerModal) {
      tryConsumePendingConnect();
    }
  }, [pendingConnectIntent, showServerModal, showScannerModal]);

  // 处理编辑服务器
  const handleEditServer = (index: number) => {
    setEditingServerIndex(index);
    setShowServerModal(true);
  };

  // 处理保存服务器
  const handleSaveServer = async (serverConfig: ServerConfig) => {
    try {
      if (editingServerIndex !== null) {
        await updateServer(editingServerIndex, serverConfig);
        showMessage('服务器配置已更新', 'success');
      } else {
        await addServer(serverConfig);
        showMessage('服务器已添加', 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  // 处理删除服务器
  const handleDeleteServer = async (index: number) => {
    try {
      await deleteServer(index);
      showMessage('服务器已删除', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  // 处理切换激活服务器
  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) {
      if (servers.length > 1) {
        setServersCollapsed(true);
      }
      return;
    }

    if (servers.length > 1) {
      setServersCollapsed(true);
    }

    try {
      const { getHistorySyncService } = await import('@/services/HistorySyncService');
      const syncService = getHistorySyncService();
      syncService.cancelAll();
    } catch {
      // ignore
    }

    try {
      await setActiveServer(index);
      const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
      await runtimeStateStorage.update({ needsHistoryReorganize: true });
      showMessage('已切换服务器', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '切换失败', 'error');
    }
  };

  // 处理切换后台任务总开关
  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    if (enabled) {
      // 如果是临时停止状态，直接清除标志，不需要弹窗确认
      if (isTempDisabledBackgroundTasks) {
        setLocalBackgroundTasksEnabled(true);
        setTempDisabledBackgroundTasks(false);
        showMessage('已恢复后台任务', 'success');
        return;
      }
      Alert.alert(
        '开启后台任务',
        '启用后台任务后，应用将在后台持续运行相关服务，大幅增加电量消耗，强烈建议按需开启。\n\n如有需要，可以在系统设置中将 UniClip 的电池优化设为「不受限制」，并在多任务界面锁定 UniClip，减少系统关闭后台任务的概率。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认开启',
            onPress: async () => {
              setLocalBackgroundTasksEnabled(true);
              try {
                await setEnableBackgroundTasks(true);
                showMessage('已启用后台任务', 'success');
              } catch (error: unknown) {
                setLocalBackgroundTasksEnabled(false);
                showMessage(error instanceof Error ? error.message : '设置失败', 'error');
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundTasksEnabled(false);
    try {
      await setEnableBackgroundTasks(false);
      showMessage('已禁用后台任务', 'success');
    } catch (error: unknown) {
      setLocalBackgroundTasksEnabled(true);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换后台下载远程
  const handleToggleBackgroundDownload = async (enabled: boolean) => {
    if (enabled) {
      setLocalBackgroundDownloadEnabled(true);
      try {
        await setEnableBackgroundDownload(true);
        showMessage('已启用后台下载远程', 'success');
      } catch (error: unknown) {
        setLocalBackgroundDownloadEnabled(false);
        showMessage(error instanceof Error ? error.message : '设置失败', 'error');
      }
      return;
    }

    setLocalBackgroundDownloadEnabled(false);
    try {
      await setEnableBackgroundDownload(false);
      showMessage('已禁用后台下载远程', 'success');
    } catch (error: unknown) {
      setLocalBackgroundDownloadEnabled(true);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换后台上传本地
  const handleToggleBackgroundUpload = async (enabled: boolean) => {
    if (enabled) {
      Alert.alert(
        '开启后台上传本地剪贴板',
        '无需启用此选项，UniClip 也支持从选中文字弹出的菜单直接上传文字。\n\nAndroid 10 及以上的系统，应用在后台无法直接获取本地剪贴板内容，你可能需要启用悬浮窗或使用其他工具绕过此限制。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认开启',
            onPress: async () => {
              setLocalBackgroundUploadEnabled(true);
              try {
                await setEnableBackgroundUpload(true);
                showMessage('已启用后台上传本地', 'success');
              } catch (error: unknown) {
                setLocalBackgroundUploadEnabled(false);
                showMessage(error instanceof Error ? error.message : '设置失败', 'error');
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundUploadEnabled(false);
    try {
      await setEnableBackgroundUpload(false);
      showMessage('已禁用后台上传本地', 'success');
    } catch (error: unknown) {
      setLocalBackgroundUploadEnabled(true);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换悬浮窗获取剪贴板
  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      Alert.alert(
        '启用悬浮窗获取剪贴板',
        '启用后，应用将通过不可见的悬浮窗在后台获取剪贴板内容。这可能导致部分应用因焦点问题产生功能异常以及其他问题。\n\n如果您可以通过其他工具授予 UniClip 后台读取剪贴板的权限，建议关闭此选项。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确定',
            onPress: async () => {
              if (!hasOverlayPermission()) {
                requestOverlayPermission();
                return;
              }
              setLocalClipboardOverlayEnabled(true);
              try {
                await setEnableClipboardOverlay(true);
                showMessage('已启用悬浮窗获取剪贴板', 'success');
              } catch (error: unknown) {
                setLocalClipboardOverlayEnabled(false);
                showMessage(error instanceof Error ? error.message : '设置失败', 'error');
              }
            },
          },
        ]
      );
      return;
    }

    setLocalClipboardOverlayEnabled(enabled);

    try {
      await setEnableClipboardOverlay(enabled);
      showMessage(enabled ? '已启用悬浮窗获取剪贴板' : '已禁用悬浮窗获取剪贴板', 'success');
    } catch (error: unknown) {
      setLocalClipboardOverlayEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换 Shizuku 获取剪贴板
  const handleToggleShizukuClipboard = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      // 检查 Shizuku 是否可用
      if (!isShizukuAvailable()) {
        Alert.alert(
          'Shizuku 未运行',
          '请先安装并启动 Shizuku。\n\n非 Root 设备每次重启后需重新启动 Shizuku（Android 11+ 可通过无线调试自行启动）。',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '了解更多',
              onPress: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
            },
          ]
        );
        return;
      }

      // 检查 Shizuku 权限
      if (!hasShizukuPermission()) {
        const requested = requestShizukuPermission();
        if (!requested) {
          Alert.alert('权限请求失败', '无法请求 Shizuku 权限，请确认 Shizuku 版本支持。');
          return;
        }
        showMessage('请在 Shizuku 弹窗中授予权限后重新启用', 'info');
        return;
      }

      setLocalShizukuClipboardEnabled(true);
      try {
        // 启用 Shizuku 时自动关闭悬浮窗方式
        if (localClipboardOverlayEnabled) {
          setLocalClipboardOverlayEnabled(false);
          await setEnableClipboardOverlay(false);
        }
        await setEnableShizukuClipboard(true);
        showMessage('已启用 Shizuku 获取剪贴板', 'success');
      } catch (error: unknown) {
        setLocalShizukuClipboardEnabled(false);
        showMessage(error instanceof Error ? error.message : '设置失败', 'error');
      }
      return;
    }

    setLocalShizukuClipboardEnabled(enabled);
    try {
      await setEnableShizukuClipboard(enabled);
      showMessage(enabled ? '已启用 Shizuku 获取剪贴板' : '已禁用 Shizuku 获取剪贴板', 'success');
    } catch (error: unknown) {
      setLocalShizukuClipboardEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换自动上传短信验证码
  const handleToggleSmsForwarding = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (!granted) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('需要短信权限', '自动上传验证码需要短信接收权限，请在系统设置中允许', [
            { text: '取消', style: 'cancel' },
            { text: '前往设置', onPress: () => Linking.openSettings() },
          ]);
          return;
        }
      }
    }

    setLocalSmsForwardingEnabled(enabled);
    try {
      await setEnableSmsForwarding(enabled);
      // 同步静态短信接收器状态
      if (Platform.OS === 'android') {
        const { setStaticReceiverEnabled } = await import('sms-forwarder');
        setStaticReceiverEnabled(enabled);
      }
      showMessage(enabled ? '已启用自动上传短信验证码' : '已禁用自动上传短信验证码', 'success');
    } catch (error: unknown) {
      setLocalSmsForwardingEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换前台服务常驻通知
  const handleToggleForegroundNotification = async (enabled: boolean) => {
    if (!enabled) {
      Alert.alert(
        '关闭常驻通知',
        '关闭常驻通知会降低后台服务稳定性，系统终止后台任务的可能性增大。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认关闭',
            onPress: async () => {
              setLocalForegroundNotification(false);
              try {
                await updateConfig({ enableForegroundNotification: false });
              } catch (error: unknown) {
                setLocalForegroundNotification(true);
                showMessage(error instanceof Error ? error.message : '设置失败', 'error');
              }
            },
          },
        ]
      );
      return;
    }

    setLocalForegroundNotification(true);
    try {
      await updateConfig({ enableForegroundNotification: true });
      // 检查通知权限，提示但不阻止
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const granted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        if (!granted) {
          Alert.alert(
            '缺少通知权限',
            '未授予通知权限，常驻通知可能无法显示。建议前往系统设置允许通知权限。',
            [
              { text: '稍后再说', style: 'cancel' },
              { text: '前往设置', onPress: () => Linking.openSettings() },
            ]
          );
        }
      }
    } catch (error: unknown) {
      setLocalForegroundNotification(false);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换自动检查更新
  const handleToggleAutoCheckUpdate = async (enabled: boolean) => {
    setLocalAutoCheckUpdateEnabled(enabled);
    try {
      await setAutoCheckUpdate(enabled);
    } catch (error: unknown) {
      setLocalAutoCheckUpdateEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换更新到测试版
  const handleToggleUpdateToBeta = async (enabled: boolean) => {
    setLocalUpdateToBetaEnabled(enabled);
    try {
      await setUpdateToBeta(enabled);
    } catch (error: unknown) {
      setLocalUpdateToBetaEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 执行更新检查逻辑
  const runUpdateCheck = async (showNoUpdateToast: boolean, includeBeta?: boolean) => {
    setIsCheckingUpdate(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await setLastUpdateCheckDate(today);
      const useBeta = includeBeta ?? config?.updateToBeta ?? false;
      const result = await checkForUpdate(appVersion, useBeta);
      if (result.hasUpdate) {
        setUpdateAvailable(true);
        setLatestVersion(result.latestVersion);
        latestAssetsRef.current = result.assets;
        latestTagRef.current = result.tagName;
        releaseNotesRef.current = result.releaseNotes;
        showDownloadSourceDialog(result.latestVersion, result.assets, result.releaseNotes);
      } else {
        setUpdateAvailable(false);
        setLatestVersion(null);
        if (showNoUpdateToast) {
          showMessage('当前已是最新版本', 'success');
        }
      }
      // 无论是否有更新，清除当前版本及旧版本的 APK 缓存
      cleanOldApkCache(appVersion);
    } catch {
      if (showNoUpdateToast) {
        showMessage('检查更新失败，请检查网络连接', 'error');
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 点击"更新"按钮：先检查缓存，有则直接安装，否则弹渠道选择
  const handleUpdateButtonPress = async (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    if (isDownloading) return;

    let preferredAbi: string = 'universal';
    try {
      const { getSupportedAbis } = await import('native-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    if (!asset) {
      showDownloadSourceDialog(version, assets, releaseNotes);
      return;
    }

    const cached = await checkApkCache(version, asset);
    console.log(`[UpdateDownload] pre-check cache=${cached ?? 'miss'}`);
    if (cached) {
      await installApk(cached);
    } else {
      showDownloadSourceDialog(version, assets, releaseNotes);
    }
  };

  // 弹出选择下载渠道的对话框
  const showDownloadSourceDialog = (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    setDownloadSourceSheet({ version, assets, releaseNotes });
  };

  // 下载 APK
  const handleDownloadApk = async (
    source: ApkSource,
    version: string,
    assets: ReleaseAssetInfo[]
  ) => {
    if (isDownloading) return;

    // 检测设备 ABI
    let preferredAbi: string = 'universal';
    try {
      const { getSupportedAbis } = await import('native-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
      console.log(
        `[UpdateDownload] supportedAbis=${JSON.stringify(abis)} preferred=${preferredAbi}`
      );
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    console.log(
      `[UpdateDownload] source=${source} version=${version} assets=${assets.map((a) => a.name).join(',')} selectedAsset=${asset?.name ?? 'none'}`
    );
    if (!asset) {
      showMessage('找不到适合当前设备的 APK', 'error');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    const abortController = new AbortController();
    downloadAbortRef.current = abortController;

    try {
      // 检查是否已有缓存
      const cached = await checkApkCache(version, asset);
      console.log(`[UpdateDownload] cache check result=${cached ?? 'miss'}`);
      if (cached) {
        await installApk(cached);
        return;
      }

      const fileUri = await downloadApk({
        asset,
        source,
        version,
        signal: abortController.signal,
        onProgress: (info) => {
          setDownloadProgress(info.progress);
        },
      });

      console.log(`[UpdateDownload] download finished fileUri=${fileUri}`);
      setUpdateAvailable(false);
      setLatestVersion(null);
      await installApk(fileUri);
    } catch (err) {
      console.error('[UpdateDownload] error:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        showMessage('已取消下载', 'info');
      } else {
        showMessage(err instanceof Error ? err.message : '下载失败', 'error');
      }
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
      downloadAbortRef.current = null;
    }
  };

  // 取消下载对话框
  const handleCancelDownload = () => {
    setShowCancelDownloadDialog(true);
  };

  // 转场动画进行中先渲染轻量占位，避免在动画期间同步挂载 ~11 个 Compose Host 导致进入卡顿。
  if (!contentReady) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        edges={[]}
      >
        <View style={styles.loadingPlaceholder}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView style={styles.scrollView}>
        {/* 服务器配置部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <TouchableOpacity
              style={styles.sectionTitleContainer}
              onPress={() => servers.length > 1 && setServersCollapsed(!serversCollapsed)}
              disabled={servers.length <= 1}
            >
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>服务器配置</Text>
              {servers.length > 1 && (
                <View style={styles.collapseIcon}>
                  {serversCollapsed ? (
                    <ChevronDown color={theme.colors.textSecondary} width={18} height={18} />
                  ) : (
                    <ChevronUp color={theme.colors.textSecondary} width={18} height={18} />
                  )}
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleAddServer}>
              <Plus color={theme.colors.primary} width={20} height={20} />
            </TouchableOpacity>
          </View>

          {servers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                还没有配置服务器
              </Text>
              <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
                点击右上角"添加"按钮添加第一个服务器
              </Text>
            </View>
          ) : serversCollapsed && servers.length > 1 ? (
            activeServer && (
              <ServerListItem
                config={activeServer}
                isActive={true}
                onPress={() => {}}
                onEdit={() => handleEditServer(activeServerIndex)}
                onDelete={() => handleDeleteServer(activeServerIndex)}
              />
            )
          ) : (
            servers.map((server, index) => (
              <ServerListItem
                key={index}
                config={server}
                isActive={index === activeServerIndex}
                onPress={() => handleSetActiveServer(index)}
                onEdit={() => handleEditServer(index)}
                onDelete={() => handleDeleteServer(index)}
              />
            ))
          )}
        </View>

        {/* 同步设置部分 */}
        <SyncSettingsSection />

        {/* 历史记录部分 */}
        <HistorySection />

        {/* 后台任务部分 */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderBase}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>后台任务</Text>
            </View>

            <Host matchContents={{ vertical: true }} style={styles.hostFill}>
              <Card colors={{ containerColor: theme.colors.surface }}>
                <Column modifiers={[fillMaxWidth()]}>
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>后台任务</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        {isTempDisabledBackgroundTasks
                          ? '已临时停止，重启 APP 后恢复开启状态'
                          : '关闭后将停止所有后台任务'}
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled}
                        onCheckedChange={handleToggleBackgroundTasks}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.text
                            : theme.colors.textTertiary
                        }
                      >
                        后台服务常驻通知
                      </ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.textSecondary
                            : theme.colors.textTertiary
                        }
                      >
                        启用后会增加后台服务的稳定性
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled && localForegroundNotification}
                        onCheckedChange={handleToggleForegroundNotification}
                        enabled={localBackgroundTasksEnabled}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.text
                            : theme.colors.textTertiary
                        }
                      >
                        后台下载远程
                      </ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled && localBackgroundDownloadEnabled}
                        onCheckedChange={handleToggleBackgroundDownload}
                        enabled={localBackgroundTasksEnabled}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.text
                            : theme.colors.textTertiary
                        }
                      >
                        后台上传本地
                      </ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled && localBackgroundUploadEnabled}
                        onCheckedChange={handleToggleBackgroundUpload}
                        enabled={localBackgroundTasksEnabled}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.text
                            : theme.colors.textTertiary
                        }
                      >
                        后台时通过悬浮窗获取剪贴板
                      </ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled && localClipboardOverlayEnabled}
                        onCheckedChange={handleToggleClipboardOverlay}
                        enabled={localBackgroundTasksEnabled}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText
                        color={
                          localBackgroundTasksEnabled
                            ? theme.colors.text
                            : theme.colors.textTertiary
                        }
                      >
                        后台时通过 Shizuku 获取剪贴板
                      </ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText
                        color={theme.colors.primary}
                        modifiers={[clickable(() => Linking.openURL('https://shizuku.rikka.app/'))]}
                      >
                        前往 Shizuku 官网
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localBackgroundTasksEnabled && localShizukuClipboardEnabled}
                        onCheckedChange={handleToggleShizukuClipboard}
                        enabled={localBackgroundTasksEnabled}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </Column>
              </Card>
            </Host>
          </View>
        )}

        {/* 短信自动化部分 */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderBase}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>短信自动化</Text>
            </View>

            <Host matchContents={{ vertical: true }} style={styles.hostFill}>
              <Card colors={{ containerColor: theme.colors.surface }}>
                <Column modifiers={[fillMaxWidth()]}>
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>自动上传短信验证码</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={localSmsForwardingEnabled}
                        onCheckedChange={handleToggleSmsForwarding}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </Column>
              </Card>
            </Host>
          </View>
        )}

        {/* 权限管理部分 */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>权限管理</Text>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={refreshPermissions}
                disabled={isRefreshingPermissions}
              >
                <RefreshCw color={theme.colors.primary} width={16} height={16} />
              </TouchableOpacity>
            </View>

            <Host matchContents={{ vertical: true }} style={styles.hostFill}>
              <Card colors={{ containerColor: theme.colors.surface }}>
                <Column modifiers={[fillMaxWidth()]}>
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>通知权限</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={permNotification}
                        onCheckedChange={() => Linking.openSettings()}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>悬浮窗权限</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        后台通过悬浮窗获取剪贴板所需
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={permOverlay}
                        onCheckedChange={() => requestOverlayPermission()}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>短信权限</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        自动上传短信验证码所需
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={permSms}
                        onCheckedChange={() => Linking.openSettings()}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>Shizuku 权限</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        {shizukuAvailable
                          ? '后台通过 Shizuku 获取剪贴板所需'
                          : 'Shizuku 未运行，请先启动 Shizuku'}
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={permShizuku}
                        onCheckedChange={() => {
                          if (!shizukuAvailable) {
                            setShowShizukuUnavailableDialog(true);
                            return;
                          }
                          if (!permShizuku) {
                            requestShizukuPermission();
                            // 延迟刷新权限状态（等待用户授权）
                            setTimeout(refreshPermissions, 2000);
                          }
                        }}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>

                  <HorizontalDivider color={theme.colors.divider} />

                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>忽略电池优化</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        防止省电模式中断后台同步
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={permBattery}
                        onCheckedChange={async () => {
                          const { requestIgnoreBatteryOptimizations } = await import('native-util');
                          if (hasBatteryOptRequested.current) {
                            setShowBatteryOptDialog(true);
                            return;
                          }
                          requestIgnoreBatteryOptimizations();
                          hasBatteryOptRequested.current = true;
                        }}
                        colors={{
                          checkedTrackColor: theme.colors.primary,
                          uncheckedTrackColor: theme.colors.divider,
                          checkedThumbColor: theme.colors.surface,
                          uncheckedThumbColor: theme.colors.textTertiary,
                        }}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </Column>
              </Card>
            </Host>
          </View>
        )}

        {/* 快捷操作部分 */}
        <QuickActionsSection />

        {/* 存储部分 */}
        <StorageSection />

        {/* 日志设置部分 */}
        <LogSection />

        {/* 外观设置部分 */}
        <AppearanceSection />

        {/* 应用信息部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>关于</Text>
          </View>

          <Host matchContents={{ vertical: true }} style={styles.hostFill}>
            <Card colors={{ containerColor: theme.colors.surface }}>
              <Column modifiers={[fillMaxWidth()]}>
                <ListItem colors={{ containerColor: theme.colors.surface }}>
                  <ListItem.OverlineContent>
                    <ComposeText color={theme.colors.textSecondary}>版本</ComposeText>
                  </ListItem.OverlineContent>
                  <ListItem.HeadlineContent>
                    <ComposeText color={theme.colors.text}>{appVersion}</ComposeText>
                  </ListItem.HeadlineContent>
                  <ListItem.TrailingContent>
                    <Row>
                      {isDownloading || updateAvailable ? (
                        <Button
                          onClick={() => {
                            if (isDownloading) {
                              handleCancelDownload();
                            } else {
                              handleUpdateButtonPress(
                                latestVersion ?? '',
                                latestAssetsRef.current,
                                releaseNotesRef.current
                              );
                            }
                          }}
                          enabled={!isCheckingUpdate}
                          colors={{
                            containerColor: theme.colors.primary,
                            contentColor: theme.colors.white,
                          }}
                        >
                          <ComposeText>
                            {isDownloading
                              ? `下载中 ${Math.round(downloadProgress * 100)}%`
                              : `更新 ${latestVersion}`}
                          </ComposeText>
                        </Button>
                      ) : (
                        <OutlinedButton
                          onClick={() => runUpdateCheck(true, localUpdateToBetaEnabled)}
                          enabled={!isCheckingUpdate}
                          colors={{ contentColor: theme.colors.primary }}
                        >
                          <ComposeText>{isCheckingUpdate ? '检查中...' : '检查更新'}</ComposeText>
                        </OutlinedButton>
                      )}
                      <Spacer modifiers={[widthModifier(8)]} />
                      <Button
                        onClick={() =>
                          Linking.openURL('https://github.com/UniClipboard/uc-android')
                        }
                        colors={{
                          containerColor: theme.colors.primary,
                          contentColor: theme.colors.white,
                        }}
                      >
                        <ComposeText>GitHub</ComposeText>
                      </Button>
                    </Row>
                  </ListItem.TrailingContent>
                </ListItem>

                <HorizontalDivider color={theme.colors.divider} />

                <ListItem colors={{ containerColor: theme.colors.surface }}>
                  <ListItem.HeadlineContent>
                    <ComposeText color={theme.colors.text}>自动检查更新</ComposeText>
                  </ListItem.HeadlineContent>
                  <ListItem.TrailingContent>
                    <ComposeSwitch
                      value={localAutoCheckUpdateEnabled}
                      onCheckedChange={handleToggleAutoCheckUpdate}
                      colors={{
                        checkedTrackColor: theme.colors.primary,
                        uncheckedTrackColor: theme.colors.divider,
                        checkedThumbColor: theme.colors.surface,
                        uncheckedThumbColor: theme.colors.textTertiary,
                      }}
                    />
                  </ListItem.TrailingContent>
                </ListItem>

                <HorizontalDivider color={theme.colors.divider} />

                <ListItem colors={{ containerColor: theme.colors.surface }}>
                  <ListItem.HeadlineContent>
                    <ComposeText color={theme.colors.text}>更新到测试版</ComposeText>
                  </ListItem.HeadlineContent>
                  <ListItem.TrailingContent>
                    <ComposeSwitch
                      value={localUpdateToBetaEnabled}
                      onCheckedChange={handleToggleUpdateToBeta}
                      colors={{
                        checkedTrackColor: theme.colors.primary,
                        uncheckedTrackColor: theme.colors.divider,
                        checkedThumbColor: theme.colors.surface,
                        uncheckedThumbColor: theme.colors.textTertiary,
                      }}
                    />
                  </ListItem.TrailingContent>
                </ListItem>
              </Column>
            </Card>
          </Host>
        </View>

        {/* 调试部分 */}
        <DebugSection />

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 服务器配置模态框 */}
      <ServerConfigModal
        visible={showServerModal}
        onClose={() => {
          setShowServerModal(false);
          setPrefillFromScan(null);
        }}
        onSave={handleSaveServer}
        initialConfig={
          editingServerIndex !== null ? servers[editingServerIndex] : (prefillFromScan ?? undefined)
        }
        isEditing={editingServerIndex !== null}
      />

      {/* 扫码 Modal */}
      <QrScannerModal visible={showScannerModal} onClose={handleScannerClose} />

      {/* 添加服务器底部表单 */}
      {showAddServerSheet && (
        <Host>
          <ModalBottomSheet onDismissRequest={() => setShowAddServerSheet(false)}>
            <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
              <ComposeText color={theme.colors.text} style={{ typography: 'titleLarge' }}>
                添加服务器
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <Button
                onClick={() => {
                  setShowScannerModal(true);
                  setShowAddServerSheet(false);
                }}
                modifiers={[fillMaxWidth()]}
                colors={{
                  containerColor: theme.colors.primary,
                  contentColor: theme.colors.white,
                }}
              >
                <ComposeText>扫描二维码</ComposeText>
              </Button>
              <Spacer modifiers={[heightModifier(8)]} />
              <OutlinedButton
                onClick={() => {
                  openManualAddForm();
                  setShowAddServerSheet(false);
                }}
                modifiers={[fillMaxWidth()]}
                colors={{ contentColor: theme.colors.primary }}
              >
                <ComposeText>手动填写</ComposeText>
              </OutlinedButton>
            </Column>
          </ModalBottomSheet>
        </Host>
      )}

      {/* 下载渠道选择底部表单 */}
      {downloadSourceSheet && (
        <Host>
          <ModalBottomSheet onDismissRequest={() => setDownloadSourceSheet(null)}>
            <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
              <ComposeText color={theme.colors.text} style={{ typography: 'titleLarge' }}>
                发现新版本
              </ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={theme.colors.textSecondary}>
                {`最新版本：${downloadSourceSheet.version}\n当前版本：${appVersion}${
                  downloadSourceSheet.releaseNotes
                    ? `\n\n更新说明：\n${downloadSourceSheet.releaseNotes}`
                    : ''
                }`}
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <Button
                onClick={() => {
                  const s = downloadSourceSheet;
                  setDownloadSourceSheet(null);
                  handleDownloadApk('gitcode', s.version, s.assets);
                }}
                modifiers={[fillMaxWidth()]}
                colors={{
                  containerColor: theme.colors.primary,
                  contentColor: theme.colors.white,
                }}
              >
                <ComposeText>GitCode 下载</ComposeText>
              </Button>
              <Spacer modifiers={[heightModifier(8)]} />
              <OutlinedButton
                onClick={() => {
                  const s = downloadSourceSheet;
                  setDownloadSourceSheet(null);
                  handleDownloadApk('github', s.version, s.assets);
                }}
                modifiers={[fillMaxWidth()]}
                colors={{ contentColor: theme.colors.primary }}
              >
                <ComposeText>GitHub 下载</ComposeText>
              </OutlinedButton>
            </Column>
          </ModalBottomSheet>
        </Host>
      )}

      {/* 共享对话框 Host */}
      <Host>
        {showCancelDownloadDialog && (
          <AlertDialog
            onDismissRequest={() => setShowCancelDownloadDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>取消下载</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>确定要取消下载吗？</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  downloadAbortRef.current?.abort();
                  setShowCancelDownloadDialog(false);
                }}
              >
                <ComposeText>取消下载</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowCancelDownloadDialog(false)}>
                <ComposeText>继续下载</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}

        {showShizukuUnavailableDialog && (
          <AlertDialog
            onDismissRequest={() => setShowShizukuUnavailableDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>Shizuku 未运行</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>
                请先安装并启动 Shizuku。{'\n\n'}非 Root 设备每次重启后需重新启动 Shizuku（Android
                11+ 可通过无线调试自行启动）。
              </ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  Linking.openURL('https://shizuku.rikka.app/guide/setup/');
                  setShowShizukuUnavailableDialog(false);
                }}
              >
                <ComposeText>了解更多</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowShizukuUnavailableDialog(false)}>
                <ComposeText>取消</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}

        {showBatteryOptDialog && (
          <AlertDialog
            onDismissRequest={() => setShowBatteryOptDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>无法唤起系统弹窗</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>
                系统限制每次安装仅允许弹出一次电池优化请求，请前往系统设置手动关闭电池优化。
              </ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  Linking.openSettings();
                  setShowBatteryOptDialog(false);
                }}
              >
                <ComposeText>前往设置</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowBatteryOptDialog(false)}>
                <ComposeText>取消</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}
      </Host>
    </SafeAreaView>
  );
};

export const SettingsScreen = () => (
  <SettingsToastProvider>
    <SettingsScreenInner />
  </SettingsToastProvider>
);
