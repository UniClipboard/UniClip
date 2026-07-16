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
import { usePendingConnectStore } from '@/stores/pendingConnectStore';
import { BackgroundUploadManager } from '@/services/BackgroundUploadManager';
import { log } from '@/services/Logger';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { useSyncEngineStore, notifyDeviceClipboardChanged } from '@/stores/syncEngineStore';
import { deriveConnectionStatus } from '@/utils/connectionStatus';
import { historyStorage } from '@/services';
import { getClipboardSyncService } from '@/services/ClipboardSyncService';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import type { AddServerSaveData } from '@/components/AddServerSheet.types';
import { importFileToHistory } from '@/utils/uploadFile';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { DisplayKind, getDisplayKind } from '@/utils/displayKind';
import { buildActionMenuGroups, ActionMenuItem } from '@/utils/actionMenuItems';
import { saveToGallery, saveFile, shareFile } from '@/utils/fileActions';
import { createHistorySearchFilter, HistoryDateFilter } from '@/utils/historyFilters';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

function getErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'UNKNOWN';
  return typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

// 下拉刷新 / 同步按钮统一走 SyncEngine 的显式 pull（enginePull(Explicit)）——引擎内部
// get_latest + 冲突解析 + watermark，Applied 分支经 applyToDevice 写回剪贴板/历史，
// 不再在 UI 层直调 FFI（旧 fetchAndApplyServerClipboard 已删）。
async function refreshFromServer(): Promise<void> {
  await useSyncEngineStore.getState().forceSync();
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
  const loadItems = useHistoryStore((s) => s.loadItems);
  const searchItems = useHistoryStore((s) => s.searchItems);
  const setSort = useHistoryStore((s) => s.setSort);
  const handleStorageChange = useHistoryStore((s) => s.handleStorageChange);
  const toggleSelection = useHistoryStore((s) => s.toggleSelection);
  const selectAll = useHistoryStore((s) => s.selectAll);
  const clearSelection = useHistoryStore((s) => s.clearSelection);
  const deleteSelected = useHistoryStore((s) => s.deleteSelected);
  const deleteItem = useHistoryStore((s) => s.deleteItem);

  const config = useSettingsStore((s) => s.config);
  const getActiveServer = useSettingsStore((s) => s.getActiveServer);
  const getServers = useSettingsStore((s) => s.getServers);
  const setActiveServer = useSettingsStore((s) => s.setActiveServer);
  const addServer = useSettingsStore((s) => s.addServer);
  const consumePendingConnect = usePendingConnectStore((s) => s.consume);

  // message 不在此订阅，交给自隔离的 <ConnectedMessageToast/>，toast 出现/消失只重渲它自身
  const showMessage = useMessageStore((s) => s.showMessage);
  const clearError = useErrorStore((s) => s.clearError);

  const activeServer = getActiveServer();

  // 服务器在线状态 —— 单一数据源是 SyncEngine 的状态机，细粒度订阅避免整树重渲
  const syncState = useSyncEngineStore((s) => s.status.state);
  const syncLastSyncedAt = useSyncEngineStore((s) => s.status.lastSyncedAt);
  const syncRefreshing = useSyncEngineStore((s) => s.status.isExplicitlyRefreshing);
  const stagedEntry = useSyncEngineStore((s) => s.status.stagedEntry);
  const connectionStatus = useMemo(
    () =>
      deriveConnectionStatus({
        hasServer: !!activeServer,
        state: syncState,
        isExplicitlyRefreshing: syncRefreshing,
        hasSyncedOnce: syncLastSyncedAt != null,
      }),
    [activeServer, syncState, syncRefreshing, syncLastSyncedAt]
  );

  // HasNewUnwritten banner 的预览文案：按 stagedEntry.kind 取摘要，Text 直接秀内容
  const stagedPreviewText = useMemo(() => {
    if (!stagedEntry) return '';
    switch (stagedEntry.kind) {
      case 'Text':
        return stagedEntry.text?.trim() || t('banner.staged.subtitleFile', { ns: 'sync' });
      case 'Image':
        return t('banner.staged.subtitleImage', { ns: 'sync' });
      case 'File':
        return stagedEntry.dataName || t('banner.staged.subtitleFile', { ns: 'sync' });
      case 'Group':
        return t('banner.staged.subtitleGroup', { ns: 'sync' });
      default:
        return '';
    }
  }, [stagedEntry, t]);

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
  const [isApplyingStaged, setIsApplyingStaged] = useState(false);

  const [showServerPicker, setShowServerPicker] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  const [addServerPrefill, setAddServerPrefill] = useState<AddServerSaveData | undefined>(
    undefined
  );
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Expanded 双栏专用:右栏当前展示的条目。Compact 不使用。
  const [detailItem, setDetailItem] = useState<ClipboardItem | null>(null);
  // 右栏是否「锚定首项」:选中项就是当前首项时为 true —— 之后列表首项变化(新内容置顶/复制置顶)
  // 详情会自动跟到新的第一张;若用户选的是非首项则为 false,新变化不打扰。用 ref 不触发重渲。
  const followFirstRef = useRef(true);

  const servers = getServers();
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServerLabel =
    activeServer?.name || activeServer?.url || t('topBar.serverUnconfigured');

  // 空状态文案：按连接语义给出「纯提示」，不带任何操作按钮
  //（配对/重试/去设置等动作分别由顶栏服务器切换、SyncEngine 自动重试、设置入口承担）
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
          description: t('empty.connecting.description', { server: activeServerLabel }),
          tint: theme.colors.textSecondary,
        };
      case 'offline':
        return {
          icon: 'cloud-offline-outline' as const,
          title: t('empty.offline.title', { server: activeServerLabel }),
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
  }, [connectionStatus, activeServerLabel, t, theme.colors.textSecondary, theme.colors.error]);

  const listRef = useRef<AnimatedCardGridHandle>(null);

  // Load history on mount —— 首页固定按活动时间(lastAccessed)排序，
  // 与 HistoryStorage 的 sortConfig 保持一致，复制后才能正确触发重新定位
  useEffect(() => {
    setSort({ field: 'lastAccessed', order: 'desc' });
    loadItems();
  }, [setSort, loadItems]);

  // 引导扫码交接:QrScannerModal 已把凭据写入 pendingConnectStore,首帧挂载即消费并弹出
  // 预填「添加服务器」表单。仅挂载一次([] 依赖)——绝不订阅 intent 变化,否则 HomeView 常驻在
  // Settings 之下时会抢走设置页内嵌扫码器(场景②)的凭据。
  useEffect(() => {
    const intent = consumePendingConnect();
    if (!intent) return;
    setAddServerPrefill({
      name: intent.label ?? '',
      urls: intent.urls && intent.urls.length > 0 ? intent.urls : [intent.url],
      username: intent.user,
      password: intent.pwd,
    });
    setShowAddServer(true);
  }, []);

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

  // Search debounce only runs while the search UI is active. The initial load already
  // owns the first history query and must not race with a filter-less search.
  useEffect(() => {
    if (!isSearching) return;

    const filter = createHistorySearchFilter({
      keyword: searchText,
      displayKinds: selectedFilterKinds,
      dateFilter: selectedDateFilter,
    });
    const hasFilter = Object.keys(filter).length > 0;

    // 想要全量、而列表已经是全量(刚进搜索态,还没输入任何条件)时不必重查。
    // 清空条件后 store 里的 filter 仍非空,这时的 searchItems(undefined) 才是真正需要的恢复查询。
    // 这里用 getState() 快照读而不订阅:filter 由下面的 searchItems 自己写回,订阅它会让
    // effect 被自己的结果重新触发,变成每 300ms 自查一次的死循环。
    if (!hasFilter && !useHistoryStore.getState().filter) return;

    const timer = setTimeout(() => {
      searchItems(hasFilter ? filter : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [isSearching, searchText, selectedFilterKinds, selectedDateFilter, searchItems]);

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
        showMessage(t('toast.copied'), 'success');
      } else {
        showMessage(result.message || t('toast.copyFailed'), 'error');
      }
    },
    [isSelectMode, toggleSelection, copyItemWithSync, showMessage, t]
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
            result.success ? t('toast.copied') : result.message || t('toast.copyFailed'),
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
    [copyItemWithSync, showMessage, clearSelection, toggleSelection, deleteItem, t]
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

  // Refresh — fetch server clipboard, write to system clipboard + history
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
      await loadItems();
    } finally {
      setRefreshing(false);
    }
  }, [loadItems]);

  // HasNewUnwritten banner「应用」：下载 staged 内容写回设备，成功后引擎会转出该状态
  const handleApplyStagedEntry = useCallback(async () => {
    setIsApplyingStaged(true);
    await useSyncEngineStore.getState().applyStagedEntry();
    setIsApplyingStaged(false);
  }, []);

  // LoopDetected banner「知道了」：清 loop 缓冲，恢复同步
  const handleDismissLoop = useCallback(async () => {
    await useSyncEngineStore.getState().acknowledgeLoop();
  }, []);

  // Sync button — refresh current server value + reload local history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await refreshFromServer();
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
      const result = await getClipboardSyncService().triggerUpload();
      if (result.success) {
        showMessage(t('toast.uploadedToServer'), 'success');
      } else {
        showMessage(result.error || t('toast.uploadFailed'), 'error');
      }
    } catch {
      showMessage(t('toast.uploadFailed'), 'error');
    }
  }, [showMessage, clearError, t]);

  // 保存并后台上传:先落本地(瞬时、必成功、立刻可见),再把推送交给后台异步重试。
  // 服务端离线时内容已在本地(卡片显示待上传角标),界面不阻塞、无需干等;取消问题随之消解。
  const saveAndPush = useCallback(
    async (payload: {
      uri: string;
      fileName: string;
      mimeType?: string | null;
      fileSize?: number;
    }) => {
      try {
        const result = await importFileToHistory(
          payload.uri,
          payload.fileName,
          payload.mimeType,
          payload.fileSize
        );
        showMessage(t('toast.savedLocally'), 'success');
        BackgroundUploadManager.enqueue(result.profileHash);
      } catch (error) {
        log.error('[HomeView] saveAndPush failed:', error);
        showMessage(t('toast.saveFailed'), 'error');
      }
    },
    [showMessage, t]
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

  const handleSwitchServer = useCallback(
    async (index: number) => {
      await setActiveServer(index);
      setShowServerPicker(false);
      showMessage(t('toast.serverSwitched'), 'success');
    },
    [setActiveServer, showMessage, t]
  );

  const handleAddServer = useCallback(
    async (data: AddServerSaveData) => {
      await addServer({
        type: 'syncclipboard',
        url: data.urls[0],
        urls: data.urls,
        name: data.name || undefined,
        username: data.username,
        password: data.password,
      });
      setShowAddServer(false);
      setAddServerPrefill(undefined);
      showMessage(t('toast.serverAdded'), 'success');
    },
    [addServer, showMessage, t]
  );

  return {
    // env
    t,
    theme,
    insets,
    onOpenSettings,
    // data
    items,
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
    // server + connection
    activeServerLabel,
    connectionStatus,
    servers,
    activeServerIndex,
    showServerPicker,
    setShowServerPicker,
    handleSwitchServer,
    showAddServer,
    setShowAddServer,
    addServerPrefill,
    setAddServerPrefill,
    handleAddServer,
    // sync banners
    syncState,
    stagedPreviewText,
    isApplyingStaged,
    handleApplyStagedEntry,
    handleDismissLoop,
    // grid
    listRef,
    keyExtractor,
    handleItemPress,
    handleItemLongPress,
    refreshing,
    handleRefresh,
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
