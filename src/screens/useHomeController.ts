import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Share, Linking, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import * as Haptics from 'expo-haptics';
import type { CardAnchorRect } from '@/components/CardContextOverlay.types';
import { AnimatedCardGridHandle } from '@/components/AnimatedCardGrid';
import { useHistoryStore } from '@/stores/historyStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSettingsStore } from '@/stores';
import { log } from '@/services/Logger';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { notifyDeviceClipboardChanged } from '@/services/P2pClipboardObserver';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';
import { deriveP2pConnectionStatus } from '@/utils/connectionStatus';
import { historyStorage } from '@/services';
import { getUnifiedContentService } from '@/services/UnifiedContentService';
import { getUnifiedEngineService } from '@/services/UnifiedEngineService';
import { getUnifiedSpaceService } from '@/services/UnifiedSpaceService';
import {
  p2pDeliveryCountsFromReport,
  p2pDeliveryCountsFromResend,
  p2pDeliveryStateFromResend,
  p2pDeliveryTranslationOptions,
  p2pDeliveryUpdates,
  persistP2pDeliveryReport,
} from '@/services/P2pDeliveryState';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { importFileToHistory } from '@/utils/uploadFile';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { DisplayKind, getDisplayKind } from '@/utils/displayKind';
import { buildActionMenuGroups, ActionMenuItem } from '@/utils/actionMenuItems';
import { saveToGallery, saveFile, shareFile } from '@/utils/fileActions';
import { HistoryDateFilter } from '@/utils/historyFilters';
import { useHomeHistoryFilter } from './useHomeHistoryFilter';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

function getErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'UNKNOWN';
  return typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

/**
 * 首页的全部业务逻辑(stores 订阅、handlers、effects),从旧的单文件 HomeView 原样抽出。
 * `HomeView.ios.tsx` / `HomeView.android.tsx` 只负责布局(Compact 单栏 / Expanded 双栏),
 * 逻辑完全共享,避免 900 行在两个平台文件里各存一份。
 *
 * 与旧实现的唯一行为差异是「详情面板」:Expanded 双栏需要一个常驻的选中项(`detailItem`),
 * Compact 不使用它,因此手机行为零回归。动作构造器 `makeActionGroups` 由 contextItem(长按浮层)
 * 与 detailItem(右栏)共用。
 */
