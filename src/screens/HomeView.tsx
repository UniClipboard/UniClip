import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  RefreshControl,
  Share,
  Linking,
  BackHandler,
  useWindowDimensions,
  StatusBar,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { iosColors } from '@/theme/iosDesignTokens';
import * as Haptics from 'expo-haptics';
import { DefaultTopBar, SearchTopBar, SelectModeTopBar } from '@/components/HomeTopBar';
import { SelectModeBottomBar } from '@/components/HomeBottomBar';
import { SyncStatusBanner } from '@/components/SyncStatusBanner';
import { ServerSwitcherModal } from '@/components/ServerSwitcherModal';
import { CardContextOverlay } from '@/components/CardContextOverlay';
import type { CardAnchorRect } from '@/components/CardContextOverlay.types';
import { HistoryFilterSheet } from '@/components/HistoryFilterSheet';
import { AnimatedCardGrid, AnimatedCardGridHandle } from '@/components/AnimatedCardGrid';
import { useHistoryStore } from '@/stores/historyStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSettingsStore } from '@/stores';
import { BackgroundUploadManager } from '@/services/BackgroundUploadManager';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { useSyncEngineStore, notifyDeviceClipboardChanged } from '@/stores/syncEngineStore';
import { deriveConnectionStatus } from '@/utils/connectionStatus';
import { historyStorage } from '@/services';
import { getClipboardSyncService } from '@/services/ClipboardSyncService';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { AddServerSheet } from '@/components/AddServerSheet';
import { AddActionsFab } from '@/components/AddActionsFab';
import { ClipboardCard } from '@/components/ClipboardCard';
import { ConnectedMessageToast } from '@/components/ConnectedMessageToast';
import { WordPickerOverlay } from '@/components/WordPickerOverlay';
import { importFileToHistory } from '@/utils/uploadFile';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { DisplayKind, getDisplayKind } from '@/utils/displayKind';
import { buildActionMenuGroups } from '@/utils/actionMenuItems';
import { saveToGallery, saveFile, shareFile } from '@/utils/fileActions';
import { createHistorySearchFilter, HistoryDateFilter } from '@/utils/historyFilters';
import { isHistorySyncEnabled } from '@/utils/config';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

const GRID_SPACING = 12;
const GRID_PADDING = 16;
const NUM_COLUMNS = 2;

// 下拉刷新 / 同步按钮统一走 SyncEngine 的显式 pull（enginePull(Explicit)）——引擎内部
// get_latest + 冲突解析 + watermark，Applied 分支经 applyToDevice 写回剪贴板/历史，
// 不再在 UI 层直调 FFI（旧 fetchAndApplyServerClipboard 已删）。
async function refreshFromServer(): Promise<void> {
  await useSyncEngineStore.getState().forceSync();
}

interface HomeViewProps {
  onOpenSettings: () => void;
}

