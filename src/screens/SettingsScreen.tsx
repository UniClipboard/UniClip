/**
 * 设置页面
 * 提供主题切换功能、服务器配置、多用户切换
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  Alert,
  Linking,
  Platform,
  Modal,
} from 'react-native';
import { APP_VERSION } from '@/constants';
import { Paths, Directory } from 'expo-file-system';
import { calculateDirectorySize, clearDirectory } from '@/utils/fileStorage';
import { CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';
import { useSettingsStore } from '@/stores';
import { ServerConfigModal, ServerListItem, MessageToast } from '@/components';
import { ServerConfig } from '@/types/api';
import { useMessageToast } from '@/hooks/useMessageToast';
import {
  ShortcutService,
  checkForUpdate,
  calculateLogSize,
  clearLogs,
  saveLogsToFile,
  setLogLevel as setLoggerLogLevel,
  type LogLevel,
} from '@/services';
import { Plus, RefreshCw, Check, ChevronDown, ChevronUp } from 'react-native-feather';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import { getSmsCodeService } from '@/services/SmsCodeService';

export const SettingsScreen = () => {
  const { theme, themeMode, setThemeMode } = useTheme();
  const {
    config,
    isLoaded,
    loadConfig,
    addServer,
    updateServer,
    deleteServer,
    setActiveServer,
    setAutoSync,
    setAutoDownloadMaxSize,
    updateConfig,
    setAutoCheckUpdate,
    setLastUpdateCheckDate,
    setUpdateToBeta,
    setEnableHistorySync,
    setLogLevel,
    setRemotePollingInterval,
    setLocalPollingInterval,
    setEnableBackgroundSync,
    setEnableClipboardOverlay,
    setEnableBackgroundTasks,
    setEnableSmsForwarding,
  } = useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);
  const [serversCollapsed, setServersCollapsed] = useState(true);
  const { message, showMessage, handleMessageShown } = useMessageToast();

  // 本地状态用于跟踪Switch的当前值，避免闪烁
  const [localAutoSyncEnabled, setLocalAutoSyncEnabled] = useState(config?.autoSync ?? false);
  const [localDebugModeEnabled, setLocalDebugModeEnabled] = useState(config?.debugMode ?? false);
  const [localAutoCheckUpdateEnabled, setLocalAutoCheckUpdateEnabled] = useState(
    config?.autoCheckUpdate ?? true
  );
  const [localUpdateToBetaEnabled, setLocalUpdateToBetaEnabled] = useState(
    config?.updateToBeta ?? false
  );
  const [localHistorySyncEnabled, setLocalHistorySyncEnabled] = useState(
    config?.enableHistorySync ?? false
  );
  const [localBackgroundSyncEnabled, setLocalBackgroundSyncEnabled] = useState(
    config?.enableBackgroundSync ?? false
  );
  const [localBackgroundTasksEnabled, setLocalBackgroundTasksEnabled] = useState(
    config?.enableBackgroundTasks ?? false
  );
  const [localClipboardOverlayEnabled, setLocalClipboardOverlayEnabled] = useState(
    config?.enableClipboardOverlay ?? false
  );
  const [localSmsForwardingEnabled, setLocalSmsForwardingEnabled] = useState(
    config?.enableSmsForwarding ?? false
  );
  const [localForegroundNotification, setLocalForegroundNotification] = useState(
    config?.enableForegroundNotification ?? true
  );
  const [localDebugOverlayVisible, setLocalDebugOverlayVisible] = useState(
    config?.debugOverlayVisible ?? false
  );
  const [localDebugUrlScheme, setLocalDebugUrlScheme] = useState(config?.debugUrlScheme ?? false);
  const [showSmsTestModal, setShowSmsTestModal] = useState(false);
  const [smsTestInput, setSmsTestInput] = useState('');
  const [localDebugSmsNotify, setLocalDebugSmsNotify] = useState(config?.debugSmsNotify ?? false);
  const [showLogLevelMenu, setShowLogLevelMenu] = useState(false);

  // 更新检查状态
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const appVersion = APP_VERSION;

  // 加载配置
  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 当配置中的autoSync值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoSyncEnabled(config?.autoSync ?? false);
  }, [config?.autoSync]);

  // 当配置中的debugMode值变化时，更新本地状态
  useEffect(() => {
    setLocalDebugModeEnabled(config?.debugMode ?? false);
  }, [config?.debugMode]);

  // 当配置中的autoCheckUpdate值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoCheckUpdateEnabled(config?.autoCheckUpdate ?? true);
  }, [config?.autoCheckUpdate]);

  useEffect(() => {
    setLocalUpdateToBetaEnabled(config?.updateToBeta ?? false);
  }, [config?.updateToBeta]);

  useEffect(() => {
    setLocalHistorySyncEnabled(config?.enableHistorySync ?? true);
  }, [config?.enableHistorySync]);

  useEffect(() => {
    setLocalBackgroundSyncEnabled(config?.enableBackgroundSync ?? false);
  }, [config?.enableBackgroundSync]);

  useEffect(() => {
    setLocalBackgroundTasksEnabled(config?.enableBackgroundTasks ?? false);
  }, [config?.enableBackgroundTasks]);

  useEffect(() => {
    setLocalClipboardOverlayEnabled(config?.enableClipboardOverlay ?? false);
  }, [config?.enableClipboardOverlay]);

  useEffect(() => {
    setLocalSmsForwardingEnabled(config?.enableSmsForwarding ?? false);
  }, [config?.enableSmsForwarding]);

  useEffect(() => {
    setLocalForegroundNotification(config?.enableForegroundNotification ?? true);
  }, [config?.enableForegroundNotification]);

  // 计算存储大小
  useEffect(() => {
    calculateStorageSizes();
  }, []);

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
    const today = new Date().toISOString().slice(0, 10);
    if ((config?.lastUpdateCheckDate ?? '') === today) return;
    runUpdateCheck(false, config?.updateToBeta ?? false);
  }, [isLoaded]);

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: '跟随系统', value: 'auto' },
    { label: '浅色模式', value: 'light' },
    { label: '深色模式', value: 'dark' },
  ];

  // 获取服务器列表
  const servers = config?.servers || [];
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServer = activeServerIndex >= 0 ? servers[activeServerIndex] : null;
  const autoDownloadMaxSizeMB = Math.round(
    (config?.autoDownloadMaxSize ?? 5 * 1024 * 1024) / (1024 * 1024)
  );

  // 本地 state 用于输入框
  const [maxSizeInput, setMaxSizeInput] = useState(autoDownloadMaxSizeMB.toString());
  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(
    (config?.maxHistoryItems ?? 1000).toString()
  );
  const [remotePollingInput, setRemotePollingInput] = useState(
    ((config?.remotePollingInterval ?? 3000) / 1000).toString()
  );
  const [localPollingInput, setLocalPollingInput] = useState(
    ((config?.localPollingInterval ?? 1000) / 1000).toString()
  );

  // 存储大小状态
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [historySize, setHistorySize] = useState<number>(0);
  const [logSize, setLogSize] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(true);
  const [isExportingLogs, setIsExportingLogs] = useState<boolean>(false);
  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  // 权限状态
  const [permNotification, setPermNotification] = useState<boolean>(false);
  const [permOverlay, setPermOverlay] = useState<boolean>(false);
  const [permSms, setPermSms] = useState<boolean>(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState<boolean>(false);

  // 目录对象
  const cacheDir = CLIPBOARD_TEMP_DIR;
  const historyDir = new Directory(Paths.document, 'clipboards', 'history');

  // 调试日志
  useEffect(() => {
    try {
      console.log('Cache directory:', cacheDir.uri);
      console.log('History directory:', historyDir.uri);
      console.log('Cache directory exists:', cacheDir.exists);
      console.log('History directory exists:', historyDir.exists);
    } catch (error) {
      console.error('Error checking directories:', error);
    }
  }, []);

  // 处理添加服务器
  const handleAddServer = () => {
    setEditingServerIndex(null);
    setShowServerModal(true);
  };

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
      await updateConfig({ needsHistoryReorganize: true });
      showMessage('已切换服务器', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '切换失败', 'error');
    }
  };

  // 处理切换自动复制
  const handleToggleAutoSync = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalAutoSyncEnabled(enabled);

    try {
      await setAutoSync(enabled);
      showMessage(enabled ? '已启用自动复制' : '已禁用自动复制', 'success');
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalAutoSyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换后台任务总开关
  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    if (enabled) {
      Alert.alert(
        '开启后台任务',
        '启用后台任务后，应用将在后台持续运行相关服务，大幅增加电量消耗。\n\n建议在系统设置中将 SyncClipboard 的电池优化设为「不受限制」，并在多任务界面锁定 SyncClipboard，减少系统关闭后台任务的概率。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认开启',
            onPress: async () => {
              // Android 13+ 需要通知权限（后台任务依赖前台服务通知）
              if (Platform.OS === 'android') {
                const { PermissionsAndroid } = require('react-native');
                const granted = await PermissionsAndroid.check(
                  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
                );
                if (!granted) {
                  const result = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
                  );
                  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
                    Alert.alert(
                      '需要通知权限',
                      '后台任务需要通知权限才能正常运行，请在系统设置中允许',
                      [
                        { text: '取消', style: 'cancel' },
                        { text: '前往设置', onPress: () => Linking.openSettings() },
                      ]
                    );
                    return;
                  }
                }
              }

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

  // 处理切换后台同步
  const handleToggleBackgroundSync = async (enabled: boolean) => {
    if (enabled) {
      Alert.alert(
        '开启后台同步',
        'Android 10 及以上的系统，应用在后台无法直接获取本地剪贴板内容，你可能需要启用悬浮窗或使用其他工具来解除此限制。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认开启',
            onPress: async () => {
              setLocalBackgroundSyncEnabled(true);
              try {
                await setEnableBackgroundSync(true);
                showMessage('已启用后台同步', 'success');
              } catch (error: unknown) {
                setLocalBackgroundSyncEnabled(false);
                showMessage(error instanceof Error ? error.message : '设置失败', 'error');
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundSyncEnabled(false);
    try {
      await setEnableBackgroundSync(false);
      showMessage('已禁用后台同步', 'success');
    } catch (error: unknown) {
      setLocalBackgroundSyncEnabled(true);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换悬浮窗获取剪贴板
  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      Alert.alert(
        '启用悬浮窗获取剪贴板',
        '启用后，应用将通过不可见的悬浮窗在后台获取剪贴板内容。这可能导致部分应用因焦点问题产生功能异常以及其他问题。\n\n如果您已通过基于 root 的工具授予了 SyncClipboard 后台剪贴板读取权限，建议关闭此选项。',
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
    } catch (error: unknown) {
      setLocalForegroundNotification(false);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理最大文件大小输入
  const handleMaxSizeBlur = async () => {
    try {
      const sizeMB = parseInt(maxSizeInput, 10);
      if (isNaN(sizeMB) || sizeMB < 0) {
        setMaxSizeInput(autoDownloadMaxSizeMB.toString());
        showMessage('请输入有效的数字', 'error');
        return;
      }
      const sizeInBytes = sizeMB * 1024 * 1024;
      await setAutoDownloadMaxSize(sizeInBytes);
      showMessage(`已设置最大文件大小为 ${sizeMB}MB`, 'success');
    } catch (error: unknown) {
      setMaxSizeInput(autoDownloadMaxSizeMB.toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理历史记录最大保留条数输入
  const handleMaxHistoryItemsBlur = async () => {
    try {
      const maxItems = parseInt(maxHistoryItemsInput, 10);
      if (isNaN(maxItems) || maxItems < 10) {
        setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
        showMessage('请输入大于等于10的数字', 'error');
        return;
      }
      await updateConfig({ maxHistoryItems: maxItems });
      showMessage(`已设置历史记录最大保留条数为 ${maxItems}条`, 'success');

      // 更新历史记录存储的最大大小
      const { historyStorage } = await import('@/services');
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理远程轮询间隔输入
  const handleRemotePollingBlur = async () => {
    try {
      const seconds = parseInt(remotePollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
        showMessage('请输入大于等于1的数字', 'error');
        return;
      }
      const ms = seconds * 1000;
      await setRemotePollingInterval(ms);
      showMessage(`已设置远程轮询间隔为 ${seconds}秒`, 'success');
    } catch (error: unknown) {
      setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理本地轮询间隔输入
  const handleLocalPollingBlur = async () => {
    try {
      const seconds = parseInt(localPollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
        showMessage('请输入大于等于1的数字', 'error');
        return;
      }
      const ms = seconds * 1000;
      await setLocalPollingInterval(ms);
      showMessage(`已设置本地轮询间隔为 ${seconds}秒`, 'success');
    } catch (error: unknown) {
      setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 过滤输入，只允许正整数
  const filterPositiveInteger = (value: string): string => {
    const filtered = value.replace(/[^0-9]/g, '');
    if (filtered === '') return '';
    const num = parseInt(filtered, 10);
    return num > 0 ? filtered : '';
  };

  // 处理切换调试模式
  const handleToggleDebugMode = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalDebugModeEnabled(enabled);

    try {
      await updateConfig({ debugMode: enabled });
      showMessage(enabled ? '已启用调试模式' : '已禁用调试模式', 'success');
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalDebugModeEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换调试悬浮窗显示
  const handleToggleDebugOverlayVisible = async (enabled: boolean) => {
    setLocalDebugOverlayVisible(enabled);
    try {
      await updateConfig({ debugOverlayVisible: enabled });
      showMessage(enabled ? '悬浮窗将在后台时可见' : '悬浮窗已隐藏', 'success');
    } catch (error: unknown) {
      setLocalDebugOverlayVisible(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 处理切换显示 URL Scheme 调用
  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    setLocalDebugUrlScheme(enabled);
    try {
      await updateConfig({ debugUrlScheme: enabled });
    } catch (error: unknown) {
      setLocalDebugUrlScheme(!enabled);
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  // 测试验证码短信提取
  const handleTestSmsCode = () => {
    const smsService = getSmsCodeService();
    const code = smsService.extractVerificationCode(smsTestInput);
    if (code) {
      Alert.alert('提取成功', `验证码: ${code}`);
    } else {
      Alert.alert('提取失败', '未能从输入文本中提取到验证码');
    }
  };

  // 处理切换调试短信提醒
  const handleToggleDebugSmsNotify = async (enabled: boolean) => {
    setLocalDebugSmsNotify(enabled);
    try {
      await updateConfig({ debugSmsNotify: enabled });
    } catch (error: unknown) {
      setLocalDebugSmsNotify(!enabled);
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

  // 处理切换历史记录同步
  const handleToggleHistorySync = async (enabled: boolean) => {
    try {
      const { getHistorySyncService } = await import('@/services/HistorySyncService');
      const syncService = getHistorySyncService();
      syncService.cancelAll();

      if (!enabled) {
        await syncService.resetSyncCursor();
      }
    } catch {
      // ignore
    }

    setLocalHistorySyncEnabled(enabled);
    try {
      await setEnableHistorySync(enabled);

      if (!enabled) {
        await updateConfig({ needsHistoryReorganize: true });
      }

      showMessage(enabled ? '已启用历史记录同步' : '已禁用历史记录同步', 'success');
    } catch (error: unknown) {
      setLocalHistorySyncEnabled(!enabled);
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
        Alert.alert(
          '发现新版本',
          `最新版本：${result.latestVersion}\n当前版本：${appVersion}\n\n是否前往下载？`,
          [
            { text: '稍后再说', style: 'cancel' },
            {
              text: '立即更新',
              onPress: () => Linking.openURL(result.releaseUrl),
            },
          ]
        );
      } else {
        setUpdateAvailable(false);
        setLatestVersion(null);
        if (showNoUpdateToast) {
          showMessage('当前已是最新版本', 'success');
        }
      }
    } catch {
      if (showNoUpdateToast) {
        showMessage('检查更新失败，请检查网络连接', 'error');
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 计算存储大小
  const calculateStorageSizes = async () => {
    setIsCalculating(true);
    try {
      // 使用setTimeout模拟异步操作，避免UI阻塞
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cacheSizeValue = calculateDirectorySize(cacheDir);
      const historySizeValue = calculateDirectorySize(historyDir);
      const logSizeValue = calculateLogSize();
      setCacheSize(cacheSizeValue);
      setHistorySize(historySizeValue);
      setLogSize(logSizeValue);
    } catch (error) {
      console.error('Failed to calculate storage sizes:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // 清除缓存
  const handleClearCache = () => {
    Alert.alert(
      '清空缓存',
      '确定要清空缓存目录吗？这将删除所有缓存文件。',
      [
        {
          text: '取消',
          style: 'cancel',
        },
        {
          text: '确定',
          onPress: async () => {
            try {
              clearDirectory(cacheDir);
              await calculateStorageSizes();
              showMessage('缓存已清空', 'success');
            } catch {
              showMessage('清空缓存失败', 'error');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // 清除日志
  const handleClearLogs = () => {
    Alert.alert(
      '清空日志',
      '确定要清空日志目录吗？这将删除所有日志文件。',
      [
        {
          text: '取消',
          style: 'cancel',
        },
        {
          text: '确定',
          onPress: async () => {
            try {
              clearLogs();
              await calculateStorageSizes();
              showMessage('日志已清空', 'success');
            } catch {
              showMessage('清空日志失败', 'error');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // 导出日志
  const handleExportLogs = async () => {
    if (isExportingLogs) {
      exportLogsAbortControllerRef.current?.abort();
      return;
    }

    const abortController = new AbortController();
    exportLogsAbortControllerRef.current = abortController;
    setIsExportingLogs(true);

    try {
      await saveLogsToFile(abortController.signal);
      showMessage('日志已保存', 'success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage('已取消导出', 'info');
      } else {
        const message = error instanceof Error ? error.message : '导出日志失败';
        showMessage(message, 'error');
      }
    } finally {
      setIsExportingLogs(false);
      exportLogsAbortControllerRef.current = null;
    }
  };

  // 设置日志等级
  const handleSetLogLevel = async (level: LogLevel) => {
    try {
      await setLogLevel(level);
      setLoggerLogLevel(level);
      showMessage(`日志等级已设置为 ${level}`, 'success');
    } catch {
      showMessage('设置日志等级失败', 'error');
    }
  };

  // 处理添加下载快捷方式
  const handleAddDownloadShortcut = async () => {
    try {
      await ShortcutService.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  // 处理添加上传快捷方式
  const handleAddUploadShortcut = async () => {
    try {
      await ShortcutService.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

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
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>同步设置</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>自动复制</Text>
              </View>
              <Switch
                value={localAutoSyncEnabled}
                onValueChange={handleToggleAutoSync}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={localAutoSyncEnabled ? theme.colors.surface : theme.colors.textTertiary}
              />
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  历史记录同步
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {activeServer?.type === 'webdav'
                    ? 'WebDAV 服务器不支持历史记录同步'
                    : '同步历史记录到服务器'}
                </Text>
              </View>
              <Switch
                value={localHistorySyncEnabled && activeServer?.type !== 'webdav'}
                onValueChange={handleToggleHistorySync}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={
                  localHistorySyncEnabled && activeServer?.type !== 'webdav'
                    ? theme.colors.surface
                    : theme.colors.textTertiary
                }
                disabled={activeServer?.type === 'webdav'}
              />
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  允许自动同步的数据大小
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  小于此大小的文件将自动下载
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.sizeInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  value={maxSizeInput}
                  onChangeText={setMaxSizeInput}
                  onBlur={handleMaxSizeBlur}
                  keyboardType="number-pad"
                  placeholder="5"
                  placeholderTextColor={theme.colors.textTertiary}
                />
                <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>MB</Text>
              </View>
            </View>

            {activeServer?.type !== 'syncclipboard' && (
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    远程轮询间隔
                  </Text>
                </View>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={[
                      styles.sizeInput,
                      {
                        color: theme.colors.text,
                        borderColor: theme.colors.divider,
                        backgroundColor: theme.colors.background,
                      },
                    ]}
                    value={remotePollingInput}
                    onChangeText={(text) => setRemotePollingInput(filterPositiveInteger(text))}
                    onBlur={handleRemotePollingBlur}
                    keyboardType="number-pad"
                    placeholder="3"
                    placeholderTextColor={theme.colors.textTertiary}
                  />
                  <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>秒</Text>
                </View>
              </View>
            )}

            <View style={styles.settingRowNoBorder}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  本地轮询间隔
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.sizeInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  value={localPollingInput}
                  onChangeText={(text) => setLocalPollingInput(filterPositiveInteger(text))}
                  onBlur={handleLocalPollingBlur}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={theme.colors.textTertiary}
                />
                <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>秒</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 后台任务部分 */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderBase}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>后台任务</Text>
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
              ]}
            >
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>后台任务</Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    关闭后将停止所有后台任务
                  </Text>
                </View>
                <Switch
                  value={localBackgroundTasksEnabled}
                  onValueChange={handleToggleBackgroundTasks}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localBackgroundTasksEnabled ? theme.colors.surface : theme.colors.textTertiary
                  }
                />
              </View>

              {/* 后台同步 */}
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text
                    style={[
                      styles.settingLabel,
                      {
                        color: localBackgroundTasksEnabled
                          ? theme.colors.text
                          : theme.colors.textTertiary,
                      },
                    ]}
                  >
                    后台服务常驻通知
                  </Text>
                </View>
                <Switch
                  value={localBackgroundTasksEnabled && localForegroundNotification}
                  onValueChange={handleToggleForegroundNotification}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localBackgroundTasksEnabled && localForegroundNotification
                      ? theme.colors.surface
                      : theme.colors.textTertiary
                  }
                  disabled={!localBackgroundTasksEnabled}
                />
              </View>

              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text
                    style={[
                      styles.settingLabel,
                      {
                        color: localBackgroundTasksEnabled
                          ? theme.colors.text
                          : theme.colors.textTertiary,
                      },
                    ]}
                  >
                    后台同步
                  </Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    仅在启用自动复制时生效
                  </Text>
                </View>
                <Switch
                  value={localBackgroundTasksEnabled && localBackgroundSyncEnabled}
                  onValueChange={handleToggleBackgroundSync}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localBackgroundTasksEnabled && localBackgroundSyncEnabled
                      ? theme.colors.surface
                      : theme.colors.textTertiary
                  }
                  disabled={!localBackgroundTasksEnabled}
                />
              </View>

              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text
                    style={[
                      styles.settingLabel,
                      {
                        color: localBackgroundTasksEnabled
                          ? theme.colors.text
                          : theme.colors.textTertiary,
                      },
                    ]}
                  >
                    在后台时通过悬浮窗获取本地剪贴板
                  </Text>
                </View>
                <Switch
                  value={localBackgroundTasksEnabled && localClipboardOverlayEnabled}
                  onValueChange={handleToggleClipboardOverlay}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localBackgroundTasksEnabled && localClipboardOverlayEnabled
                      ? theme.colors.surface
                      : theme.colors.textTertiary
                  }
                  disabled={!localBackgroundTasksEnabled}
                />
              </View>

              <View style={styles.settingRowNoBorder}>
                <View style={styles.settingInfo}>
                  <Text
                    style={[
                      styles.settingLabel,
                      {
                        color: localBackgroundTasksEnabled
                          ? theme.colors.text
                          : theme.colors.textTertiary,
                      },
                    ]}
                  >
                    自动上传短信验证码
                  </Text>
                </View>
                <Switch
                  value={localBackgroundTasksEnabled && localSmsForwardingEnabled}
                  onValueChange={handleToggleSmsForwarding}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localBackgroundTasksEnabled && localSmsForwardingEnabled
                      ? theme.colors.surface
                      : theme.colors.textTertiary
                  }
                  disabled={!localBackgroundTasksEnabled}
                />
              </View>
            </View>
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

            <View
              style={[
                styles.card,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
              ]}
            >
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>通知权限</Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    后台任务的前台服务通知所需
                  </Text>
                </View>
                <Switch
                  value={permNotification}
                  onValueChange={() => Linking.openSettings()}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={permNotification ? theme.colors.surface : theme.colors.textTertiary}
                />
              </View>

              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    悬浮窗权限
                  </Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    后台通过悬浮窗获取剪贴板所需
                  </Text>
                </View>
                <Switch
                  value={permOverlay}
                  onValueChange={() => requestOverlayPermission()}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={permOverlay ? theme.colors.surface : theme.colors.textTertiary}
                />
              </View>

              <View style={styles.settingRowNoBorder}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>短信权限</Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    自动上传短信验证码所需
                  </Text>
                </View>
                <Switch
                  value={permSms}
                  onValueChange={() => Linking.openSettings()}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={permSms ? theme.colors.surface : theme.colors.textTertiary}
                />
              </View>
            </View>
          </View>
        )}

        {/* 快捷操作部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>快捷操作</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  添加桌面快捷方式：下载
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddDownloadShortcut}
              >
                <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>添加</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingRowNoBorder}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  添加桌面快捷方式：上传
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddUploadShortcut}
              >
                <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>添加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 存储部分 */}
        <View style={styles.section}>
          <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>存储</Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={calculateStorageSizes}
              disabled={isCalculating}
            >
              <RefreshCw color={theme.colors.primary} width={16} height={16} />
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  缓存空间占用
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {isCalculating ? '加载中...' : formatFileSize(cacheSize)}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.clearButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleClearCache}
                disabled={isCalculating}
              >
                <Text style={[styles.clearButtonText, { color: theme.colors.white }]}>清理</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  日志空间占用
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {isCalculating ? '加载中...' : formatFileSize(logSize)}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.clearButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleClearLogs}
                disabled={isCalculating}
              >
                <Text style={[styles.clearButtonText, { color: theme.colors.white }]}>清理</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  历史记录空间占用
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  {isCalculating ? '加载中...' : formatFileSize(historySize)}
                </Text>
              </View>
            </View>

            <View style={styles.settingRowNoBorder}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  历史记录最大保留条数
                </Text>
                <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                  最小值为10条
                </Text>
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[
                    styles.sizeInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.background,
                    },
                  ]}
                  value={maxHistoryItemsInput}
                  onChangeText={setMaxHistoryItemsInput}
                  onBlur={handleMaxHistoryItemsBlur}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor={theme.colors.textTertiary}
                />
                <Text style={[styles.unitLabel, { color: theme.colors.textSecondary }]}>条</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 日志设置部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>日志</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <TouchableOpacity
              style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}
              onPress={() => setShowLogLevelMenu(!showLogLevelMenu)}
            >
              <Text style={[styles.settingLabel, { color: theme.colors.text }]}>日志等级</Text>
              <View style={styles.dropdownValue}>
                <Text style={[styles.dropdownValueText, { color: theme.colors.textSecondary }]}>
                  {config?.logLevel === 'debug'
                    ? '调试'
                    : config?.logLevel === 'info'
                      ? '信息'
                      : config?.logLevel === 'warn'
                        ? '警告'
                        : '错误'}
                </Text>
                {showLogLevelMenu ? (
                  <ChevronUp color={theme.colors.textSecondary} width={18} height={18} />
                ) : (
                  <ChevronDown color={theme.colors.textSecondary} width={18} height={18} />
                )}
              </View>
            </TouchableOpacity>

            {showLogLevelMenu && (
              <View style={[styles.dropdownMenu, { borderColor: theme.colors.divider }]}>
                {[
                  { label: '调试', value: 'debug' as LogLevel },
                  { label: '信息', value: 'info' as LogLevel },
                  { label: '警告', value: 'warn' as LogLevel },
                  { label: '错误', value: 'error' as LogLevel },
                ].map((option, index) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.dropdownItem,
                      index < 3
                        ? {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: theme.colors.divider,
                          }
                        : undefined,
                    ]}
                    onPress={() => {
                      handleSetLogLevel(option.value);
                      setShowLogLevelMenu(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        {
                          color:
                            config?.logLevel === option.value
                              ? theme.colors.primary
                              : theme.colors.text,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                    {config?.logLevel === option.value && (
                      <Check stroke={theme.colors.primary} width={18} height={18} strokeWidth={3} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.settingRowNoBorder}>
              <Text style={[styles.settingLabel, { color: theme.colors.text }]}>导出日志</Text>
              <TouchableOpacity
                style={[styles.clearButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleExportLogs}
                disabled={isCalculating}
              >
                <Text style={[styles.clearButtonText, { color: theme.colors.white }]}>
                  {isExportingLogs ? '取消' : '导出'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 主题设置部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>主题</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            {themeOptions.map((option, index) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionItem,
                  index < themeOptions.length - 1
                    ? {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.colors.divider,
                      }
                    : undefined,
                ]}
                onPress={() => setThemeMode(option.value)}
              >
                <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                  {option.label}
                </Text>
                {themeMode === option.value && (
                  <Check stroke={theme.colors.primary} width={22} height={22} strokeWidth={3} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 应用信息部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>关于</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <View
              style={[
                styles.versionBlock,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.divider,
                },
              ]}
            >
              <View style={styles.versionTopRow}>
                <View style={styles.versionLabelGroup}>
                  <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                    版本
                  </Text>
                  <Text style={[styles.infoValue, { color: theme.colors.text }]}>{appVersion}</Text>
                </View>
                <View style={styles.versionButtonGroup}>
                  <TouchableOpacity
                    style={[
                      styles.updateButton,
                      {
                        backgroundColor: updateAvailable
                          ? theme.colors.primary
                          : theme.colors.surface,
                        borderColor: theme.colors.primary,
                      },
                    ]}
                    onPress={() =>
                      updateAvailable
                        ? Linking.openURL('https://github.com/Jeric-X/SyncClipboard/releases')
                        : runUpdateCheck(true, localUpdateToBetaEnabled)
                    }
                    disabled={isCheckingUpdate}
                  >
                    <Text
                      style={[
                        styles.updateButtonText,
                        {
                          color: updateAvailable ? theme.colors.white : theme.colors.primary,
                        },
                      ]}
                    >
                      {isCheckingUpdate
                        ? '检查中...'
                        : updateAvailable
                          ? `更新 ${latestVersion}`
                          : '检查更新'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.updateButton,
                      {
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      },
                    ]}
                    onPress={() =>
                      Linking.openURL('https://github.com/Jeric-X/syncclipboard-mobile')
                    }
                  >
                    <Text style={[styles.updateButtonText, { color: theme.colors.white }]}>
                      GitHub
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  自动检查更新
                </Text>
              </View>
              <Switch
                value={localAutoCheckUpdateEnabled}
                onValueChange={handleToggleAutoCheckUpdate}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={
                  localAutoCheckUpdateEnabled ? theme.colors.surface : theme.colors.textTertiary
                }
              />
            </View>

            <View style={styles.settingRowNoBorder}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                  更新到测试版
                </Text>
              </View>
              <Switch
                value={localUpdateToBetaEnabled}
                onValueChange={handleToggleUpdateToBeta}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={
                  localUpdateToBetaEnabled ? theme.colors.surface : theme.colors.textTertiary
                }
              />
            </View>
          </View>
        </View>

        {/* 调试部分 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderBase}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>调试</Text>
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <View
              style={[
                styles.settingRowNoBorder,
                localDebugModeEnabled && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.divider,
                },
              ]}
            >
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>调试模式</Text>
              </View>
              <Switch
                value={localDebugModeEnabled}
                onValueChange={handleToggleDebugMode}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                thumbColor={
                  localDebugModeEnabled ? theme.colors.surface : theme.colors.textTertiary
                }
              />
            </View>

            {localDebugModeEnabled && Platform.OS === 'android' && (
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    显示悬浮窗
                  </Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    后台获取剪贴板时显示可见的悬浮窗
                  </Text>
                </View>
                <Switch
                  value={localDebugOverlayVisible}
                  onValueChange={handleToggleDebugOverlayVisible}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localDebugOverlayVisible ? theme.colors.surface : theme.colors.textTertiary
                  }
                />
              </View>
            )}

            {localDebugModeEnabled && (
              <View
                style={[
                  styles.settingRowNoBorder,
                  {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.divider,
                  },
                ]}
              >
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    显示 URL Scheme 调用
                  </Text>
                </View>
                <Switch
                  value={localDebugUrlScheme}
                  onValueChange={handleToggleDebugUrlScheme}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localDebugUrlScheme ? theme.colors.surface : theme.colors.textTertiary
                  }
                />
              </View>
            )}

            {localDebugModeEnabled && (
              <View style={[styles.settingRow, { borderBottomColor: theme.colors.divider }]}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    提醒非验证码类短信
                  </Text>
                  <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
                    收到非验证码短信时显示 Toast
                  </Text>
                </View>
                <Switch
                  value={localDebugSmsNotify}
                  onValueChange={handleToggleDebugSmsNotify}
                  trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                  thumbColor={
                    localDebugSmsNotify ? theme.colors.surface : theme.colors.textTertiary
                  }
                />
              </View>
            )}

            {localDebugModeEnabled && (
              <View style={styles.settingRowNoBorder}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                    测试验证码短信
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
                  onPress={() => {
                    setSmsTestInput('');
                    setShowSmsTestModal(true);
                  }}
                >
                  <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>测试</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={handleMessageShown} />

      {/* 服务器配置模态框 */}
      <ServerConfigModal
        visible={showServerModal}
        onClose={() => setShowServerModal(false)}
        onSave={handleSaveServer}
        initialConfig={editingServerIndex !== null ? servers[editingServerIndex] : undefined}
        isEditing={editingServerIndex !== null}
      />

      {/* 测试验证码短信模态框 */}
      <Modal
        visible={showSmsTestModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSmsTestModal(false)}
      >
        <View style={[styles.smsTestModalOverlay, { backgroundColor: theme.colors.overlay }]}>
          <View style={[styles.smsTestModalContent, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.smsTestModalTitle, { color: theme.colors.text }]}>
              测试验证码短信
            </Text>
            <TextInput
              style={[
                styles.smsTestModalInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.background,
                },
              ]}
              placeholder="输入短信内容..."
              placeholderTextColor={theme.colors.textTertiary}
              value={smsTestInput}
              onChangeText={setSmsTestInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.smsTestModalButtons}>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.divider }]}
                onPress={() => setShowSmsTestModal(false)}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.text }]}>
                  取消
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smsTestModalButton, { backgroundColor: theme.colors.primary }]}
                onPress={handleTestSmsCode}
              >
                <Text style={[styles.smsTestModalButtonText, { color: theme.colors.white }]}>
                  测试
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionHeaderBase: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseIcon: {
    marginTop: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionInfo: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 16,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingRowNoBorder: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sizeInput: {
    width: 80,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    textAlign: 'right',
  },
  unitLabel: {
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 40,
  },
  versionBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  versionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionButtonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  versionLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  updateButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  dropdownValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dropdownValueText: {
    fontSize: 16,
  },
  dropdownMenu: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownItemText: {
    fontSize: 16,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  refreshButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  smsTestModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  smsTestModalContent: {
    width: '100%',
    borderRadius: 12,
    padding: 20,
  },
  smsTestModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  smsTestModalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    marginBottom: 16,
  },
  smsTestModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  smsTestModalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  smsTestModalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