export function useHomeController(onOpenSettings: () => void) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Stores —— 全部用细粒度 selector 订阅。整体订阅会让 store 任意字段(isLoading /
  // totalCount / message / error 等)变化都重渲染整个 HomeView + 卡片网格。
  // action 引用稳定，订阅它们不会触发重渲染。
  const items = useHistoryStore((s) => s.items);
  const selectedIds = useHistoryStore((s) => s.selectedIds);
  const lastAddedTimestamp = useHistoryStore((s) => s.lastAddedTimestamp);
  const isInitialHistoryLoadComplete = useHistoryStore((s) => s.isInitialLoadComplete);
  const loadItems = useHistoryStore((s) => s.loadItems);
  const loadMoreItems = useHistoryStore((s) => s.loadMoreItems);
  const searchItems = useHistoryStore((s) => s.searchItems);
  const handleStorageChange = useHistoryStore((s) => s.handleStorageChange);
  const toggleSelection = useHistoryStore((s) => s.toggleSelection);
  const selectAll = useHistoryStore((s) => s.selectAll);
  const clearSelection = useHistoryStore((s) => s.clearSelection);
  const deleteSelected = useHistoryStore((s) => s.deleteSelected);
  const deleteItem = useHistoryStore((s) => s.deleteItem);

  // message 不在此订阅，交给自隔离的 <ConnectedMessageToast/>，toast 出现/消失只重渲它自身
  const showMessage = useMessageStore((s) => s.showMessage);
  const clearError = useErrorStore((s) => s.clearError);

  const p2pSpaceId = useUnifiedSpaceStore((s) => s.spaceId);

  const p2pStatus = useUnifiedEngineStore((s) => s.status);
  const p2pPeerStatus = useUnifiedEngineStore((s) => s.peerConnectionStatus);
  const p2pRefreshRevision = useUnifiedEngineStore((s) => s.refreshRevision);
  const connectionStatus = useMemo(
    () => deriveP2pConnectionStatus(p2pStatus, p2pPeerStatus, p2pSpaceId !== null),
    [p2pPeerStatus, p2pSpaceId, p2pStatus]
  );

  // UI state
  const [refreshing, setRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedFilterKinds, setSelectedFilterKinds] = useState<DisplayKind[]>([]);
  const [selectedDateFilter, setSelectedDateFilter] = useState<HistoryDateFilter>('all');
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [wordPickerTarget, setWordPickerTarget] = useState<{
    text: string;
    anchor: CardAnchorRect | null;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showMySpace, setShowMySpace] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Expanded 双栏专用:右栏当前展示的条目。Compact 不使用。
  const [detailItem, setDetailItem] = useState<ClipboardItem | null>(null);
  // 右栏是否「锚定首项」:选中项就是当前首项时为 true —— 之后列表首项变化(新内容置顶/复制置顶)
  // 详情会自动跟到新的第一张;若用户选的是非首项则为 false,新变化不打扰。用 ref 不触发重渲。
  const followFirstRef = useRef(true);

  const activeSpaceLabel = t('settingsSync:space.title');

  // 空状态文案：按连接语义给出「纯提示」，不带任何操作按钮
  //（配对/重试/去设置等动作分别由顶栏空间入口、P2P 引擎自动重试、设置入口承担）
  const emptyContent = useMemo(() => {
    switch (connectionStatus) {
      case 'unconfigured':
        return {
          icon: 'link-outline' as const,
          title: t('empty.unconfigured.title'),
          description: t('empty.unconfigured.description'),
          tint: theme.colors.textSecondary,
        };
      case 'connecting':
        return {
          icon: 'sync-outline' as const,
          title: t('empty.connecting.title'),
          description: t('empty.connecting.description', { space: activeSpaceLabel }),
          tint: theme.colors.textSecondary,
        };
      case 'offline':
        return {
          icon: 'cloud-offline-outline' as const,
          title: t('empty.offline.title', { space: activeSpaceLabel }),
          description: t('empty.offline.description'),
          tint: theme.colors.textSecondary,
        };
      case 'error':
        return {
          icon: 'alert-circle-outline' as const,
          title: t('empty.error.title'),
          description: t('empty.error.description'),
          tint: theme.colors.error,
        };
      case 'online':
      default:
        return {
          icon: 'clipboard-outline' as const,
          title: t('empty.online.title'),
          description: t('empty.online.description'),
          tint: theme.colors.textSecondary,
        };
    }
  }, [connectionStatus, activeSpaceLabel, t, theme.colors.textSecondary, theme.colors.error]);

  const listRef = useRef<AnimatedCardGridHandle>(null);

  useEffect(() => {
    if (p2pRefreshRevision > 0) {
      loadItems();
    }
  }, [loadItems, p2pRefreshRevision]);

  // Listen for storage changes
  useEffect(() => {
    const { HistoryStorage } = require('@/services/HistoryStorage');
    const storage = HistoryStorage.getInstance();
    const handleChange = (changedItems: ClipboardItem[], action: 'add' | 'update' | 'delete') => {
      handleStorageChange(changedItems, action);
    };
    storage.addChangeCallback(handleChange);
    return () => storage.removeChangeCallback(handleChange);
  }, [handleStorageChange]);

  // Scroll to top on new items
  useEffect(() => {
    if (lastAddedTimestamp > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
    }
  }, [lastAddedTimestamp]);

  useHomeHistoryFilter({
    isSearching,
    searchText,
    selectedFilterKinds,
    selectedDateFilter,
    searchItems,
  });

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  // Back handler for select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelectMode();
      return true;
    });
    return () => handler.remove();
  }, [isSelectMode, exitSelectMode]);

  // 用户主动选中右栏详情(Expanded 网格 tap):记录是否锚定首项,再切换详情。
  const selectDetailItem = useCallback(
    (item: ClipboardItem) => {
      followFirstRef.current = item.profileHash === items[0]?.profileHash;
      setDetailItem(item);
    },
    [items]
  );

  // 右栏详情的默认/有效性维护(Expanded 常驻右栏用;Compact 不读 detailItem,无副作用):
  // - 锚定首项(初始默认 / 用户选的就是首项)时,始终跟随列表首项 → 新内容置顶后详情自动定位到第一张;
  // - 未锚定(用户选了非首项)时,新变化不打扰,仅在该项失效(删除/过滤)时回落首项并重新锚定;
  // - 列表清空时置 null,右栏显示占位。
  useEffect(() => {
    const first = items[0] ?? null;
    if (followFirstRef.current) {
      if (detailItem?.profileHash !== first?.profileHash) {
        setDetailItem(first);
      }
      return;
    }
    const stillExists =
      detailItem != null && items.some((i) => i.profileHash === detailItem.profileHash);
    if (!stillExists) {
      followFirstRef.current = true;
      setDetailItem(first);
    }
  }, [items, detailItem]);

  // store 已按配置(含 pinned 置顶 + 二分插入保序)排好序，直接使用：
  // 避免每次 items 变化重排 O(n log n)，也不会覆盖置顶/非 timestamp 的排序方式
  const latestId = items[0]?.profileHash;

  // Actions
  const copyItemWithSync = useCallback(async (item: ClipboardItem) => {
    const content: ClipboardContent = {
      type: item.type,
      text: item.text,
      profileHash: item.profileHash,
      fileUri: item.fileUri,
      fileName: item.dataName,
      fileSize: item.size,
      timestamp: item.timestamp,
      localClipboardHash: item.localClipboardHash,
      hasData: item.hasData,
    };
    const result = await copyToLocalClipboard(content);
    if (result.success) {
      useClipboardStore.getState().setCurrentContentDisplay(content);
      // 用户主动使用某项 = 一次明确的激活:直接发 activate 事件驱动同步(写 activate 寄存器、
      // 带回该项 content_id、forceTick),不再依赖 ClipboardMonitor 的被动读/抑制机制。
      void notifyDeviceClipboardChanged(content);
      // 等待重新定位落盘，让飞入动画能尽快拿到确认后的排序结果，减少起飞前的等待
      await historyStorage.updateLastAccessed(item.profileHash);
    }
    return result;
  }, []);

  const getCopySuccessMessage = useCallback(
    () =>
      t(
        useSettingsStore.getState().config?.autoPushLocal ?? true
          ? 'toast.copiedAutoPushEnabled'
          : 'toast.copiedLocal'
      ),
    [t]
  );

  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      if (isSelectMode) {
        toggleSelection(item.profileHash);
        return;
      }

      // 排序重排后卡片的移动动画由 AnimatedCardGrid/GridCell 按下标变化自动处理，
      // 这里只需要触发复制本身
      const result = await copyItemWithSync(item);
      if (result.success) {
        showMessage(getCopySuccessMessage(), 'success');
      } else {
        showMessage(result.message || t('toast.copyFailed'), 'error');
      }
    },
    [isSelectMode, toggleSelection, copyItemWithSync, showMessage, getCopySuccessMessage, t]
  );

  // ── Long-press → 锚定式上下文浮层 ────────────────────────────
  const [contextTarget, setContextTarget] = useState<{
    item: ClipboardItem;
    anchor: CardAnchorRect | null;
  } | null>(null);
  const contextItem = contextTarget?.item ?? null;

  const handleItemLongPress = useCallback(
    (item: ClipboardItem, anchor: CardAnchorRect | null) => {
      // 多选模式下长按与单击同义：切换选中，不弹菜单
      if (isSelectMode) {
        toggleSelection(item.profileHash);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
      setContextTarget({ item, anchor });
    },
    [isSelectMode, toggleSelection]
  );

  const handleContextDismiss = useCallback(() => {
    setContextTarget(null);
  }, []);

  const contextDisplayKind = useMemo(
    () => (contextItem ? getDisplayKind(contextItem.type, contextItem.text) : null),
    [contextItem]
  );

  // 动作分组构造器:长按浮层(contextItem)与右栏详情(detailItem)共用同一份动作与判定。
  // 每个 handler 显式接收 item,不再闭包某个特定项——这样两个入口都能复用。
  const makeActionGroups = useCallback(
    (
      item: ClipboardItem,
      displayKind: DisplayKind,
      anchor: CardAnchorRect | null
    ): ActionMenuItem[][] =>
      buildActionMenuGroups(item, displayKind, {
        onCopy: async () => {
          const result = await copyItemWithSync(item);
          showMessage(
            result.success ? getCopySuccessMessage() : result.message || t('toast.copyFailed'),
            result.success ? 'success' : 'error'
          );
        },
        onSelectText: () => {
          // 动作经 close(after) 在浮层退场后才执行，那时 contextTarget 已清空——
          // 这里提前把锚点捕获进闭包，分词浮层才能从同一张卡片原位生长
          setWordPickerTarget({ text: item.text, anchor });
        },
        onCopyPlainText: async () => {
          const Clipboard = await import('expo-clipboard');
          await Clipboard.setStringAsync(item.text);
          showMessage(t('toast.copiedPlainText'), 'success');
        },
        onOpenInBrowser: () => {
          Linking.openURL(item.text.trim());
        },
        onSaveImage: async () => {
          try {
            await saveToGallery(item.fileUri!, item.dataName);
            showMessage(t('toast.savedToGallery'), 'success');
          } catch (error) {
            log.error(`[HomeView] saveToGallery failed (${getErrorCode(error)})`);
            showMessage(t('toast.saveFailed'), 'error');
          }
        },
        onSaveFile: async () => {
          try {
            const saved = await saveFile(item.fileUri!, item.dataName);
            if (saved) {
              showMessage(t('toast.savedFile'), 'success');
            }
          } catch (e) {
            log.error('[HomeView] saveFile failed:', e);
            showMessage(t('toast.saveFailed'), 'error');
          }
        },
        onResend: async () => {
          if (!item.p2pEntryId) return;
          try {
            const outcome = await getUnifiedSpaceService().resendEntry(item.p2pEntryId);
            const deliveryState = p2pDeliveryStateFromResend(outcome);
            const deliveryCounts =
              outcome.kind === 'completed' ? p2pDeliveryCountsFromResend(outcome) : undefined;
            await historyStorage.updateItem(
              item.profileHash,
              p2pDeliveryUpdates(item.p2pEntryId, deliveryState, deliveryCounts)
            );
            showMessage(
              t(
                `toast.p2pDelivery.${deliveryState}`,
                p2pDeliveryTranslationOptions(deliveryCounts)
              ),
              deliveryState === 'delivered'
                ? 'success'
                : deliveryState === 'partial' || deliveryState === 'pending'
                ? 'info'
                : 'error'
            );
          } catch (error) {
            log.error('[HomeView] Failed to resend P2P content:', error);
            showMessage(t('toast.p2pDelivery.failed'), 'error');
          }
        },
        onShare: async () => {
          if (
            (displayKind === 'image' || displayKind === 'file' || displayKind === 'group') &&
            item.fileUri &&
            item.isLocalFileReady
          ) {
            await shareFile(item.fileUri, item.dataName);
          } else {
            await Share.share({ message: item.text });
          }
        },
        onSelect: () => {
          setIsSelectMode(true);
          clearSelection();
          toggleSelection(item.profileHash);
        },
        onDelete: async () => {
          await deleteItem(item.profileHash);
          showMessage(t('toast.deleted'), 'success');
        },
      }),
    [
      copyItemWithSync,
      showMessage,
      clearSelection,
      toggleSelection,
      deleteItem,
      getCopySuccessMessage,
      t,
    ]
  );

  const actionMenuGroups = useMemo(() => {
    if (!contextItem || !contextDisplayKind) return [];
    return makeActionGroups(contextItem, contextDisplayKind, contextTarget?.anchor ?? null);
  }, [contextItem, contextDisplayKind, contextTarget, makeActionGroups]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === items.length) {
      clearSelection();
    } else {
      selectAll();
    }
  }, [selectedIds.size, items.length, clearSelection, selectAll]);

  const handleBatchDelete = useCallback(async () => {
    await deleteSelected();
    setIsSelectMode(false);
  }, [deleteSelected]);

  const handleBatchCopy = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.has(i.profileHash));
    const texts = selected.map((i) => i.text).join('\n');
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(texts);
    showMessage(t('toast.copiedSelected'), 'success');
    exitSelectMode();
  }, [items, selectedIds, showMessage, exitSelectMode, t]);

  const handleBatchShare = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.has(i.profileHash));
    const texts = selected.map((i) => i.text).join('\n');
    await Share.share({ message: texts });
    exitSelectMode();
  }, [items, selectedIds, exitSelectMode]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await getUnifiedEngineService().refreshPeerConnections();
      await loadItems();
    } finally {
      setRefreshing(false);
    }
  }, [loadItems]);

  // Sync button — refresh current server value + reload local history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await getUnifiedEngineService().refreshPeerConnections();
      await loadItems();
      showMessage(t('toast.syncDone'), 'success');
    } catch {
      showMessage(t('toast.syncFailed'), 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, showMessage, loadItems, t]);

  // Upload
  const handleUpload = useCallback(async () => {
    try {
      clearError();
      const result = await getUnifiedContentService().sendCurrentClipboard();
      await persistP2pDeliveryReport(result.profileHash, result.report);
      await loadItems();
      showMessage(
        t(
          `toast.p2pDelivery.${result.deliveryState}`,
          p2pDeliveryTranslationOptions(p2pDeliveryCountsFromReport(result.report))
        ),
        result.deliveryState === 'delivered'
          ? 'success'
          : result.deliveryState === 'partial' || result.deliveryState === 'pending'
          ? 'info'
          : 'error'
      );
    } catch {
      showMessage(t('toast.uploadFailed'), 'error');
    }
  }, [showMessage, clearError, loadItems, t]);

  // 先落本地并立即显示，再按用户明确选择的通道发送。
  const saveAndPush = useCallback(
    async (payload: {
      uri: string;
      fileName: string;
      mimeType?: string | null;
      fileSize?: number;
    }) => {
      let result;
      try {
        result = await importFileToHistory(
          payload.uri,
          payload.fileName,
          payload.mimeType,
          payload.fileSize
        );
      } catch (error) {
        log.error('[HomeView] Failed to save imported content:', error);
        showMessage(t('toast.saveFailed'), 'error');
        return;
      }

      try {
        const sendResult = await getUnifiedContentService().sendImportedAsset(
          {
            kind: result.contentType === 'Image' ? 'image' : 'file',
            uri: result.fileUri,
            fileName: result.fileName,
            mimeType: payload.mimeType,
          },
          result.profileHash
        );
        await persistP2pDeliveryReport(sendResult.profileHash, sendResult.report);
        await loadItems();
        showMessage(
          t(
            `toast.p2pDelivery.${sendResult.deliveryState}`,
            p2pDeliveryTranslationOptions(p2pDeliveryCountsFromReport(sendResult.report))
          ),
          sendResult.deliveryState === 'delivered'
            ? 'success'
            : sendResult.deliveryState === 'partial' || sendResult.deliveryState === 'pending'
            ? 'info'
            : 'error'
        );
      } catch (error) {
        log.error('[HomeView] Failed to send imported content:', error);
        showMessage(t('toast.uploadFailed'), 'error');
      }
    },
    [loadItems, showMessage, t]
  );

  // Upload file
  const handleUploadFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await saveAndPush({
        uri: asset.uri,
        fileName: asset.name || 'file',
        mimeType: asset.mimeType,
        fileSize: asset.size,
      });
    } catch {
      showMessage(t('toast.pickFileFailed'), 'error');
    }
  }, [saveAndPush, showMessage, t]);

  // Upload image
  const handleUploadImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await saveAndPush({
        uri: asset.uri,
        fileName: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch {
      showMessage(t('toast.pickImageFailed'), 'error');
    }
  }, [saveAndPush, showMessage, t]);

  // 拍照上传 —— 相机权限已在 app.json 声明(Android CAMERA / iOS expo-camera）
  const handleTakePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showMessage(t('toast.cameraPermissionNeeded'), 'error');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await saveAndPush({
        uri: asset.uri,
        fileName: asset.fileName || `photo_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch {
      showMessage(t('toast.takePhotoFailed'), 'error');
    }
  }, [saveAndPush, showMessage, t]);

  // Search
  const openSearch = useCallback(() => setIsSearching(true), []);
  const hasActiveFilters = selectedFilterKinds.length > 0 || selectedDateFilter !== 'all';
  // 类型筛选是全局单选(chip 行、搜索筛选弹层、平板 FilterRail 共用):点新类型替换,
  // 点已选类型取消(回到「全部」)。弹层里的 checkmark 行按 radio 语义理解,与同弹层的
  // 时间区一致。状态保持数组是为了兼容 HistoryFilter.displayKinds 的存储/查询管线。
  const handleToggleFilterKind = useCallback((kind: DisplayKind) => {
    setSelectedFilterKinds((current) => (current.includes(kind) ? [] : [kind]));
  }, []);
  const handleClearFilters = useCallback(() => {
    setSelectedFilterKinds([]);
    setSelectedDateFilter('all');
  }, []);
  const handleClearFilterKinds = useCallback(() => {
    setSelectedFilterKinds([]);
  }, []);
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearchText('');
    setSelectedFilterKinds([]);
    setSelectedDateFilter('all');
    setShowFilterSheet(false);
    searchItems(undefined);
  }, [searchItems]);

  const keyExtractor = useCallback((item: ClipboardItem) => item.profileHash, []);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return {
    // env
    t,
    theme,
    insets,
    onOpenSettings,
    // data
    items,
    isInitialHistoryLoadComplete,
    latestId,
    emptyContent,
    // selection / mode
    selectedIds,
    allSelected,
    isSelectMode,
    setIsSelectMode,
    clearSelection,
    toggleSelection,
    exitSelectMode,
    handleSelectAll,
    // search
    isSearching,
    openSearch,
    closeSearch,
    searchText,
    setSearchText,
    selectedFilterKinds,
    selectedDateFilter,
    setSelectedDateFilter,
    hasActiveFilters,
    handleToggleFilterKind,
    handleClearFilters,
    handleClearFilterKinds,
    showFilterSheet,
    setShowFilterSheet,
    // space connection
    activeSpaceLabel,
    connectionStatus,
    p2pSpaceId,
    showMySpace,
    setShowMySpace,
    // grid
    listRef,
    keyExtractor,
    handleItemPress,
    handleItemLongPress,
    refreshing,
    handleRefresh,
    loadMoreItems,
    // batch actions
    handleBatchCopy,
    handleBatchShare,
    handleBatchDelete,
    // FAB / upload
    showAddMenu,
    setShowAddMenu,
    handleTakePhoto,
    handleUploadImage,
    handleUploadFile,
    handleUpload,
    handleSyncHistory,
    // word picker
    wordPickerTarget,
    setWordPickerTarget,
    // context overlay (long-press)
    contextItem,
    contextTarget,
    contextDisplayKind,
    actionMenuGroups,
    handleContextDismiss,
    // detail pane (expanded)
    detailItem,
    selectDetailItem,
    makeActionGroups,
    copyItemWithSync,
  };
}

export type HomeController = ReturnType<typeof useHomeController>;
