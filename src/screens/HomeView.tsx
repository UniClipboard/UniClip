import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Share,
  Linking,
  BackHandler,
  useWindowDimensions,
  StatusBar,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { iosColors } from '@/theme/iosDesignTokens';
import { DefaultTopBar, SearchTopBar, SelectModeTopBar } from '@/components/HomeTopBar';
import { DefaultBottomBar, SelectModeBottomBar } from '@/components/HomeBottomBar';
import { ServerSwitcherModal } from '@/components/ServerSwitcherModal';
import { ClipboardCardActionSheet } from '@/components/ClipboardCardActionSheet';
import { ClipboardCardMenu } from '@/components/ClipboardCardMenu';
import { HistoryFilterSheet } from '@/components/HistoryFilterSheet';
import { useHistoryStore } from '@/stores/historyStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSettingsStore } from '@/stores';
import { useClipboardSyncServiceStore } from '@/stores/ClipboardSyncServiceStore';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { historyStorage } from '@/services';
import { getClipboardSyncService } from '@/services/ClipboardSyncService';
import { getLatest, getFile } from 'uc-core';
import type { ClipboardMeta } from 'uc-core';
import { getCurrentNetworkContext } from '@/services/networkContext';
import { loadServerRouteLiveUrl, saveServerRouteLiveUrl } from '@/services/serverRouteRecordStore';
import { selectServerUrl } from '@/services/serverRouteSelector';
import {
  ClipboardItem,
  ClipboardContent,
  createDefaultClipboardItem,
  HistorySyncStatus,
} from '@/types/clipboard';
import { AddServerSheet } from '@/components/AddServerSheet';
import { ClipboardCard } from '@/components/ClipboardCard';
import { MessageToast } from '@/components/MessageToast';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { DisplayKind, getDisplayKind } from '@/utils/displayKind';
import { buildActionMenuItems } from '@/utils/actionMenuItems';
import { saveToGallery, saveFile, shareFile } from '@/utils/fileActions';
import { createHistorySearchFilter, HistoryDateFilter } from '@/utils/historyFilters';
import { isHistorySyncEnabled } from '@/utils/config';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

const GRID_SPACING = 12;
const GRID_PADDING = 16;
const NUM_COLUMNS = 2;

async function fetchAndApplyServerClipboard(): Promise<void> {
  const { useSettingsStore } = require('@/stores/settingsStore');
  const settings = useSettingsStore.getState();
  const server = settings.getActiveServer();
  if (!server?.url) return;

  const ucServer = {
    baseUrl: server.url.replace(/\/+$/, ''),
    username: server.username || '',
    password: server.password || '',
  };
  const trustInsecure = settings.config?.trustInsecureCert ?? false;

  let entry: ClipboardMeta;
  let downloadedText: string | null = null;
  try {
    const selected = await selectServerUrl(
      server,
      {
        network: getCurrentNetworkContext(),
        loadLiveUrl: loadServerRouteLiveUrl,
        saveLiveUrl: saveServerRouteLiveUrl,
      },
      async (route) => {
        const routeServer = {
          ...ucServer,
          baseUrl: route.url,
        };
        const latest = await getLatest(routeServer, trustInsecure);
        if (latest.kind === 'Text' && latest.hasData && latest.dataName) {
          const bytes = await getFile(routeServer, latest.dataName, trustInsecure);
          return { entry: latest, downloadedText: new TextDecoder().decode(bytes) };
        }
        return { entry: latest, downloadedText: null };
      }
    );
    entry = selected.result.entry;
    downloadedText = selected.result.downloadedText;
  } catch (e: any) {
    if (e?.message?.includes('404')) return;
    throw e;
  }
  if (!entry) return;

  // Write to system clipboard
  const Clipboard = require('expo-clipboard');
  const { clipboardMonitor } = require('@/services/ClipboardMonitor');
  clipboardMonitor.pausePolling();
  try {
    if (entry.kind === 'Text') {
      if (downloadedText !== null) {
        await Clipboard.setStringAsync(downloadedText);
      } else {
        await Clipboard.setStringAsync(entry.text);
      }
    }
    if (entry.hash) {
      await clipboardMonitor.setLastContent({
        type: entry.kind,
        text: entry.text,
        profileHash: entry.hash,
        localClipboardHash: entry.hash,
      });
    }
  } finally {
    clipboardMonitor.resumePolling();
  }

  // Add to history
  const { useHistoryStore } = require('@/stores/historyStore');
  await useHistoryStore.getState().addItem(
    createDefaultClipboardItem({
      type: entry.kind,
      text: entry.text,
      profileHash: entry.hash ?? '',
      hasData: entry.hasData,
      dataName: entry.dataName ?? undefined,
      size: entry.size,
      timestamp: Date.now(),
      syncStatus: HistorySyncStatus.Synced,
      from: 'server',
    })
  );
}