export function HomeView({ onOpenSettings }: HomeViewProps) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const cardSize =
    (screenWidth - GRID_PADDING * 2 - GRID_SPACING * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

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

  // message 不在此订阅，交给自隔离的 <ConnectedMessageToast/>，toast 出现/消失只重渲它自身
  const showMessage = useMessageStore((s) => s.showMessage);
  const clearError = useErrorStore((s) => s.clearError);

  const activeServer = getActiveServer();
  const historySyncEnabled = useMemo(() => isHistorySyncEnabled(config), [config]);

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
  const [showAddMenu, setShowAddMenu] = useState(false);

  const servers = getServers();
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServerLabel =
    activeServer?.name || activeServer?.url || t('topBar.serverUnconfigured');

  const listRef = useRef<AnimatedCardGridHandle>(null);

  // Load history on mount —— 首页固定按活动时间(lastAccessed)排序，
  // 与 HistoryStorage 的 sortConfig 保持一致，复制后才能正确触发重新定位
  useEffect(() => {
    setSort({ field: 'lastAccessed', order: 'desc' });
    loadItems();
  }, [setSort, loadItems]);

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

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      const filter = createHistorySearchFilter({
        keyword: searchText,
        displayKinds: selectedFilterKinds,
        dateFilter: selectedDateFilter,
      });
      const hasFilter = Object.keys(filter).length > 0;
      searchItems(hasFilter ? filter : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, selectedFilterKinds, selectedDateFilter, searchItems]);

  // Back handler for select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelectMode();
      return true;
    });
    return () => handler.remove();
  }, [isSelectMode]);

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

  const actionMenuGroups = useMemo(() => {
    if (!contextItem || !contextDisplayKind) return [];
    return buildActionMenuGroups(contextItem, contextDisplayKind, {
      onCopy: async () => {
        const result = await copyItemWithSync(contextItem);
        showMessage(
          result.success ? t('toast.copied') : result.message || t('toast.copyFailed'),
          result.success ? 'success' : 'error'
        );
      },
      onSelectText: () => {
        // 动作经 close(after) 在浮层退场后才执行，那时 contextTarget 已清空——
        // 这里提前把锚点捕获进闭包，分词浮层才能从同一张卡片原位生长
        setWordPickerTarget({ text: contextItem.text, anchor: contextTarget?.anchor ?? null });
      },
      onCopyPlainText: async () => {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(contextItem.text);
        showMessage(t('toast.copiedPlainText'), 'success');
      },
      onOpenInBrowser: () => {
        Linking.openURL(contextItem.text.trim());
      },
      onSaveImage: async () => {
        try {
          await saveToGallery(contextItem.fileUri!);
          showMessage(t('toast.savedToGallery'), 'success');
        } catch {
          showMessage(t('toast.saveFailed'), 'error');
        }
      },
      onSaveFile: async () => {
        try {
          await saveFile(contextItem.fileUri!, contextItem.dataName);
          showMessage(t('toast.savedFile'), 'success');
        } catch {
          showMessage(t('toast.saveFailed'), 'error');
        }
      },
      onShare: async () => {
        if (
          (contextDisplayKind === 'image' ||
            contextDisplayKind === 'file' ||
            contextDisplayKind === 'group') &&
          contextItem.fileUri &&
          contextItem.isLocalFileReady
        ) {
          await shareFile(contextItem.fileUri, contextItem.dataName);
        } else {
          await Share.share({ message: contextItem.text });
        }
      },
      onSelect: () => {
        setIsSelectMode(true);
        clearSelection();
        toggleSelection(contextItem.profileHash);
      },
      onDelete: async () => {
        await deleteItem(contextItem.profileHash);
        showMessage(t('toast.deleted'), 'success');
      },
    });
  }, [
    contextItem,
    contextTarget,
    contextDisplayKind,
    copyItemWithSync,
    showMessage,
    clearSelection,
    toggleSelection,
    deleteItem,
    t,
  ]);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    clearSelection();
  }, [clearSelection]);

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

  // Sync button — refresh clipboard + history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await refreshFromServer();
      await loadItems();
      if (historySyncEnabled && config) {
        const serverConfig = config.servers[config.activeServerIndex];
        const { getHistorySyncService } = await import('@/services/HistorySyncService');
        const syncService = getHistorySyncService();
        const initialized = await syncService.ensureInitialized(serverConfig);
        if (initialized) {
          await syncService.syncAll(() => {});
        }
      }
      showMessage(t('toast.syncDone'), 'success');
    } catch {
      showMessage(t('toast.syncFailed'), 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, historySyncEnabled, config, showMessage, loadItems, t]);

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
        await loadItems();
        showMessage(t('toast.savedLocally'), 'success');
        BackgroundUploadManager.enqueue(result.profileHash);
      } catch {
        showMessage(t('toast.saveFailed'), 'error');
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
  const handleToggleFilterKind = useCallback((kind: DisplayKind) => {
    setSelectedFilterKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
    );
  }, []);
  const handleClearFilters = useCallback(() => {
    setSelectedFilterKinds([]);
    setSelectedDateFilter('all');
  }, []);
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearchText('');
    setSelectedFilterKinds([]);
    setSelectedDateFilter('all');
    setShowFilterSheet(false);
    searchItems(undefined);
  }, [searchItems]);

  // Render
  const renderCard = useCallback(
    (item: ClipboardItem) => (
      <View style={{ padding: GRID_SPACING / 2 }}>
        <ClipboardCard
          item={item}
          isLatest={item.profileHash === latestId}
          isSelected={selectedIds.has(item.profileHash)}
          isSelectMode={isSelectMode}
          onPress={handleItemPress}
          onLongPress={handleItemLongPress}
          cardSize={cardSize}
        />
      </View>
    ),
    [latestId, selectedIds, isSelectMode, handleItemPress, handleItemLongPress, cardSize]
  );

  const keyExtractor = useCallback((item: ClipboardItem) => item.profileHash, []);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: iosColors?.systemGroupedBackground ?? theme.colors.background },
      ]}
    >
      <StatusBar
        barStyle={theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />

      {/* Top Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        {isSelectMode ? (
          <SelectModeTopBar
            count={selectedIds.size}
            allSelected={allSelected}
            onSelectAll={handleSelectAll}
            onDone={exitSelectMode}
            theme={theme}
          />
        ) : isSearching ? (
          <SearchTopBar
            searchText={searchText}
            onChangeText={setSearchText}
            selectedKinds={selectedFilterKinds}
            selectedDate={selectedDateFilter}
            hasActiveFilters={hasActiveFilters}
            onOpenFilters={() => setShowFilterSheet(true)}
            onRemoveKind={handleToggleFilterKind}
            onClearDateFilter={() => setSelectedDateFilter('all')}
            onClose={closeSearch}
            theme={theme}
          />
        ) : (
          <DefaultTopBar
            serverLabel={activeServerLabel}
            connectionStatus={connectionStatus}
            onSwitchServer={() => setShowServerPicker(true)}
            onSearch={openSearch}
            onSettings={onOpenSettings}
            theme={theme}
            onSelectMode={() => {
              setIsSelectMode(true);
              clearSelection();
            }}
          />
        )}
      </View>

      {/* 同步状态 banner：HasNewUnwritten(待应用) / LoopDetected(循环已暂停) */}
      {syncState === 'HasNewUnwritten' && (
        <SyncStatusBanner
          variant="staged"
          title={t('banner.staged.title', { ns: 'sync' })}
          subtitle={stagedPreviewText}
          actionLabel={t(isApplyingStaged ? 'banner.staged.applying' : 'banner.staged.apply', {
            ns: 'sync',
          })}
          isActionBusy={isApplyingStaged}
          onAction={handleApplyStagedEntry}
          theme={theme}
        />
      )}
      {syncState === 'LoopDetected' && (
        <SyncStatusBanner
          variant="loop"
          title={t('banner.loop.title', { ns: 'sync' })}
          subtitle={t('banner.loop.subtitle', { ns: 'sync' })}
          actionLabel={t('banner.loop.dismiss', { ns: 'sync' })}
          onAction={handleDismissLoop}
          theme={theme}
        />
      )}

      {/* Grid or Empty */}
      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color={theme.colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}>
            {t('empty.title')}
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary }]}>
            {t('empty.description')}
          </Text>
          <Pressable
            onPress={() => setShowAddMenu(true)}
            style={[styles.emptyCta, { backgroundColor: theme.colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={t('empty.cta')}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={theme.colors.onAccent} />
            <Text style={[styles.emptyCtaText, { color: theme.colors.onAccent }]}>
              {t('empty.cta')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <AnimatedCardGrid
          ref={listRef}
          items={items}
          numColumns={NUM_COLUMNS}
          cardSize={cardSize}
          spacing={GRID_SPACING}
          paddingHorizontal={GRID_PADDING - GRID_SPACING / 2}
          paddingTop={8}
          paddingBottom={80}
          keyExtractor={keyExtractor}
          renderItem={renderCard}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Platform.OS === 'ios' ? undefined : theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
        />
      )}

      {/* 多选底栏(默认态由右下 FAB 取代) */}
      {isSelectMode && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
          <SelectModeBottomBar
            disabled={selectedIds.size === 0}
            onCopy={handleBatchCopy}
            onShare={handleBatchShare}
            onDelete={handleBatchDelete}
            theme={theme}
          />
        </View>
      )}

      {/* 右下融合操作按钮 + 上传悬浮菜单(默认态;上传进度页占屏时隐藏) */}
      {!isSelectMode && !isSearching && (
        <AddActionsFab
          open={showAddMenu}
          onOpenChange={setShowAddMenu}
          onTakePhoto={handleTakePhoto}
          onPickImage={handleUploadImage}
          onPickFile={handleUploadFile}
          onUploadClipboard={handleUpload}
          onSync={handleSyncHistory}
          theme={theme}
        />
      )}

      <ConnectedMessageToast />

      <HistoryFilterSheet
        visible={showFilterSheet}
        selectedKinds={selectedFilterKinds}
        selectedDate={selectedDateFilter}
        onToggleKind={handleToggleFilterKind}
        onSelectDate={setSelectedDateFilter}
        onClear={handleClearFilters}
        onClose={() => setShowFilterSheet(false)}
        theme={theme}
      />

      {/* Server Switcher */}
      <ServerSwitcherModal
        visible={showServerPicker}
        servers={servers}
        activeIndex={activeServerIndex}
        onSelect={async (index) => {
          await setActiveServer(index);
          setShowServerPicker(false);
          showMessage(t('toast.serverSwitched'), 'success');
        }}
        onClose={() => setShowServerPicker(false)}
        onAdd={() => {
          setShowServerPicker(false);
          setShowAddServer(true);
        }}
        theme={theme}
      />

      {/* Add Server Modal */}
      <AddServerSheet
        visible={showAddServer}
        onClose={() => setShowAddServer(false)}
        onSave={async (data) => {
          await addServer({
            type: 'syncclipboard',
            url: data.urls[0],
            urls: data.urls,
            name: data.name || undefined,
            username: data.username,
            password: data.password,
          });
          setShowAddServer(false);
          showMessage(t('toast.serverAdded'), 'success');
        }}
      />

      {wordPickerTarget && (
        <WordPickerOverlay
          text={wordPickerTarget.text}
          anchor={wordPickerTarget.anchor}
          onDismiss={() => setWordPickerTarget(null)}
        />
      )}

      <CardContextOverlay
        item={contextItem}
        displayKind={contextDisplayKind}
        anchor={contextTarget?.anchor ?? null}
        actionGroups={actionMenuGroups}
        onDismiss={handleContextDismiss}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyCta: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
  },
  emptyCtaText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
