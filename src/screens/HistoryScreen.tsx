/**
 * History Screen
 * 历史记录页面 - 显示剪贴板历史记录
 */

import React, { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActionSheetIOS,
  Platform,
  Modal,
  Pressable,
  Share,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { Check, ArrowUp, RefreshCw, List } from 'react-native-feather';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/hooks/useTheme';
import { useHistoryStore } from '@/stores/historyStore';
import { useSettingsStore } from '@/stores';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { useHistoryDisplaySettings } from '@/hooks/useHistoryDisplaySettings';
import { ClipboardItem, ClipboardContent, createDefaultClipboardItem } from '@/types/clipboard';
import { HistoryFilter } from '@/types/storage';
import { HistoryListItem, type HistoryListItemHandle } from '@/components/HistoryListItem';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { TransferQueueModal } from '@/components/TransferQueueModal';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { openFile, saveFile, shareFile, saveToGallery } from '@/utils/fileActions';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { calculateTextHash } from '@/utils/hash';
import { importFileToHistory } from '@/utils/uploadFile';
import { isHistorySyncEnabled } from '@/utils/config';

type FilterType = 'all' | 'Text' | 'Image' | 'File' | 'starred' | 'transferring';

const FILTER_LABELS: Record<FilterType, string> = {
  all: '全部',
  Text: '文本',
  Image: '图片',
  File: '文件',
  starred: '收藏',
  transferring: '传输中',
};

export function HistoryScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const {
    items,
    totalCount,
    isLoading,
    loadItems,
    searchItems,
    addItems,
    deleteItem,
    clearHistory,
    currentPage,
    toggleStar,
    lastAddedTimestamp,
    handleStorageChange,
  } = useHistoryStore();
  const { config } = useSettingsStore();

  const { showFullImage, setShowFullImage } = useHistoryDisplaySettings();

  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<ClipboardItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [sortField, setSortField] = useState<'timestamp' | 'lastAccessed'>('timestamp');
  const { message, showMessage, clearMessage } = useMessageStore();
  const { setError } = useErrorStore();
  const actionSheetTranslateY = useRef(new Animated.Value(320)).current;
  const isDebugMode = config?.debugMode ?? false;
  const [showTransferQueue, setShowTransferQueue] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);
  const {
    hasTasks,
    pendingCount,
    activeCount,
    subscribe: subscribeTransferQueue,
  } = useTransferQueueStore();

  const historySyncEnabled = useMemo(() => isHistorySyncEnabled(config), [config]);

  const ensureSyncServiceInitialized = useCallback(async (): Promise<boolean> => {
    if (!historySyncEnabled) {
      return false;
    }

    const serverConfig = config!.servers[config!.activeServerIndex];
    const { getHistorySyncService } = await import('@/services/HistorySyncService');
    const syncService = getHistorySyncService();
    return syncService.ensureInitialized(serverConfig);
  }, [config, historySyncEnabled]);

  // 加载排序设置
  useEffect(() => {
    const loadSortSetting = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const savedSort = await AsyncStorage.getItem('@syncclipboard:history:sort_field');
        if (savedSort === 'timestamp' || savedSort === 'lastAccessed') {
          setSortField(savedSort);
        }
      } catch (error) {
        console.warn('[HistoryScreen] Failed to load sort setting:', error);
      }
    };
    loadSortSetting();
  }, []);

  useEffect(() => {
    return subscribeTransferQueue();
  }, [subscribeTransferQueue]);

  // 保存排序设置
  const handleSortChange = useCallback(async (field: 'timestamp' | 'lastAccessed') => {
    setSortField(field);
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('@syncclipboard:history:sort_field', field);
    } catch (error) {
      console.warn('[HistoryScreen] Failed to save sort setting:', error);
    }
  }, []);

  const listRef = useRef<FlashListRef<ClipboardItem>>(null);
  const isScrolledRef = useRef(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const itemRefsMap = useRef<Map<string, React.RefObject<HistoryListItemHandle | null>>>(
    new Map()
  ).current;

  // 清理不在列表中的 ref
  useEffect(() => {
    const currentHashes = new Set(items.map((item) => item.profileHash));
    for (const hash of itemRefsMap.keys()) {
      if (!currentHashes.has(hash)) {
        itemRefsMap.delete(hash);
      }
    }
  }, [items, itemRefsMap]);

  // 获取或创建 ref
  const getOrCreateItemRef = useCallback(
    (profileHash: string) => {
      let itemRef = itemRefsMap.get(profileHash);
      if (!itemRef) {
        itemRef = React.createRef<HistoryListItemHandle>();
        itemRefsMap.set(profileHash, itemRef as React.RefObject<HistoryListItemHandle | null>);
      }
      return itemRef as React.RefObject<HistoryListItemHandle>;
    },
    [itemRefsMap]
  );

  const openActionSheet = useCallback(() => {
    actionSheetTranslateY.setValue(320);
    setShowActionSheet(true);
    requestAnimationFrame(() => {
      Animated.timing(actionSheetTranslateY, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [actionSheetTranslateY]);

  const closeActionSheet = useCallback(
    (onClosed?: () => void) => {
      Animated.timing(actionSheetTranslateY, {
        toValue: 320,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setShowActionSheet(false);
          onClosed?.();
        }
      });
    },
    [actionSheetTranslateY]
  );

  // 搜索防抖（含初始加载）
  useEffect(() => {
    if (isReorganizing) {
      return;
    }

    const timer = setTimeout(() => {
      // 根据当前筛选类型构建 filter 参数
      let filter: HistoryFilter | undefined;
      if (searchText) {
        filter = { keyword: searchText };
        // 搜索时保持当前分类筛选
        switch (filterType) {
          case 'Text':
          case 'Image':
          case 'File':
            filter.type = [filterType];
            break;
          case 'starred':
            filter.starredOnly = true;
            break;
          case 'transferring':
            filter.syncStatus = [2];
            break;
        }
      } else {
        // 无搜索关键词时，根据当前分类筛选
        switch (filterType) {
          case 'Text':
          case 'Image':
          case 'File':
            filter = { type: [filterType] };
            break;
          case 'starred':
            filter = { starredOnly: true };
            break;
          case 'transferring':
            filter = { syncStatus: [2] };
            break;
          default:
            filter = undefined;
        }
      }
      searchItems(filter);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText, searchItems, isReorganizing, filterType]);

  // 监听新项目添加，如果列表未滚动则滚动到顶部
  useEffect(() => {
    if (lastAddedTimestamp > 0 && !isScrolledRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
            });
          });
        });
      });
    }
  }, [lastAddedTimestamp]);

  // 监听 HistoryStorage 变更，实时更新 UI
  useEffect(() => {
    const { HistoryStorage } = require('@/services/HistoryStorage');
    const storage = HistoryStorage.getInstance();

    const handleChange = (items: ClipboardItem[], action: 'add' | 'update' | 'delete') => {
      handleStorageChange(items, action);
    };

    storage.addChangeCallback(handleChange);

    return () => {
      storage.removeChangeCallback(handleChange);
    };
  }, [handleStorageChange]);

  // 滚动事件处理
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    isScrolledRef.current = offsetY > 10;
    setShowScrollToTop(offsetY > 200);
  }, []);

  // 排序数据（置顶记录始终在顶部）
  const sortedItems = useMemo(() => {
    const result = [...items];

    // 排序：置顶记录始终在顶部
    result.sort((a, b) => {
      // 置顶记录优先
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) {
        return bPinned - aPinned;
      }

      // 按选定字段排序
      if (sortField === 'lastAccessed') {
        const aAccessed = a.lastAccessed || a.timestamp;
        const bAccessed = b.lastAccessed || b.timestamp;
        return bAccessed - aAccessed;
      }

      // 默认按创建时间排序
      return b.timestamp - a.timestamp;
    });

    return result;
  }, [items, sortField]);

  // 回到顶部
  const handleScrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // ClipboardItem 转换为 ClipboardContent 后调用公共复制函数
  const copyItemWithSync = useCallback(async (item: ClipboardItem) => {
    // 构建 ClipboardContent
    // 对于Text类型的hasData，不在内存中读取完整文本，只设置fileUri
    // 完整文本的读取将在 copyToLocalClipboard 中进行
    const content: ClipboardContent = {
      type: item.type,
      text: item.text, // 预览文本或完整文本（如果hasData为false）
      profileHash: item.profileHash,
      fileUri: item.fileUri, // 对于hasData为true且需要完整文本的情况，使用fileUri
      fileName: item.dataName,
      fileSize: item.size,
      timestamp: item.timestamp,
      localClipboardHash: item.localClipboardHash,
      hasData: item.hasData, // 添加 hasData 字段
    };
    return copyToLocalClipboard(content);
  }, []);

  // 点击列表项 - 复制到剪贴板
  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      const result = await copyItemWithSync(item);
      if (result.success) {
        showMessage(result.message, 'success');
      } else {
        showMessage(result.message || '复制失败', 'error');
      }
    },
    [showMessage, copyItemWithSync]
  );

  // 复制项目
  const handleCopyItem = useCallback(
    async (item: ClipboardItem) => {
      const result = await copyItemWithSync(item);
      showMessage(result.message, result.success ? 'success' : 'error');
      closeActionSheet();
    },
    [showMessage, copyItemWithSync, closeActionSheet]
  );

  // 真正执行删除的函数 - 与存储交互
  const performDelete = useCallback(
    async (item: ClipboardItem) => {
      try {
        await deleteItem(item.profileHash);
        showMessage('已删除', 'success');
        // 同步由 HistorySyncService.handleLocalHistoryChanged 自动处理
      } catch (error) {
        console.error('[HistoryScreen] Failed to delete:', error);
        showMessage('删除失败', 'error');
      }
    },
    [deleteItem, showMessage]
  );

  // 菜单删除处理 - 触发 UI 动画，由 HistoryListItem 的 onDelete 执行真正删除
  const handleDeleteFromMenu = useCallback(
    (item: ClipboardItem) => {
      // 关闭操作表单
      closeActionSheet();

      // 触发 item 的删除动画，动画完成后会自动调用 onDelete (performDelete)
      const itemRef = itemRefsMap.get(item.profileHash);
      if (itemRef?.current) {
        itemRef.current.startDelete();
      }
    },
    [itemRefsMap, closeActionSheet]
  );

  // 分享项目
  const handleShare = useCallback(
    async (item: ClipboardItem) => {
      try {
        if (item.type === 'Text' && item.text) {
          await Share.share({
            message: item.text,
            title: '分享文本',
          });
        } else if (item.fileUri) {
          await shareFile(item.fileUri, item.dataName);
        } else {
          showMessage('暂不支持分享此类型的内容', 'info');
        }
      } catch (error) {
        console.error('[HistoryScreen] Failed to share:', error);
        showMessage('分享失败', 'error');
      }
    },
    [showMessage]
  );

  // 储存文件到设备（图片类型保存到相册）
  const handleSave = useCallback(
    async (item: ClipboardItem) => {
      if (!item.fileUri) return;
      try {
        if (item.type === 'Image') {
          await saveToGallery(item.fileUri);
          showMessage('已保存到相册', 'success');
        } else {
          await saveFile(item.fileUri, item.dataName);
          showMessage('已储存到设备', 'success');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Storage permission denied') {
          showMessage('已取消储存', 'info');
          return;
        }
        if (error instanceof Error && error.message === 'Media library permission denied') {
          showMessage('需要相册权限才能保存图片', 'error');
          return;
        }
        console.error('[HistoryScreen] Failed to save file:', error);
        showMessage('储存失败', 'error');
      }
    },
    [showMessage]
  );

  // 打开文件
  const handleOpen = useCallback(
    async (item: ClipboardItem) => {
      if (!item.fileUri) return;
      try {
        await openFile(item.fileUri);
      } catch (error) {
        console.error('[HistoryScreen] Failed to open file:', error);
        showMessage('打开失败', 'error');
      }
    },
    [showMessage]
  );

  // 切换收藏状态
  const handleToggleStar = useCallback(
    async (item: ClipboardItem) => {
      try {
        await toggleStar(item.profileHash);
        // 同步由 HistorySyncService.handleLocalHistoryChanged 自动处理
      } catch (error) {
        console.error('[HistoryScreen] Failed to toggle star:', error);
        showMessage('操作失败', 'error');
      }
    },
    [toggleStar, showMessage]
  );

  // 长按列表项 - 显示操作菜单
  const handleItemLongPress = useCallback(
    (item: ClipboardItem) => {
      setSelectedItem(item);

      if (Platform.OS === 'ios') {
        // 根据类型构建菜单选项
        const options: string[] = ['取消'];
        const actions: Array<() => void> = [];

        // Text: 复制、删除
        // Image: 分享、复制、删除
        // File/Group: 分享、删除

        if (
          (item.type === 'Image' || item.type === 'File' || item.type === 'Group') &&
          item.fileUri
        ) {
          options.push('打开');
          actions.push(() => handleOpen(item));
        }

        if (item.type === 'Image' || item.type === 'File' || item.type === 'Group') {
          options.push('分享');
          actions.push(() => handleShare(item));
        }

        if (item.type === 'Image' || item.type === 'File' || item.type === 'Group') {
          if (item.fileUri) {
            options.push(item.type === 'Image' ? '保存到相册' : '储存到设备');
            actions.push(() => handleSave(item));
          }
        }

        if (item.type === 'Text') {
          options.push('复制');
          actions.push(() => handleCopyItem(item));
        }

        options.push('删除');
        actions.push(() => handleDeleteFromMenu(item));

        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            destructiveButtonIndex: options.length - 1, // 删除始终是最后一项
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex > 0 && buttonIndex <= actions.length) {
              actions[buttonIndex - 1]();
            }
          }
        );
      } else {
        openActionSheet();
      }
    },
    [handleCopyItem, handleOpen, handleShare, handleSave, handleDeleteFromMenu, openActionSheet]
  );

  // 清空所有历史记录
  const handleClearAll = useCallback(() => {
    Alert.alert('确认清空', '确定要清空所有历史记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearHistory();
            const { getHistorySyncService } = await import('@/services/HistorySyncService');
            const syncService = getHistorySyncService();
            await syncService.resetSyncCursor();
            showMessage('已清空所有历史记录', 'success');
          } catch (error) {
            console.error('[HistoryScreen] Failed to clear:', error);
            showMessage('清空失败', 'error');
          }
        },
      },
    ]);
  }, [clearHistory, showMessage]);

  // 添加文件到历史记录
  const handleImportFile = useCallback(async () => {
    try {
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

      const fileName = asset.name || 'file';

      setImportingFile(true);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      await importFileToHistory(asset.uri, fileName, asset.mimeType, asset.size);

      showMessage(`文件 ${fileName} 已添加到历史记录`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '添加文件失败，请重试';
      console.error('[HistoryScreen] Failed to import file:', error);
      showMessage(errorMessage, 'error');
    } finally {
      setImportingFile(false);
    }
  }, [showMessage]);

  // 添加图片到历史记录
  const handleImportImage = useCallback(async () => {
    try {
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

      const fileName = asset.fileName || `image_${Date.now()}.jpg`;

      setImportingFile(true);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      await importFileToHistory(asset.uri, fileName, asset.mimeType, asset.fileSize);

      showMessage(`图片 ${fileName} 已添加到历史记录`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '添加图片失败，请重试';
      console.error('[HistoryScreen] Failed to import image:', error);
      showMessage(errorMessage, 'error');
    } finally {
      setImportingFile(false);
    }
  }, [showMessage]);

  // 重新同步历史记录
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 同步动画
  const syncRotation = useRef(new Animated.Value(0)).current;
  const syncAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isSyncing) {
      syncRotation.setValue(0);
      const animation = Animated.loop(
        Animated.timing(syncRotation, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animation.start();
      syncAnimationRef.current = animation;
    } else {
      syncAnimationRef.current?.stop();
      syncAnimationRef.current = null;
      syncRotation.setValue(0);
    }
  }, [isSyncing, syncRotation]);

  const syncRotationInterpolate = syncRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleResyncHistory = useCallback(async () => {
    if (isSyncing) return;

    const initialized = await ensureSyncServiceInitialized();
    if (!initialized) {
      showMessage('请先配置服务器', 'error');
      return;
    }

    const { getHistorySyncService } = await import('@/services/HistorySyncService');
    const syncService = getHistorySyncService();

    setIsSyncing(true);
    showMessage('开始同步历史记录...', 'info');

    try {
      await syncService.syncAll((progress: { message?: string }) => {
        if (progress.message) {
          console.log(`[HistoryScreen] Sync progress: ${progress.message}`);
        }
      });
      showMessage('历史记录同步完成', 'success');
    } catch (error) {
      console.error('[HistoryScreen] Failed to resync history:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setError({
        title: '历史记录同步失败',
        message: errorMessage,
      });
      showMessage('同步失败: ' + errorMessage, 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, showMessage, setError, ensureSyncServiceInitialized]);

  const handleIncrementalSync = useCallback(
    async (isPullToRefresh = false) => {
      if (isSyncing) return;

      const initialized = await ensureSyncServiceInitialized();
      if (!initialized) {
        return;
      }

      const { getHistorySyncService } = await import('@/services/HistorySyncService');
      const syncService = getHistorySyncService();

      setIsSyncing(true);
      if (isPullToRefresh) {
        setIsRefreshing(true);
      }

      try {
        await syncService.syncIncremental();
      } catch (error) {
        console.error('[HistoryScreen] Failed to incremental sync:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        setError({
          title: '历史记录增量同步失败',
          message: errorMessage,
        });
      } finally {
        setIsSyncing(false);
        if (isPullToRefresh) {
          setIsRefreshing(false);
        }
      }
    },
    [isSyncing, setError, ensureSyncServiceInitialized]
  );

  useFocusEffect(
    useCallback(() => {
      const onScreenFocus = async () => {
        const currentConfig = useSettingsStore.getState().config;
        if (currentConfig?.needsHistoryReorganize) {
          const { getHistorySyncService } = await import('@/services/HistorySyncService');
          const syncService = getHistorySyncService();
          await syncService.resetSyncCursor();

          const latestConfig = useSettingsStore.getState().config;
          const shouldReorganize = !isHistorySyncEnabled(latestConfig);

          if (!shouldReorganize) {
            console.log('[HistoryScreen] Skipped history reorganization (sync re-enabled)');
            await useSettingsStore.getState().updateConfig({ needsHistoryReorganize: false });
          } else {
            setIsReorganizing(true);
            console.log('[HistoryScreen] Starting history reorganization...');

            const { HistoryStorage } = await import('@/services/HistoryStorage');
            const historyStorage = HistoryStorage.getInstance();
            historyStorage.beginSilentMode();

            try {
              await syncService.cleanupRemoteHistorys();
              await historyStorage.cleanupByCount();
              console.log('[HistoryScreen] History reorganization completed');
              await useSettingsStore.getState().updateConfig({ needsHistoryReorganize: false });
            } catch (error) {
              console.error('[HistoryScreen] History reorganization failed:', error);
            } finally {
              setIsReorganizing(false);
              historyStorage.endSilentMode();
              await useHistoryStore.getState().refresh();
            }
          }
        }

        if (historySyncEnabled) {
          console.log('[HistoryScreen] Screen focused, starting incremental sync');
          const { getHistorySyncService } = await import('@/services/HistorySyncService');
          const syncService = getHistorySyncService();
          const serverConfig = currentConfig?.servers[currentConfig?.activeServerIndex];
          if (serverConfig) {
            const initialized = await syncService.ensureInitialized(serverConfig);
            if (initialized) {
              setIsSyncing(true);
              try {
                await syncService.syncIncremental();
              } catch (error) {
                console.error('[HistoryScreen] Failed to incremental sync:', error);
                const errorMessage = error instanceof Error ? error.message : '未知错误';
                setError({
                  title: '历史记录增量同步失败',
                  message: errorMessage,
                });
              } finally {
                setIsSyncing(false);
              }
            }
          }
        }
      };

      onScreenFocus();
    }, [historySyncEnabled])
  );

  const generateRandomDebugText = useCallback(() => {
    const randomInt = (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min;

    const totalChars = randomInt(0, 100);
    const lineCount = randomInt(0, 5);

    if (totalChars === 0 || lineCount === 0) {
      return '';
    }

    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789，。！？；：、-_[](){}<>/\\@#%&*+= 空格测试随机内容';

    const buildLine = (length: number) => {
      let line = '';
      for (let i = 0; i < length; i++) {
        const index = randomInt(0, chars.length - 1);
        line += chars[index];
      }
      return line;
    };

    let remaining = totalChars;
    const lines: string[] = [];

    for (let i = 0; i < lineCount; i++) {
      const isLastLine = i === lineCount - 1;
      const currentLength = isLastLine ? remaining : randomInt(0, remaining);
      lines.push(buildLine(currentLength));
      remaining -= currentLength;
    }

    return lines.join('\n');
  }, []);

  const handleAddRandomRecords = useCallback(async () => {
    try {
      const now = Date.now();
      const randomItems = await Promise.all(
        Array.from({ length: 10 }, async (_unused, index) => {
          const seed = `debug-random-${now}-${index}-${Math.random().toString(36).slice(2, 10)}`;
          const profileHash = await calculateTextHash(seed);

          return createDefaultClipboardItem({
            type: 'Text' as const,
            text: generateRandomDebugText(),
            profileHash,
            hasData: false,
            timestamp: now - index * 1000,
          });
        })
      );

      await addItems(randomItems);

      showMessage('已添加10条随机记录', 'success');
    } catch (error) {
      console.error('[HistoryScreen] Failed to add random records:', error);
      showMessage('添加随机记录失败', 'error');
    }
  }, [addItems, showMessage, generateRandomDebugText]);

  // 加载更多（防止重复加载和越界）
  const handleEndReached = useCallback(() => {
    if (isLoading) return;
    if (items.length >= totalCount) return;
    loadItems(currentPage + 1);
  }, [isLoading, items.length, totalCount, currentPage, loadItems]);

  // 切换筛选类型
  const handleFilterChange = useCallback(
    (type: FilterType) => {
      setFilterType(type);

      // 根据筛选类型设置 filter 参数
      let filter: HistoryFilter | undefined;
      switch (type) {
        case 'Text':
        case 'Image':
        case 'File':
          filter = { type: [type] };
          break;
        case 'starred':
          filter = { starredOnly: true };
          break;
        case 'transferring':
          filter = { syncStatus: [2] };
          break;
        default:
          filter = undefined;
      }

      // 使用 store 的 searchItems 进行异步过滤
      searchItems(filter);
    },
    [searchItems]
  );

  const handleClearSearch = useCallback(() => {
    setSearchText('');
  }, []);

  // 切换完整图片显示
  const handleToggleFullImage = useCallback(async () => {
    await setShowFullImage(!showFullImage);
  }, [showFullImage, setShowFullImage]);

  const handleDownload = useCallback(
    async (item: ClipboardItem) => {
      console.log(`[HistoryScreen] ========== Download Button Clicked ==========`);
      console.log(`[HistoryScreen] Item profileHash: ${item.profileHash}`);
      console.log(`[HistoryScreen] Item type: ${item.type}`);
      console.log(`[HistoryScreen] Item dataName: ${item.dataName}`);
      console.log(`[HistoryScreen] Item hasRemoteData: ${item.hasRemoteData}`);
      console.log(`[HistoryScreen] Item isLocalFileReady: ${item.isLocalFileReady}`);

      const initialized = await ensureSyncServiceInitialized();
      if (!initialized) {
        showMessage('历史同步未启用', 'error');
        return;
      }

      const { getHistoryTransferQueue } = await import('@/services/HistoryTransferQueue');
      const { getProfileId } = await import('@/services/HistoryAPI');

      const profileId = getProfileId(item.type, item.profileHash);
      console.log(`[HistoryScreen] Generated profileId: ${profileId}`);

      const queue = getHistoryTransferQueue();
      queue.start();
      await queue.addDownloadTask(profileId, true);
    },
    [ensureSyncServiceInitialized, showMessage]
  );

  const handleUpload = useCallback(
    async (item: ClipboardItem) => {
      console.log(`[HistoryScreen] ========== Upload Button Clicked ==========`);
      console.log(`[HistoryScreen] Item profileHash: ${item.profileHash}`);
      console.log(`[HistoryScreen] Item type: ${item.type}`);
      console.log(`[HistoryScreen] Item isLocalFileReady: ${item.isLocalFileReady}`);
      console.log(`[HistoryScreen] Item syncStatus: ${item.syncStatus}`);

      const initialized = await ensureSyncServiceInitialized();
      if (!initialized) {
        showMessage('历史同步未启用', 'error');
        return;
      }

      // 验证本地文件是否存在
      if (item.fileUri) {
        const { File } = await import('expo-file-system');
        const file = new File(item.fileUri);
        if (!file.exists) {
          console.warn(`[HistoryScreen] Local file not found: ${item.fileUri}`);
          showMessage('本地文件不存在', 'error');
          return;
        }
      }

      const { getHistoryTransferQueue } = await import('@/services/HistoryTransferQueue');
      const { getProfileId } = await import('@/services/HistoryAPI');

      const profileId = getProfileId(item.type, item.profileHash);
      console.log(`[HistoryScreen] Generated profileId: ${profileId}`);

      const queue = getHistoryTransferQueue();
      queue.start();
      await queue.addUploadTask(profileId, true);
    },
    [ensureSyncServiceInitialized, showMessage]
  );

  const renderItem = useCallback(
    ({ item }: { item: ClipboardItem }) => {
      const itemRef = getOrCreateItemRef(item.profileHash);

      return (
        <HistoryListItem
          ref={itemRef}
          item={item}
          onCopy={handleItemPress}
          onShare={handleShare}
          onSave={handleSave}
          onOpen={handleOpen}
          onLongPress={handleItemLongPress}
          onDelete={performDelete}
          onToggleStar={handleToggleStar}
          onDownload={historySyncEnabled ? handleDownload : undefined}
          onUpload={historySyncEnabled ? handleUpload : undefined}
          showFullImage={showFullImage}
          enableHistorySync={historySyncEnabled}
        />
      );
    },
    [
      getOrCreateItemRef,
      handleItemPress,
      handleShare,
      handleOpen,
      handleItemLongPress,
      performDelete,
      handleToggleStar,
      handleDownload,
      handleUpload,
      showFullImage,
      historySyncEnabled,
    ]
  );

  // 渲染空状态
  const renderEmptyComponent = useCallback(() => {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无历史记录</Text>
        <Text style={[styles.emptyDescription, { color: theme.colors.textSecondary }]}>
          {searchText ? '未找到匹配的记录' : '复制内容后将自动保存到历史记录'}
        </Text>
      </View>
    );
  }, [theme, searchText]);

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(() => {
    const items: MenuItemConfig[] = [
      {
        label: '添加图片',
        onPress: handleImportImage,
      },
      {
        label: '添加文件',
        onPress: handleImportFile,
      },
      {
        label: '展示完整图片',
        onPress: handleToggleFullImage,
        icon: showFullImage ? <Check color="#2196F3" width={18} height={18} /> : undefined,
      },
      {
        label: '排序方式',
        submenu: [
          {
            label: '按创建时间排序',
            onPress: () => handleSortChange('timestamp'),
            icon:
              sortField === 'timestamp' ? (
                <Check color="#2196F3" width={18} height={18} />
              ) : undefined,
          },
          {
            label: '按访问时间排序',
            onPress: () => handleSortChange('lastAccessed'),
            icon:
              sortField === 'lastAccessed' ? (
                <Check color="#2196F3" width={18} height={18} />
              ) : undefined,
          },
        ],
      },
    ];

    if (historySyncEnabled) {
      items.push({
        label: isSyncing ? '同步中...' : '重新同步历史记录',
        onPress: handleResyncHistory,
        disabled: isSyncing,
      });
    }

    if (isDebugMode) {
      items.push({
        label: '添加10条随机记录',
        onPress: handleAddRandomRecords,
      });
    }

    items.push({
      label: '清空所有历史记录',
      onPress: handleClearAll,
      destructive: true,
    });

    return items;
  }, [
    showFullImage,
    sortField,
    isDebugMode,
    isSyncing,
    historySyncEnabled,
    handleImportImage,
    handleImportFile,
    handleToggleFullImage,
    handleSortChange,
    handleResyncHistory,
    handleAddRandomRecords,
    handleClearAll,
  ]);

  // 设置标题栏菜单按钮
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerStyle: {
        backgroundColor: theme.colors.surface,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: 0,
      },
      headerRight: () => (
        <View style={styles.headerRightContainer}>
          {hasTasks && (
            <TouchableOpacity
              style={styles.queueButton}
              onPress={() => setShowTransferQueue(true)}
              hitSlop={{ top: 10, right: 5, bottom: 10, left: 5 }}
            >
              <List width={20} height={20} color={theme.colors.primary} />
              <View style={[styles.queueBadge, { backgroundColor: theme.colors.primary }]}>
                <Text style={[styles.queueBadgeText, { color: theme.colors.white }]}>
                  {activeCount + pendingCount}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          {isSyncing && (
            <Animated.View
              style={[styles.syncIndicator, { transform: [{ rotate: syncRotationInterpolate }] }]}
            >
              <RefreshCw width={18} height={18} color={theme.colors.primary} />
            </Animated.View>
          )}
          {showScrollToTop && (
            <TouchableOpacity
              style={[styles.scrollToTopButton, { backgroundColor: theme.colors.surface }]}
              onPress={handleScrollToTop}
              hitSlop={{ top: 10, right: 5, bottom: 10, left: 5 }}
            >
              <ArrowUp width={20} height={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}
          <TopRightMenu items={menuItems} />
        </View>
      ),
    });
  }, [
    navigation,
    theme.colors.surface,
    theme.colors.primary,
    theme.colors.textSecondary,
    menuItems,
    showScrollToTop,
    handleScrollToTop,
    isSyncing,
    syncRotationInterpolate,
    hasTasks,
    activeCount,
    pendingCount,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* 整理中提示 */}
      {isReorganizing && (
        <View style={[styles.reorganizingOverlay, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.reorganizingText, { color: theme.colors.text }]}>
            正在整理历史记录...
          </Text>
        </View>
      )}
      {/* 搜索栏 */}
      <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface }]}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            },
          ]}
          placeholder="搜索历史记录..."
          placeholderTextColor={theme.colors.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          style={styles.clearSearchButton}
          onPress={handleClearSearch}
          disabled={!searchText}
        >
          <Text
            style={[
              styles.clearSearchButtonText,
              {
                color: searchText ? theme.colors.primary : theme.colors.textTertiary,
              },
            ]}
          >
            清除
          </Text>
        </TouchableOpacity>
      </View>

      {/* 筛选按钮 */}
      <View style={[styles.filterContainer, { backgroundColor: theme.colors.surface }]}>
        {(['all', 'Text', 'Image', 'File', 'starred'] as FilterType[]).map((type) => (
          <TouchableOpacity
            key={type}
            onPress={() => handleFilterChange(type)}
            style={[
              styles.filterButton,
              filterType === type
                ? { backgroundColor: theme.colors.primary }
                : styles.filterButtonInactive,
            ]}
          >
            <Text
              style={[
                styles.filterButtonText,
                { color: filterType === type ? theme.colors.white : theme.colors.textSecondary },
              ]}
            >
              {FILTER_LABELS[type]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 历史记录列表 */}
      <FlashList
        ref={listRef}
        data={sortedItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.profileHash}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onScroll={handleScroll}
        ListEmptyComponent={renderEmptyComponent}
        contentContainerStyle={styles.listContent}
        refreshing={isRefreshing}
        onRefresh={historySyncEnabled ? () => handleIncrementalSync(true) : undefined}
      />

      {/* Android 操作菜单 Modal */}
      {Platform.OS === 'android' && (
        <Modal
          visible={showActionSheet}
          transparent
          animationType="none"
          onRequestClose={() => closeActionSheet()}
        >
          <Pressable
            style={[styles.modalOverlay, { backgroundColor: theme.colors.backdrop }]}
            onPress={() => closeActionSheet()}
          >
            <Animated.View
              style={[
                styles.actionSheet,
                {
                  backgroundColor: theme.colors.surface,
                  transform: [{ translateY: actionSheetTranslateY }],
                },
              ]}
            >
              {/* 打开按钮 - Image/File/Group 且有本地文件时显示 */}
              {selectedItem &&
                (selectedItem.type === 'Image' ||
                  selectedItem.type === 'File' ||
                  selectedItem.type === 'Group') &&
                selectedItem.fileUri && (
                  <>
                    <TouchableOpacity
                      style={styles.actionSheetButton}
                      onPress={() => {
                        closeActionSheet(() => selectedItem && handleOpen(selectedItem));
                      }}
                    >
                      <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                        打开
                      </Text>
                    </TouchableOpacity>
                    <View
                      style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                    />
                  </>
                )}

              {/* 储存按钮 - Image/File/Group 且有本地文件时显示 */}
              {selectedItem &&
                (selectedItem.type === 'Image' ||
                  selectedItem.type === 'File' ||
                  selectedItem.type === 'Group') &&
                selectedItem.fileUri && (
                  <>
                    <TouchableOpacity
                      style={styles.actionSheetButton}
                      onPress={() => {
                        closeActionSheet(() => selectedItem && handleSave(selectedItem));
                      }}
                    >
                      <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                        {selectedItem.type === 'Image' ? '保存到相册' : '储存到设备'}
                      </Text>
                    </TouchableOpacity>
                    <View
                      style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                    />
                  </>
                )}

              {/* 分享按钮 - Image/File/Group 类型显示 */}
              {selectedItem &&
                (selectedItem.type === 'Image' ||
                  selectedItem.type === 'File' ||
                  selectedItem.type === 'Group') && (
                  <>
                    <TouchableOpacity
                      style={styles.actionSheetButton}
                      onPress={() => selectedItem && handleShare(selectedItem)}
                    >
                      <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                        分享
                      </Text>
                    </TouchableOpacity>
                    <View
                      style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                    />
                  </>
                )}

              {/* 复制按钮 - 仅 Text 类型显示 */}
              {selectedItem && selectedItem.type === 'Text' && (
                <>
                  <TouchableOpacity
                    style={styles.actionSheetButton}
                    onPress={() => selectedItem && handleCopyItem(selectedItem)}
                  >
                    <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                      复制
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                  />
                </>
              )}

              {/* 删除按钮 - 所有类型显示 */}
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => selectedItem && handleDeleteFromMenu(selectedItem)}
              >
                <Text
                  style={[styles.actionSheetButtonText, { color: theme.colors.error || '#F44336' }]}
                >
                  删除
                </Text>
              </TouchableOpacity>
              <View style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]} />

              {/* 取消按钮 */}
              <TouchableOpacity style={styles.actionSheetButton} onPress={() => closeActionSheet()}>
                <Text style={[styles.actionSheetButtonText, { color: theme.colors.textSecondary }]}>
                  取消
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </Pressable>
        </Modal>
      )}

      {/* 传输队列弹窗 */}
      <TransferQueueModal visible={showTransferQueue} onClose={() => setShowTransferQueue(false)} />

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={clearMessage} />

      {/* 导入文件遮罩 */}
      {importingFile && (
        <View style={[styles.importOverlay, { backgroundColor: theme.colors.backdrop }]}>
          <View style={[styles.importOverlayCard, { backgroundColor: theme.colors.surface }]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.importOverlayTitle, { color: theme.colors.text }]}>
              正在添加文件...
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  reorganizingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  reorganizingText: {
    marginTop: 16,
    fontSize: 16,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncIndicator: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  queueBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  queueBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  scrollToTopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingTop: 0,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  clearSearchButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearSearchButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterButtonActive: {
    // backgroundColor will be set by theme dynamically
  },
  filterButtonInactive: {
    // backgroundColor: transparent by default
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    // color will be set by theme dynamically
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 15,
    textAlign: 'center',
  },
  // Modal 样式
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  actionSheetButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  actionSheetButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  actionSheetDivider: {
    height: StyleSheet.hairlineWidth,
  },
  importOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importOverlayCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    minWidth: 160,
  },
  importOverlayTitle: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
});