// 自订阅 messageStore，把 toast 出现/消失的重渲染隔离在此，不波及 HomeView 主体与 FlatList
function HomeMessageToast() {
  const message = useMessageStore((s) => s.message);
  const clearMessage = useMessageStore((s) => s.clearMessage);
  return <MessageToast message={message} onMessageShown={clearMessage} />;
}

interface HomeViewProps {
  onOpenSettings: () => void;
}

export function HomeView({ onOpenSettings }: HomeViewProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const cardSize =
    (screenWidth - GRID_PADDING * 2 - GRID_SPACING * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  // Stores —— 全部用细粒度 selector 订阅。整体订阅会让 store 任意字段(isLoading /
  // totalCount / message / error 等)变化都重渲染整个 HomeView + FlatList。
  // action 引用稳定，订阅它们不会触发重渲染。
  const items = useHistoryStore((s) => s.items);
  const selectedIds = useHistoryStore((s) => s.selectedIds);
  const lastAddedTimestamp = useHistoryStore((s) => s.lastAddedTimestamp);
  const loadItems = useHistoryStore((s) => s.loadItems);
  const searchItems = useHistoryStore((s) => s.searchItems);
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

  // message 不在此订阅，交给隔离的 <HomeMessageToast/>，toast 出现/消失只重渲它自身
  const showMessage = useMessageStore((s) => s.showMessage);
  const clearError = useErrorStore((s) => s.clearError);
  const fileUploadProgress = useClipboardSyncServiceStore((s) => s.fileUploadProgress);

  const activeServer = getActiveServer();
  const historySyncEnabled = useMemo(() => isHistorySyncEnabled(config), [config]);

  // UI state
  const [refreshing, setRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedFilterKinds, setSelectedFilterKinds] = useState<DisplayKind[]>([]);
  const [selectedDateFilter, setSelectedDateFilter] = useState<HistoryDateFilter>('all');
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [fileUploadPayload, setFileUploadPayload] = useState<{
    uri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number;
  } | null>(null);

  const [showServerPicker, setShowServerPicker] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);

  const servers = getServers();
  const activeServerIndex = config?.activeServerIndex ?? -1;
  const activeServerLabel = activeServer?.name || activeServer?.url || '未配置';

  const listRef = useRef<FlatList<ClipboardItem>>(null);

  // Load history on mount
  useEffect(() => {
    loadItems();
  }, [loadItems]);

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
      historyStorage.updateLastAccessed(item.profileHash);
    }
    return result;
  }, []);

  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      if (isSelectMode) {
        toggleSelection(item.profileHash);
        return;
      }
      const result = await copyItemWithSync(item);
      if (result.success) {
        showMessage('已复制到剪贴板', 'success');
      } else {
        showMessage(result.message || '复制失败', 'error');
      }
    },
    [isSelectMode, toggleSelection, copyItemWithSync, showMessage]
  );

  // ── Long-press → action sheet ────────────────────────────────
  const [actionSheetItem, setActionSheetItem] = useState<ClipboardItem | null>(null);

  const handleItemLongPress = useCallback((item: ClipboardItem) => {
    import('expo-haptics')
      .then((Haptics) => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))
      .catch(() => {});
    setActionSheetItem(item);
  }, []);

  const handleActionSheetDismiss = useCallback(() => {
    setActionSheetItem(null);
  }, []);

  const actionSheetDisplayKind = useMemo(
    () => (actionSheetItem ? getDisplayKind(actionSheetItem.type, actionSheetItem.text) : null),
    [actionSheetItem]
  );

  const actionMenuItems = useMemo(() => {
    if (!actionSheetItem || !actionSheetDisplayKind) return [];
    return buildActionMenuItems(actionSheetItem, actionSheetDisplayKind, {
      onCopy: async () => {
        const result = await copyItemWithSync(actionSheetItem);
        showMessage(
          result.success ? '已复制到剪贴板' : result.message || '复制失败',
          result.success ? 'success' : 'error'
        );
      },
      onSelectText: () => {
        setWordPickerText(actionSheetItem.text);
      },
      onCopyPlainText: async () => {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.default.setStringAsync(actionSheetItem.text);
        showMessage('已复制为纯文本', 'success');
      },
      onOpenInBrowser: () => {
        Linking.openURL(actionSheetItem.text.trim());
      },
      onSaveImage: async () => {
        try {
          await saveToGallery(actionSheetItem.fileUri!);
          showMessage('已保存到相册', 'success');
        } catch {
          showMessage('保存失败', 'error');
        }
      },
      onSaveFile: async () => {
        try {
          await saveFile(actionSheetItem.fileUri!, actionSheetItem.dataName);
          showMessage('已保存文件', 'success');
        } catch {
          showMessage('保存失败', 'error');
        }
      },
      onShare: async () => {
        if (
          (actionSheetDisplayKind === 'image' ||
            actionSheetDisplayKind === 'file' ||
            actionSheetDisplayKind === 'group') &&
          actionSheetItem.fileUri &&
          actionSheetItem.isLocalFileReady
        ) {
          await shareFile(actionSheetItem.fileUri, actionSheetItem.dataName);
        } else {
          await Share.share({ message: actionSheetItem.text });
        }
      },
      onSelect: () => {
        setIsSelectMode(true);
        clearSelection();
        toggleSelection(actionSheetItem.profileHash);
      },
      onDelete: async () => {
        await deleteItem(actionSheetItem.profileHash);
        showMessage('已删除', 'success');
      },
    });
  }, [
    actionSheetItem,
    actionSheetDisplayKind,
    copyItemWithSync,
    showMessage,
    clearSelection,
    toggleSelection,
    deleteItem,
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
    const { default: Clipboard } = await import('expo-clipboard');
    await Clipboard.setStringAsync(texts);
    showMessage('已复制所选内容', 'success');
    exitSelectMode();
  }, [items, selectedIds, showMessage, exitSelectMode]);

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
      await fetchAndApplyServerClipboard();
      await loadItems();
    } finally {
      setRefreshing(false);
    }
  }, [loadItems]);

  // Sync button — refresh clipboard + history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await fetchAndApplyServerClipboard();
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
      showMessage('同步完成', 'success');
    } catch {
      showMessage('同步失败', 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, historySyncEnabled, config, showMessage, loadItems]);

  // Upload
  const handleUpload = useCallback(async () => {
    try {
      clearError();
      const result = await getClipboardSyncService().triggerUpload();
      if (result.success) {
        showMessage('已上传到服务器', 'success');
      } else {
        showMessage(result.error || '上传失败', 'error');
      }
    } catch {
      showMessage('上传失败', 'error');
    }
  }, [showMessage, clearError]);

  // Upload file
  const handleUploadFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.name || 'file',
        mimeType: asset.mimeType,
        fileSize: asset.size,
      });
    } catch {
      showMessage('选择文件失败', 'error');
    }
  }, [showMessage]);

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
      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch {
      showMessage('选择图片失败', 'error');
    }
  }, [showMessage]);

  const fileUploadTask = useCallback(
    async (signal: AbortSignal) => {
      if (!fileUploadPayload) throw new Error('没有可上传的文件');
      await getClipboardSyncService().uploadFile(fileUploadPayload, signal);
    },
    [fileUploadPayload]
  );

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
    ({ item }: { item: ClipboardItem }) => (
      <View style={{ padding: GRID_SPACING / 2 }}>
        <ClipboardCardMenu item={item} cardSize={cardSize}>
          <ClipboardCard
            item={item}
            isLatest={item.profileHash === latestId}
            isSelected={selectedIds.has(item.profileHash)}
            isSelectMode={isSelectMode}
            onPress={handleItemPress}
            onLongPress={handleItemLongPress}
            cardSize={cardSize}
          />
        </ClipboardCardMenu>
      </View>
    ),
    [latestId, selectedIds, isSelectMode, handleItemPress, handleItemLongPress, cardSize]
  );

  const keyExtractor = useCallback((item: ClipboardItem) => item.profileHash, []);

  // 网格行高固定（卡片 + 上下间距），提供 getItemLayout 省去布局测量，
  // 让滚动定位与 scrollToOffset 走快路径。
  const rowHeight = cardSize + GRID_SPACING;
  const getItemLayout = useCallback(
    (_data: ArrayLike<ClipboardItem> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: rowHeight * Math.floor(index / NUM_COLUMNS),
      index,
    }),
    [rowHeight]
  );

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
            isConnected={!!activeServer}
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

      {/* Grid or Empty */}
      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="clipboard-outline" size={48} color={theme.colors.onSurfaceVariant} />
          <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>
            还没有同步过剪贴板
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.onSurfaceVariant }]}>
            服务器的新内容会自动出现在这里
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderCard}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLUMNS}
          getItemLayout={getItemLayout}
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={9}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{
            paddingHorizontal: GRID_PADDING - GRID_SPACING / 2,
            paddingTop: 8,
            paddingBottom: 80,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Platform.OS === 'ios' ? undefined : theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        {isSelectMode ? (
          <SelectModeBottomBar
            disabled={selectedIds.size === 0}
            onCopy={handleBatchCopy}
            onShare={handleBatchShare}
            onDelete={handleBatchDelete}
            theme={theme}
          />
        ) : (
          <DefaultBottomBar
            serverLabel={activeServerLabel}
            isSyncing={isSyncing}
            onServerPicker={() => setShowServerPicker(true)}
            onSync={handleSyncHistory}
            theme={theme}
          />
        )}
      </View>

      <HomeMessageToast />

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
          showMessage('已切换服务器', 'success');
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
          showMessage('服务器已添加', 'success');
        }}
      />

      {fileUploadPayload && (
        <View style={StyleSheet.absoluteFill}>
          <QuickLoadingPage
            task={fileUploadTask}
            loadingText={fileUploadProgress?.stage ?? '正在处理文件…'}
            successText="上传成功"
            failureText="上传失败"
            onComplete={() => setFileUploadPayload(null)}
            progress={fileUploadProgress?.progressInfo}
            previewText={fileUploadPayload.fileName}
            previewImage={
              fileUploadPayload.mimeType?.startsWith('image/') ? fileUploadPayload.uri : undefined
            }
          />
        </View>
      )}

      {wordPickerText && (
        <View style={StyleSheet.absoluteFill}>
          <WordPickerScreen text={wordPickerText} onComplete={() => setWordPickerText(null)} />
        </View>
      )}

      <ClipboardCardActionSheet
        visible={actionSheetItem !== null}
        item={actionSheetItem}
        displayKind={actionSheetDisplayKind}
        onDismiss={handleActionSheetDismiss}
        actions={actionMenuItems}
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
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
