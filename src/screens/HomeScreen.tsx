/**
 * Home Screen
 * 首页 - 显示当前剪贴板和同步状态
 */

import React, { useEffect, useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  AppState,
  AppStateStatus,
  TouchableOpacity,
  Platform,
  ToastAndroid,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/hooks/useTheme';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent, createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { createAPIClient, historyStorage, SyncManager } from '@/services';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { getSignalRClient, type ProfileChangedEvent } from 'signalr-client';
import { setTimer, clearTimer } from 'native-timer';
import { downloadAndAddToHistory, type DownloadProgressCallback } from '@/utils/remoteClipboard';
import { uploadFileAndAddToHistory } from '@/utils/uploadFile';
import type { ProgressInfo } from 'native-util';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { getHistoryTransferQueue, TransferTask } from '@/services/HistoryTransferQueue';
import { getProfileId } from '@/services/HistoryAPI';

export function HomeScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [remoteContent, setRemoteContent] = useState<ClipboardContent | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [downloadingRemote, setDownloadingRemote] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    progress: number;
    bytesTransferred: number;
    totalBytes: number;
  } | null>(null);
  const [fileUploadPayload, setFileUploadPayload] = useState<{
    uri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number;
  } | null>(null);
  const [fileUploadLoadingText, setFileUploadLoadingText] = useState('正在处理文件…');
  const [fileUploadProgress, setFileUploadProgress] = useState<ProgressInfo | null>(null);
  const [uploadingClipboard, setUploadingClipboard] = useState(false);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);
  const { error, setError, clearError } = useErrorStore();
  const { message, showMessage, clearMessage } = useMessageStore();
  const appState = useRef(AppState.currentState);
  const remotePollingTag = useRef<string | null>(null);
  const lastRemoteProfileHash = useRef<string | null>(null);
  const lastLocalProfileHash = useRef<string | null>(null);
  const isAutoSyncing = useRef(false);
  const signalRConnected = useRef(false);
  const signalRProfileCallback = useRef<((event: ProfileChangedEvent) => void) | null>(null);
  const downloadAbortControllerRef = useRef<AbortController | null>(null);
  const clipboardUploadAbortControllerRef = useRef<AbortController | null>(null);

  const { currentContent, getContent, startMonitoring, stopMonitoring, updatePollingInterval } =
    useClipboardStore();
  const sync = useSyncStore((state) => state.sync);
  const initializeSync = useSyncStore((state) => state.initialize);
  const destroySync = useSyncStore((state) => state.destroy);
  const { getActiveServer, loadConfig, isLoaded, config, isTempDisabledBackgroundTasks } =
    useSettingsStore();
  const { tasks: transferTasks, subscribe: subscribeTransferQueue } = useTransferQueueStore();
  const lastDeletedHashes = useHistoryStore((state) => state.lastDeletedHashes);
  const historyCleared = useHistoryStore((state) => state.historyCleared);
  const clearDeletedState = useHistoryStore((state) => state.clearDeletedState);

  const activeServer = getActiveServer();

  // 监听历史记录删除事件，重置远程剪贴板的下载状态
  useEffect(() => {
    if (!remoteContent?.profileHash) return;

    if (historyCleared) {
      console.log('[HomeScreen] History cleared, resetting remote content download state');
      setRemoteContent((prev) => (prev ? { ...prev, fileUri: undefined } : null));
      clearDeletedState();
      return;
    }

    if (lastDeletedHashes.length > 0) {
      const deletedSet = new Set(lastDeletedHashes.map((h) => h.toLowerCase()));
      if (remoteContent.profileHash && deletedSet.has(remoteContent.profileHash.toLowerCase())) {
        console.log(
          '[HomeScreen] Remote content deleted from history, resetting download state:',
          remoteContent.profileHash
        );
        setRemoteContent((prev) => (prev ? { ...prev, fileUri: undefined } : null));
      }
      clearDeletedState();
    }
  }, [lastDeletedHashes, historyCleared, remoteContent?.profileHash, clearDeletedState]);

  // 订阅下载队列状态变化
  useEffect(() => {
    return subscribeTransferQueue();
  }, [subscribeTransferQueue]);

  // 获取远程内容的下载任务状态
  const remoteDownloadTask = useMemo(() => {
    if (!remoteContent?.profileHash) return null;
    const profileId = getProfileId(remoteContent.type, remoteContent.profileHash);
    return transferTasks.find(
      (t) =>
        t.profileId === profileId &&
        t.type === 'download' &&
        (t.status === 'running' || t.status === 'pending' || t.status === 'waitForRetry')
    );
  }, [remoteContent, transferTasks]);

  // 远程内容是否正在下载
  const isRemoteDownloading = !!remoteDownloadTask;
  const remoteDownloadProgress = remoteDownloadTask
    ? {
        progress: remoteDownloadTask.progress < 0 ? 0 : remoteDownloadTask.progress / 100,
        bytesTransferred: remoteDownloadTask.bytesTransferred,
        totalBytes: remoteDownloadTask.totalBytes || 0,
      }
    : null;

  // 监听下载完成，更新 remoteContent 的 fileUri（仅 SyncClipboard 服务器）
  useEffect(() => {
    // 仅 SyncClipboard 服务器使用下载队列
    if (activeServer?.type !== 'syncclipboard') return;

    const queue = getHistoryTransferQueue();

    const handleTaskStatusChanged = async (task: TransferTask) => {
      if (task.type !== 'download' || task.status !== 'completed') return;
      if (!remoteContent?.profileHash) return;

      const profileId = getProfileId(remoteContent.type, remoteContent.profileHash);
      if (task.profileId !== profileId) return;

      const { getHistoryFileUri } = await import('@/utils/fileStorage');
      const fileUri = await getHistoryFileUri(
        remoteContent.type,
        remoteContent.profileHash,
        remoteContent.fileName!
      );

      if (fileUri && fileUri !== remoteContent.fileUri) {
        setRemoteContent((prev) => (prev ? { ...prev, fileUri } : null));
        if (config?.syncToastEnabled !== false) {
          showMessage('文件已下载', 'success');
        }
      }
    };

    queue.onTaskStatusChanged(handleTaskStatusChanged);
    return () => {
      queue.offTaskStatusChanged(handleTaskStatusChanged);
    };
  }, [remoteContent, showMessage, activeServer]);

  // 复制远程内容到本地剪贴板的公共函数
  const copyRemoteToLocal = async (content: ClipboardContent, logPrefix: string = '') => {
    const result = await copyToLocalClipboard(content);
    if (result.success) {
      useClipboardStore.getState().setCurrentContentDisplay(content);
      lastLocalProfileHash.current = content.profileHash || content.text || '';
      console.log(`[HomeScreen] ${logPrefix}Copy to local clipboard completed`);
    } else {
      console.error(`[HomeScreen] ${logPrefix}Copy to local clipboard failed: ${result.message}`);
    }
    return result;
  };

  // 复制本地剪贴板内容（简单模式，直接设置到剪贴板）
  const copyLocalToClipboard = async (content: ClipboardContent) => {
    try {
      const { clipboardManager } = await import('@/services');
      await clipboardManager.setClipboardContent(content);
      showMessage('已复制到剪贴板', 'success');
    } catch (error) {
      console.error('[HomeScreen] Failed to copy local content:', error);
      showMessage('复制失败', 'error');
    }
  };

  // 处理远程剪贴板内容更新的公共逻辑
  const processRemoteClipboardContent = async (
    content: ClipboardContent,
    currentHash: string,
    hasData: boolean,
    apiClient: ReturnType<typeof createAPIClient>,
    logPrefix: string = ''
  ) => {
    const previousHash = lastRemoteProfileHash.current;

    // 使用提取的工具函数解析远程内容（包含 hash 变化检测、上传检测、历史记录查询）
    const { resolveRemoteContent } = await import('@/utils/processRemoteContent');
    const resolved = await resolveRemoteContent(content, currentHash, previousHash, hasData, {
      getLastUploadedHash: () => SyncManager.getInstance().getLastUploadedHash(),
      getHistoryItem: (profileHash) => historyStorage.getItem(profileHash),
      getHistoryFileUri: async (type, profileHash, fileName) => {
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        return getHistoryFileUri(type, profileHash, fileName);
      },
    });

    // 没有变化，不处理
    if (!resolved) {
      return;
    }

    // hash 没变但 fileUri 更新了（例如快捷同步在后台下载了文件），只更新显示
    if (resolved.fileUriOnlyUpdate) {
      setRemoteContent(resolved.content);
      return;
    }

    // 如果是本地刚上传的内容，跳过自动下载/复制，仅更新显示
    if (resolved.isJustUploaded) {
      console.log(
        `[HomeScreen] ${logPrefix}Remote hash matches last uploaded hash, skipping auto-download/copy but updating display`
      );
      lastRemoteProfileHash.current = currentHash;
      setRemoteContent(resolved.content);
      return;
    }

    lastRemoteProfileHash.current = currentHash;

    // 1. 历史记录查询结果
    let finalContent = resolved.content;
    let skipAutoCopyDueToLargeFile = false;
    let foundInHistory = resolved.foundInHistory;

    if (foundInHistory) {
      console.log(`[HomeScreen] ${logPrefix}Found existing file in history, skipping download`);
    }

    // 2. 如果历史记录中没有找到，处理自动下载
    if (!foundInHistory) {
      const autoDownloadMaxSize = config?.autoDownloadMaxSize ?? 5 * 1024 * 1024;
      const hasFileData = hasData && content.fileName && content.fileSize !== undefined;

      console.log(`[HomeScreen] ${logPrefix}hasFileData判断变量:`, {
        'content.type': content.type,
        'content.fileName': content.fileName,
        'content.fileSize': content.fileSize,
        'content.fileUri': content.fileUri,
        hasFileData,
      });

      if (hasFileData) {
        const fileTooLarge = content.fileSize! > autoDownloadMaxSize;

        console.log(`[HomeScreen] ${logPrefix}Auto-download check:`, {
          type: content.type,
          fileName: content.fileName,
          fileSize: content.fileSize,
          autoDownloadMaxSize,
          hasData: hasData,
          fileTooLarge,
          hasFileUri: !!content.fileUri,
        });

        if (fileTooLarge) {
          // 文件过大，跳过自动下载，同时标记需要跳过自动复制
          skipAutoCopyDueToLargeFile = true;
          console.log(
            `[HomeScreen] ${logPrefix}File too large (${content.fileSize} bytes > ${autoDownloadMaxSize} bytes), skipping auto-download and auto-copy`
          );
        } else {
          // 文件大小在限制内，执行自动下载并添加到历史
          console.log(
            `[HomeScreen] ${logPrefix}Auto-downloading file (${content.fileSize} bytes, limit: ${autoDownloadMaxSize} bytes)`
          );
          try {
            finalContent = await downloadAndAddToHistory(content, apiClient, hasData);
            console.log(`[HomeScreen] ${logPrefix}Auto-download completed:`, finalContent.fileUri);
          } catch (downloadError) {
            console.error(`[HomeScreen] ${logPrefix}Auto-download failed:`, downloadError);
            // 下载失败也跳过自动复制
            skipAutoCopyDueToLargeFile = true;
          }
        }
      }
    }

    // 更新界面显示（只调用一次，确保界面正确更新）
    setRemoteContent(finalContent);

    // 2. 处理自动复制
    // 只要检测到远程变化（不是首次加载），且启用了自动复制，就自动复制到本地剪贴板
    const isFirstLoad = previousHash === null;

    if (!isFirstLoad) {
      console.log(`[HomeScreen] ${logPrefix}Remote clipboard changed, updated display`);

      // 远程剪贴板内容添加到历史记录
      // 如果已在自动下载时添加过，则不再添加；否则如果 hasData=false，添加不含文件的记录
      const shouldAddToHistory =
        (hasData && !foundInHistory && !skipAutoCopyDueToLargeFile) || // 自动下载成功的已在 downloadAndAddToHistory 中添加
        !hasData; // 没有文件数据的需要添加

      if (shouldAddToHistory && !hasData) {
        // 没有文件数据，直接添加到历史记录
        try {
          const historyItem = createDefaultClipboardItem({
            type: finalContent.type,
            text: finalContent.text || '',
            profileHash: finalContent.profileHash || '',
            hasData: false,
            dataName: finalContent.fileName,
            size: finalContent.fileSize,
            timestamp: finalContent.timestamp || Date.now(),
            syncStatus: HistorySyncStatus.Synced,
          });
          await useHistoryStore.getState().addItem(historyItem);
          console.log(`[HomeScreen] ${logPrefix}Added remote clipboard (no file) to history`);
        } catch (error) {
          console.error(
            `[HomeScreen] ${logPrefix}Failed to add remote clipboard to history:`,
            error
          );
        }
      }

      // 自动同步：autoSync 开启，或后台且后台下载已开启时强制自动复制
      const autoSyncEnabled = config?.autoSync ?? false;
      const isAppInBackground = appState.current !== 'active';
      const bgDownloadEnabled = !!(
        config?.enableBackgroundTasks && config?.enableBackgroundDownload
      );
      const shouldAutoCopy = autoSyncEnabled || (isAppInBackground && bgDownloadEnabled);
      const remoteHash = finalContent.profileHash || finalContent.text || '';
      const localMatchesRemote = remoteHash === lastLocalProfileHash.current;
      if (localMatchesRemote) {
        console.log(
          `[HomeScreen] ${logPrefix}Remote content matches local clipboard, skipping auto-copy`
        );
      } else if (
        shouldAutoCopy &&
        activeServer &&
        !isAutoSyncing.current &&
        !skipAutoCopyDueToLargeFile &&
        finalContent.type === 'Text'
      ) {
        console.log(`[HomeScreen] ${logPrefix}Auto-copying remote changes to local clipboard`);
        isAutoSyncing.current = true;
        try {
          const result = await copyRemoteToLocal(finalContent, logPrefix);
          if (!result.success) {
            console.warn(
              `[HomeScreen] ${logPrefix}Auto-copy skipped due to error: ${result.message}`
            );
          } else if (Platform.OS === 'android') {
            const preview =
              finalContent.type === 'Text' && finalContent.text
                ? finalContent.text.trim().replace(/\s+/g, ' ').slice(0, 30)
                : finalContent.fileName || finalContent.type;
            if (config?.syncToastEnabled !== false) {
              ToastAndroid.show(`已下载\n${preview}`, ToastAndroid.SHORT);
            }
            SyncManager.getInstance().updateForegroundNotification(`已下载: ${preview}`);
          }
        } catch (error) {
          console.error(`[HomeScreen] ${logPrefix}Auto-copy to local clipboard failed:`, error);
        } finally {
          isAutoSyncing.current = false;
        }
      } else if (skipAutoCopyDueToLargeFile) {
        console.log(
          `[HomeScreen] ${logPrefix}Skipped auto-copy due to large file without auto-download`
        );
      }
    }
  };

  // 获取远程剪贴板内容
  const fetchRemoteClipboard = async (silent: boolean = false) => {
    if (!activeServer) {
      setRemoteContent(null);
      lastRemoteProfileHash.current = null;
      return;
    }

    if (!silent) {
      setLoadingRemote(true);
    }

    try {
      const apiClient = createAPIClient(activeServer);
      const profile = await apiClient.getClipboard();

      if (profile) {
        // 转换为 ClipboardContent
        const { profileDtoToContent } = await import('@/utils/clipboard');
        const content = profileDtoToContent(profile);
        const currentHash = content.profileHash || content.text || '';

        // 使用公共处理函数
        await processRemoteClipboardContent(
          content,
          currentHash,
          profile.hasData,
          apiClient,
          silent ? '' : 'Polling: ' // 日志前缀
        );
      } else {
        setRemoteContent(null);
        lastRemoteProfileHash.current = null;
      }
    } catch (error) {
      console.error('[HomeScreen] Failed to fetch remote clipboard:', error);
      if (!silent) {
        setRemoteContent(null);
        lastRemoteProfileHash.current = null;
        // 显示连接错误
        const errorMessage = error instanceof Error ? error.message : '无法连接到服务器';
        setError({
          title: '连接失败',
          message: errorMessage,
        });
      }
    } finally {
      if (!silent) {
        setLoadingRemote(false);
      }
    }
  };

  // 启动远程剪贴板轮询
  const startRemotePolling = () => {
    if (!activeServer || remotePollingTag.current) {
      if (remotePollingTag.current) {
        console.log('[HomeScreen] Polling already active, skipping');
      }
      return;
    }

    console.log(
      '[HomeScreen] Starting remote clipboard polling for server type:',
      activeServer.type
    );

    // 立即获取一次
    fetchRemoteClipboard(true);

    // 设置定时轮询
    const pollingInterval = config?.remotePollingInterval ?? 3000;
    remotePollingTag.current = setTimer(
      () => {
        fetchRemoteClipboard(true);
      },
      pollingInterval,
      'home_remote_poll'
    );
  };

  // 停止远程剪贴板轮询
  const stopRemotePolling = () => {
    if (remotePollingTag.current) {
      console.log('[HomeScreen] Stopping remote clipboard polling');
      clearTimer(remotePollingTag.current);
      remotePollingTag.current = null;
    }
  };

  // 连接 SignalR（统一客户端，Android 使用 native Java 实现，其他平台使用 JS 实现）
  const connectSignalR = async () => {
    if (!activeServer || activeServer.type !== 'syncclipboard') {
      console.log('[HomeScreen] Cannot connect SignalR - server type:', activeServer?.type);
      return;
    }

    try {
      console.log('[HomeScreen] Connecting SignalR for server:', activeServer.url);

      const client = getSignalRClient();

      // 注册远程剪贴板变化事件监听
      const handleProfileChanged = async (event: ProfileChangedEvent) => {
        console.log('[HomeScreen] SignalR: Remote clipboard changed');

        const { profileDtoToContent } = await import('@/utils/clipboard');
        const profile = {
          type: event.type as 'Text' | 'Image' | 'File' | 'Group',
          hash: event.hash,
          text: event.text,
          hasData: event.hasData,
          dataName: event.dataName,
          size: event.size,
        };
        const content = profileDtoToContent(profile);
        const currentHash = content.profileHash || content.text || '';

        const apiClient = createAPIClient(activeServer);
        await processRemoteClipboardContent(
          content,
          currentHash,
          profile.hasData,
          apiClient,
          'SignalR: '
        );
      };

      signalRProfileCallback.current = handleProfileChanged;
      client.onRemoteClipboardChanged(handleProfileChanged);

      // 连接
      await client.connect(activeServer);
      signalRConnected.current = true;

      // 连接后立即获取一次远程剪贴板
      await fetchRemoteClipboard(true);
    } catch (error) {
      console.error('[HomeScreen] Failed to connect SignalR:', error);
      signalRConnected.current = false;
    }
  };

  // 断开 SignalR
  const disconnectSignalR = async () => {
    if (signalRConnected.current) {
      console.log('[HomeScreen] Disconnecting SignalR...');
      const client = getSignalRClient();
      // 仅注销 HomeScreen 自身的回调，不影响 BackgroundServiceManager 的回调
      if (signalRProfileCallback.current) {
        client.offRemoteClipboardChanged(signalRProfileCallback.current);
        signalRProfileCallback.current = null;
      }
      signalRConnected.current = false;
      // 只有 BackgroundServiceManager 未维护 SignalR 连接时才断开
      const { getBackgroundServiceManager } = await import('@/services/BackgroundServiceManager');
      if (!getBackgroundServiceManager().isSignalRRunning()) {
        await client.disconnect();
      }
    }
  };

  // 处理上传文件
  const handleUploadFile = useCallback(async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      clearError();

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage('未选择文件', 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.name || 'file',
        mimeType: asset.mimeType,
        fileSize: asset.size,
      });
      setFileUploadLoadingText('正在处理文件…');
    } catch (error) {
      console.error('[HomeScreen] Failed to pick file:', error);
      showMessage('选择文件失败', 'error');
    }
  }, [activeServer, showMessage]);

  // 处理上传图片
  const handleUploadImage = useCallback(async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      clearError();

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage('未选择图片', 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
      setFileUploadLoadingText('正在处理图片…');
    } catch (error) {
      console.error('[HomeScreen] Failed to pick image:', error);
      showMessage('选择图片失败', 'error');
    }
  }, [activeServer, showMessage]);

  const fileUploadTask = useCallback(
    async (signal: AbortSignal) => {
      if (!activeServer) throw new Error('请先在设置中配置服务器');
      if (!fileUploadPayload) throw new Error('没有可上传的文件');

      await uploadFileAndAddToHistory(
        fileUploadPayload.uri,
        fileUploadPayload.fileName,
        fileUploadPayload.mimeType,
        fileUploadPayload.fileSize,
        activeServer,
        {
          signal,
          onProgress: (stage, progress) => {
            setFileUploadLoadingText(stage);
            setFileUploadProgress(progress ?? null);
          },
        }
      );
    },
    [fileUploadPayload, activeServer]
  );

  const handleFileUploadComplete = useCallback(() => {
    setFileUploadPayload(null);
    setFileUploadLoadingText('正在处理文件…');
    setFileUploadProgress(null);
  }, []);

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(
    () => [
      {
        label: '上传图片',
        onPress: handleUploadImage,
        disabled: !!fileUploadPayload,
      },
      {
        label: '上传文件',
        onPress: handleUploadFile,
        disabled: !!fileUploadPayload,
      },
    ],
    [handleUploadImage, handleUploadFile, fileUploadPayload]
  );

  // 设置标题栏菜单按钮
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TopRightMenu items={menuItems} />,
    });
  }, [navigation, menuItems]);

  // 页面加载时加载配置、启动剪贴板监听
  useEffect(() => {
    const initialize = async () => {
      if (!isLoaded) {
        await loadConfig();
      }

      // 先启动剪贴板持续监听（加载持久化的 hash）
      await startMonitoring();

      // 初始化历史记录同步服务（如果启用）- 必须在 getContent 之前
      const currentConfig = useSettingsStore.getState().config;
      if (currentConfig?.enableHistorySync && activeServer) {
        try {
          const { getHistorySyncService } = await import('@/services/HistorySyncService');
          const syncService = getHistorySyncService();
          await syncService.ensureInitialized(activeServer);
          console.log('[HomeScreen] HistorySyncService initialized');
        } catch (error) {
          console.error('[HomeScreen] Failed to initialize HistorySyncService:', error);
        }
      }

      // 最后获取剪贴板内容（此时持久化 hash 已加载，同步服务已初始化）
      await getContent();
    };
    initialize();

    // 组件卸载时停止监听
    return () => {
      stopMonitoring();
    };
  }, [isLoaded, loadConfig, getContent, startMonitoring, stopMonitoring, activeServer]);

  // 监听本地剪贴板变化，自动上传
  useEffect(() => {
    const autoSyncEnabled = config?.autoSync ?? false;
    const isAppInBackground = appState.current !== 'active';
    const bgUploadEnabled = !!(config?.enableBackgroundTasks && config?.enableBackgroundUpload);
    const shouldAutoUpload = autoSyncEnabled || (isAppInBackground && bgUploadEnabled);
    if (!activeServer || !shouldAutoUpload || !currentContent) {
      return;
    }

    const currentHash = currentContent.profileHash || currentContent.text || '';

    // 初始化时记录当前哈希，不触发同步
    if (lastLocalProfileHash.current === null) {
      lastLocalProfileHash.current = currentHash;
      return;
    }

    // 检查是否有变化
    if (currentHash !== lastLocalProfileHash.current) {
      console.log('[HomeScreen] Local clipboard changed, auto-syncing to remote');
      lastLocalProfileHash.current = currentHash;

      // 自动上传到远程
      if (!isAutoSyncing.current) {
        isAutoSyncing.current = true;
        sync(SyncDirection.Upload)
          .then((result) => {
            console.log('[HomeScreen] Auto-sync upload completed');
            if (result.success && !result.skipped) {
              if (Platform.OS === 'android' && currentContent) {
                const preview =
                  currentContent.type === 'Text' && currentContent.text
                    ? currentContent.text.trim().replace(/\s+/g, ' ').slice(0, 30)
                    : currentContent.fileName || currentContent.type;
                if (config?.syncToastEnabled !== false) {
                  ToastAndroid.show(`已上传\n${preview}`, ToastAndroid.SHORT);
                }
                SyncManager.getInstance().updateForegroundNotification(`已上传: ${preview}`);
              }
            }
            // 刷新远程显示
            fetchRemoteClipboard(true);
          })
          .catch((error) => {
            console.error('[HomeScreen] Auto-sync upload failed:', error);
          })
          .finally(() => {
            isAutoSyncing.current = false;
          });
      }
    }
  }, [currentContent, activeServer, config, sync]);

  // 监听本地轮询间隔配置变化
  useEffect(() => {
    const localInterval = config?.localPollingInterval ?? 1000;
    updatePollingInterval(localInterval);
  }, [config?.localPollingInterval, updatePollingInterval]);

  // 当服务器配置改变时，启动/停止远程轮询或 SignalR
  useEffect(() => {
    const initializeRemoteSync = async () => {
      console.log('[HomeScreen] Initializing remote sync for server type:', activeServer?.type);

      // 先停止现有的连接
      stopRemotePolling();
      await disconnectSignalR();
      lastRemoteProfileHash.current = null;

      if (activeServer) {
        // 销毁旧的 SyncManager 实例，然后重新初始化（这样才能使用新的服务器配置）
        console.log(
          '[HomeScreen] Destroying old SyncManager and reinitializing with new server:',
          activeServer.url
        );
        await destroySync();
        await initializeSync();

        // 立即获取一次（显示 loading）
        await fetchRemoteClipboard(false);

        // 根据服务器类型选择 SignalR 或轮询
        console.log(
          '[HomeScreen] Server type is:',
          activeServer.type,
          '| Will use:',
          activeServer.type === 'syncclipboard' ? 'SignalR' : 'Polling'
        );

        if (activeServer.type === 'syncclipboard') {
          // 使用 SignalR 实时通信
          await connectSignalR();
        } else {
          // 使用轮询模式
          startRemotePolling();
        }
      } else {
        console.log('[HomeScreen] No active server configured');
        setRemoteContent(null);
        // 也销毁 SyncManager 当没有服务器时
        await destroySync();
      }
    };

    initializeRemoteSync();

    return () => {
      stopRemotePolling();
      disconnectSignalR();
    };
  }, [activeServer, config, initializeSync, destroySync]);

  // 管理后台服务生命周期（委托给 BackgroundServiceManager）
  // 包括前台服务、SMS 服务、剪贴板监控、后台上传/下载轮询、心跳统计、通知栏停止监听
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    import('@/services/BackgroundServiceManager').then(({ getBackgroundServiceManager }) => {
      getBackgroundServiceManager()
        .refresh()
        .catch(() => {});
    });
  }, [
    isTempDisabledBackgroundTasks,
    config?.enableBackgroundTasks,
    config?.enableForegroundNotification,
    config?.enableBackgroundDownload,
    config?.enableBackgroundUpload,
    config?.enableSmsForwarding,
  ]);

  // 监听应用状态变化，控制远程剪贴板轮询或 SignalR
  // 本地剪贴板已由 ClipboardMonitor 持续监听，无需在此处处理
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextAppState: AppStateStatus) => {
        // 当从后台切换到前台时
        if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
          console.log('[HomeScreen] App has come to the foreground');
          await getContent();

          // 如果有配置服务器
          if (activeServer) {
            if (activeServer.type === 'syncclipboard') {
              // SignalR 会自动重连，但我们手动刷新一次
              if (getSignalRClient().isConnected()) {
                await fetchRemoteClipboard(true);
              } else {
                await connectSignalR();
              }
            } else {
              // 轮询模式：启动轮询
              startRemotePolling();
            }
          }
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
          console.log('[HomeScreen] App has gone to the background');

          // 后台下载启用时不停止轮询，让轮询在后台继续运行
          const bgDownloadEnabled =
            useSettingsStore.getState().config?.enableBackgroundTasks &&
            useSettingsStore.getState().config?.enableBackgroundDownload;
          if (!bgDownloadEnabled) {
            // 应用进入后台，停止轮询和 SignalR
            stopRemotePolling();
            await disconnectSignalR();
          } else {
            console.log('[HomeScreen] Background download enabled, keeping remote polling active');
          }
        }

        appState.current = nextAppState;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [activeServer, getContent]);

  // 下拉刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getContent();
      if (activeServer) {
        // 只刷新远程剪贴板显示，不自动下载复制
        // 用户可以通过点击"下载"按钮手动复制到剪贴板
        await fetchRemoteClipboard(false);
      }
    } catch (error) {
      console.error('[HomeScreen] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // 快速操作
  const handleUpload = async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      clearError();
      setUploadingClipboard(true);
      const abortController = new AbortController();
      clipboardUploadAbortControllerRef.current = abortController;

      console.log('[HomeScreen] Starting upload...');
      const result = await sync(SyncDirection.Upload, abortController.signal);
      console.log('[HomeScreen] Upload result:', JSON.stringify(result, null, 2));

      if (result.success) {
        await fetchRemoteClipboard(true);
        showMessage('剪贴板已上传到服务器', 'success');
      } else {
        const errorMessage = result.error || '上传失败';
        console.log('[HomeScreen] Upload failed, setting error:', errorMessage);
        setError({
          title: '上传失败',
          message: errorMessage,
        });
        showMessage('上传失败', 'error');
      }
    } catch (error: unknown) {
      console.error('[HomeScreen] Upload exception:', error);
      const errorMessage = error instanceof Error ? error.message : '无法上传到服务器';
      const normalizedMessage = errorMessage.toLowerCase();
      const isCanceled =
        (error instanceof Error && error.name === 'AbortError') ||
        normalizedMessage.includes('abort') ||
        normalizedMessage.includes('canceled') ||
        normalizedMessage.includes('cancelled');

      if (isCanceled) {
        showMessage('已取消上传', 'info');
        return;
      }

      const errorObj = error instanceof Error ? (error as unknown as Record<string, unknown>) : {};
      const errorDetails =
        error instanceof Error && errorObj.response
          ? JSON.stringify((errorObj.response as Record<string, unknown>).data, null, 2)
          : errorMessage;
      console.log('[HomeScreen] Setting error details:', errorDetails);
      setError({
        title: '上传失败',
        message: errorDetails,
      });
      showMessage('上传失败', 'error');
    } finally {
      clipboardUploadAbortControllerRef.current = null;
      setUploadingClipboard(false);
    }
  };

  // 取消剪贴板上传
  const handleCancelClipboardUpload = useCallback(() => {
    if (!uploadingClipboard) {
      return;
    }

    if (clipboardUploadAbortControllerRef.current) {
      clipboardUploadAbortControllerRef.current.abort();
      showMessage('正在取消上传...', 'info');
    }
  }, [uploadingClipboard, showMessage]);

  const handleCopyError = async () => {
    if (error) {
      await ClipboardProxy.setStringAsync(`${error.title}\n\n${error.message}`);
      showMessage('错误信息已复制', 'success');
    }
  };

  // WebDAV 服务器：直接下载
  const downloadForWebDAV = async () => {
    if (!activeServer || !remoteContent) return;

    setDownloadingRemote(true);
    setDownloadProgress(null);
    const abortController = new AbortController();
    downloadAbortControllerRef.current = abortController;

    const onProgress: DownloadProgressCallback = (info) => {
      setDownloadProgress({
        progress: info.progress,
        bytesTransferred: info.bytesTransferred,
        totalBytes: info.totalBytes,
      });
    };

    try {
      const apiClient = createAPIClient(activeServer);
      const updatedContent = await downloadAndAddToHistory(
        remoteContent,
        apiClient,
        remoteContent.hasData || false,
        abortController.signal,
        onProgress
      );
      setRemoteContent(updatedContent);
      showMessage('文件已下载', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '文件下载失败';
      const normalizedMessage = errorMessage.toLowerCase();
      const isCanceled =
        (error instanceof Error && error.name === 'AbortError') ||
        normalizedMessage.includes('abort') ||
        normalizedMessage.includes('canceled') ||
        normalizedMessage.includes('cancelled');

      if (isCanceled) {
        showMessage('已取消下载', 'info');
        return;
      }

      console.error('[HomeScreen] Failed to download remote file:', error);
      showMessage('文件下载失败', 'error');
    } finally {
      downloadAbortControllerRef.current = null;
      setDownloadingRemote(false);
      setDownloadProgress(null);
    }
  };

  // SyncClipboard 服务器：使用下载队列
  const downloadForSyncClipboard = async () => {
    if (!activeServer || !remoteContent?.profileHash) return;

    const { getHistorySyncService } = await import('@/services/HistorySyncService');
    const syncService = getHistorySyncService();
    const initialized = await syncService.ensureInitialized(activeServer);
    if (!initialized) {
      showMessage('历史同步服务初始化失败', 'error');
      return;
    }

    const profileId = getProfileId(remoteContent.type, remoteContent.profileHash);
    const queue = getHistoryTransferQueue();

    try {
      const historyItem = createDefaultClipboardItem({
        type: remoteContent.type,
        text: remoteContent.text || '',
        profileHash: remoteContent.profileHash,
        hasData: remoteContent.hasData || false,
        dataName: remoteContent.fileName,
        size: remoteContent.fileSize,
        timestamp: remoteContent.timestamp || Date.now(),
        syncStatus: HistorySyncStatus.NeedSync,
        hasRemoteData: true,
        isLocalFileReady: false,
      });
      await useHistoryStore.getState().addItem(historyItem);
    } catch (error) {
      console.error('[HomeScreen] Failed to add history item before download:', error);
    }

    await queue.addDownloadTask(profileId, true);
    showMessage('已添加到下载队列', 'info');
  };

  // 取消下载 - WebDAV
  const cancelDownloadForWebDAV = () => {
    if (downloadAbortControllerRef.current) {
      downloadAbortControllerRef.current.abort();
      showMessage('正在取消下载...', 'info');
    }
  };

  // 取消下载 - SyncClipboard
  const cancelDownloadForSyncClipboard = () => {
    if (remoteContent?.profileHash) {
      const profileId = getProfileId(remoteContent.type, remoteContent.profileHash);
      const queue = getHistoryTransferQueue();
      queue.cancelTask(profileId, 'download');
      showMessage('已取消下载', 'info');
    }
  };

  // 检查是否需要下载文件
  const needsDownload = useMemo(() => {
    if (!remoteContent) return false;
    return (
      (remoteContent.type === 'Text' &&
        remoteContent.hasData &&
        remoteContent.fileName &&
        !remoteContent.fileUri) ||
      (remoteContent.type === 'Image' && remoteContent.fileName && !remoteContent.fileUri) ||
      (remoteContent.type === 'File' && remoteContent.fileName && !remoteContent.fileUri)
    );
  }, [remoteContent]);

  // 下载远程剪贴板的文件数据
  const handleDownloadRemoteFile = async () => {
    if (!activeServer || !remoteContent || !needsDownload) return;

    if (activeServer.type !== 'syncclipboard') {
      await downloadForWebDAV();
    } else {
      await downloadForSyncClipboard();
    }
  };

  // 取消下载
  const handleCancelDownload = useCallback(() => {
    if (activeServer?.type !== 'syncclipboard') {
      cancelDownloadForWebDAV();
    } else {
      cancelDownloadForSyncClipboard();
    }
  }, [activeServer, remoteContent, showMessage]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* 当有服务器配置时显示远程和本地剪贴板 */}
        {activeServer ? (
          <>
            {/* 远程剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                远程剪贴板
              </Text>
              {loadingRemote ? (
                <View style={[styles.loadingCard, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    加载中...
                  </Text>
                </View>
              ) : (
                <CurrentClipboardCard
                  clipboard={remoteContent}
                  isRemote={true}
                  onDownload={handleDownloadRemoteFile}
                  downloading={
                    activeServer?.type === 'syncclipboard' ? isRemoteDownloading : downloadingRemote
                  }
                  downloadProgress={
                    activeServer?.type === 'syncclipboard'
                      ? remoteDownloadProgress
                      : downloadProgress
                  }
                  onCancelDownload={handleCancelDownload}
                  onCopy={async (content) => {
                    const result = await copyRemoteToLocal(content, 'Manual copy: ');
                    if (result.success) {
                      showMessage('已复制到剪贴板', 'success');
                    } else {
                      showMessage(result.message || '复制失败', 'error');
                    }
                  }}
                  onWordPick={setWordPickerText}
                />
              )}
            </View>

            {/* 本地剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                本地剪贴板
              </Text>
              <CurrentClipboardCard
                clipboard={currentContent}
                isRemote={false}
                onUpload={handleUpload}
                uploading={uploadingClipboard}
                onCancelUpload={handleCancelClipboardUpload}
                onCopy={copyLocalToClipboard}
                onWordPick={setWordPickerText}
              />

              {/* 错误信息卡片 */}
              {error && (
                <View
                  style={[
                    styles.errorCard,
                    {
                      backgroundColor: theme.colors.errorBackground,
                      borderColor: theme.colors.errorBorder,
                    },
                  ]}
                >
                  <View style={styles.errorHeader}>
                    <Text style={[styles.errorTitle, { color: theme.colors.errorTitle }]}>
                      {error.title}
                    </Text>
                    <TouchableOpacity
                      style={[styles.copyButton, { backgroundColor: theme.colors.errorTitle }]}
                      onPress={handleCopyError}
                    >
                      <Text style={[styles.copyButtonText, { color: theme.colors.white }]}>
                        复制错误
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.errorScrollView} nestedScrollEnabled={true}>
                    <Text style={[styles.errorText, { color: theme.colors.errorText }]}>
                      {error.message}
                    </Text>
                  </ScrollView>
                  <TouchableOpacity style={styles.dismissButton} onPress={() => clearError()}>
                    <Text style={[styles.dismissButtonText, { color: theme.colors.errorTitle }]}>
                      关闭
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* 未配置服务器时只显示本地剪贴板 */}
            <CurrentClipboardCard
              clipboard={currentContent}
              isRemote={false}
              onCopy={copyLocalToClipboard}
              onWordPick={setWordPickerText}
            />
          </>
        )}

        {/* 空状态提示 */}
        {!activeServer && (
          <View style={[styles.emptyState, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>未配置服务器</Text>
            <Text style={[styles.emptyStateText, { color: theme.colors.textSecondary }]}>
              请在"设置"页面添加服务器配置以启用同步功能
            </Text>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={clearMessage} />

      {fileUploadPayload && (
        <View style={styles.fullScreenOverlay}>
          <QuickLoadingPage
            task={fileUploadTask}
            loadingText={fileUploadLoadingText}
            successText="上传成功"
            failureText="上传失败"
            onComplete={handleFileUploadComplete}
            progress={fileUploadProgress}
            previewText={fileUploadPayload.fileName}
            previewImage={
              fileUploadPayload.mimeType?.startsWith('image/') ? fileUploadPayload.uri : undefined
            }
          />
        </View>
      )}

      {wordPickerText && (
        <View style={styles.fullScreenOverlay}>
          <WordPickerScreen text={wordPickerText} onComplete={() => setWordPickerText(null)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fullScreenOverlay: {
    ...StyleSheet.absoluteFill,
  },

  infoLabelSpaced: {
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  loadingCard: {
    borderRadius: 12,
    padding: 16,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 15,
  },
  emptyState: {
    marginTop: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  infoCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    marginTop: 4,
  },
  bottomPadding: {
    height: 100,
  },
  errorCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  copyButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorScrollView: {
    maxHeight: 200,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dismissButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
