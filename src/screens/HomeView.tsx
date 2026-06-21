import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TextInput,
  Pressable,
  Share,
  BackHandler,
  useWindowDimensions,
  StatusBar,
  Modal,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { spacing } from '@/theme';
import { useHistoryStore } from '@/stores/historyStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSettingsStore } from '@/stores';
import { useClipboardSyncServiceStore } from '@/stores/ClipboardSyncServiceStore';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { historyStorage } from '@/services';
import { getClipboardSyncService } from '@/services/ClipboardSyncService';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { ServerConfig } from '@/types/api';
import { ServerConfigModal } from '@/components/ServerConfigModal';
import { ClipboardCard } from '@/components/ClipboardCard';
import { MessageToast } from '@/components/MessageToast';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { HistoryFilter } from '@/types/storage';
import { isHistorySyncEnabled } from '@/utils/config';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

const GRID_SPACING = 12;
const GRID_PADDING = 16;
const NUM_COLUMNS = 2;

interface HomeViewProps {
  onOpenSettings: () => void;
}

export function HomeView({ onOpenSettings }: HomeViewProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const cardSize = (screenWidth - GRID_PADDING * 2 - GRID_SPACING * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  // Stores
  const {
    items,
    loadItems,
    searchItems,
    clearHistory,
    toggleStar,
    lastAddedTimestamp,
    handleStorageChange,
    setSort,
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    deleteSelected,
  } = useHistoryStore();
  const { config, getActiveServer, getServers, setActiveServer, addServer } = useSettingsStore();
  const { message, showMessage, clearMessage } = useMessageStore();
  const { error, setError, clearError } = useErrorStore();
  const uploadingClipboard = useClipboardSyncServiceStore((s) => s.uploadingClipboard);
  const fileUploadProgress = useClipboardSyncServiceStore((s) => s.fileUploadProgress);

  const activeServer = getActiveServer();
  const historySyncEnabled = useMemo(() => isHistorySyncEnabled(config), [config]);

  // UI state
  const [refreshing, setRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [fileUploadPayload, setFileUploadPayload] = useState<{
    uri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number;
  } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
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
      const filter: HistoryFilter | undefined = searchText ? { keyword: searchText } : undefined;
      searchItems(filter);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, searchItems]);

  // Back handler for select mode
  useEffect(() => {
    if (!isSelectMode) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelectMode();
      return true;
    });
    return () => handler.remove();
  }, [isSelectMode]);

  // Sorted items
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.timestamp - a.timestamp);
  }, [items]);

  const latestId = sortedItems[0]?.profileHash;

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

  const handleItemLongPress = useCallback(
    (item: ClipboardItem) => {
      if (!isSelectMode) {
        setIsSelectMode(true);
        clearSelection();
      }
      toggleSelection(item.profileHash);
    },
    [isSelectMode, clearSelection, toggleSelection]
  );

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedItems.length) {
      clearSelection();
    } else {
      selectAll();
    }
  }, [selectedIds.size, sortedItems.length, clearSelection, selectAll]);

  const handleBatchDelete = useCallback(async () => {
    await deleteSelected();
    setIsSelectMode(false);
  }, [deleteSelected]);

  const handleBatchCopy = useCallback(async () => {
    const selected = sortedItems.filter((i) => selectedIds.has(i.profileHash));
    const texts = selected.map((i) => i.text).join('\n');
    const { default: Clipboard } = await import('expo-clipboard');
    await Clipboard.setStringAsync(texts);
    showMessage('已复制所选内容', 'success');
    exitSelectMode();
  }, [sortedItems, selectedIds, showMessage, exitSelectMode]);

  const handleBatchShare = useCallback(async () => {
    const selected = sortedItems.filter((i) => selectedIds.has(i.profileHash));
    const texts = selected.map((i) => i.text).join('\n');
    await Share.share({ message: texts });
    exitSelectMode();
  }, [sortedItems, selectedIds, exitSelectMode]);

  // Refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await getClipboardSyncService().refreshContent();
      await loadItems();
    } finally {
      setRefreshing(false);
    }
  }, [loadItems]);

  // Sync history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    if (!historySyncEnabled) {
      showMessage('请先配置服务器', 'error');
      return;
    }
    const serverConfig = config!.servers[config!.activeServerIndex];
    const { getHistorySyncService } = await import('@/services/HistorySyncService');
    const syncService = getHistorySyncService();
    const initialized = syncService.ensureInitialized(serverConfig);
    if (!initialized) {
      showMessage('同步服务初始化失败', 'error');
      return;
    }
    setIsSyncing(true);
    try {
      await syncService.syncAll(() => {});
      showMessage('同步完成', 'success');
    } catch (e) {
      showMessage('同步失败', 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, historySyncEnabled, config, showMessage]);

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
    } catch (e) {
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
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
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
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearchText('');
    searchItems(undefined);
  }, [searchItems]);

  // Render
  const renderCard = useCallback(
    ({ item }: { item: ClipboardItem }) => (
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

  const allSelected = sortedItems.length > 0 && selectedIds.size === sortedItems.length;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
        ) : (
          <DefaultTopBar
            serverLabel={activeServerLabel}
            isConnected={!!activeServer}
            onSettings={onOpenSettings}
            showMenu={showMenu}
            setShowMenu={setShowMenu}
            theme={theme}
            onSelectMode={() => {
              setIsSelectMode(true);
              clearSelection();
            }}
          />
        )}
      </View>

      {/* Grid or Empty */}
      {sortedItems.length === 0 ? (
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
          data={sortedItems}
          renderItem={renderCard}
          keyExtractor={keyExtractor}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={{
            paddingHorizontal: GRID_PADDING - GRID_SPACING / 2,
            paddingTop: 8,
            paddingBottom: 80,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.primary}
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
        ) : isSearching ? (
          <SearchBottomBar
            searchText={searchText}
            onChangeText={setSearchText}
            onClose={closeSearch}
            theme={theme}
          />
        ) : (
          <DefaultBottomBar
            serverLabel={activeServerLabel}
            isSyncing={isSyncing}
            onSearch={openSearch}
            onServerPicker={() => setShowServerPicker(true)}
            onSync={handleSyncHistory}
            theme={theme}
          />
        )}
      </View>

      <MessageToast message={message} onMessageShown={clearMessage} />

      {/* Server Switcher Modal */}
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
      <ServerConfigModal
        visible={showAddServer}
        onClose={() => setShowAddServer(false)}
        onSave={async (serverConfig) => {
          await addServer(serverConfig);
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
    </View>
  );
}

// ─── Top Bar Components ─────────────────────────────────────────

function DefaultTopBar({
  serverLabel,
  isConnected,
  onSettings,
  onSelectMode,
  showMenu,
  setShowMenu,
  theme,
}: {
  serverLabel: string;
  isConnected: boolean;
  onSettings: () => void;
  onSelectMode: () => void;
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={styles.topBarRow}>
      <View style={styles.serverStatus}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isConnected ? '#4CAF50' : '#9E9E9E' },
          ]}
        />
        <Text
          style={[styles.serverLabel, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {serverLabel}
        </Text>
      </View>
      <View style={styles.topBarActions}>
        <Pressable
          onPress={onSelectMode}
          style={[styles.topBarPill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[styles.topBarPillText, { color: theme.colors.onSurface }]}>选择</Text>
        </Pressable>
        <Pressable
          onPress={onSettings}
          style={[styles.topBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

function SelectModeTopBar({
  count,
  allSelected,
  onSelectAll,
  onDone,
  theme,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDone: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={styles.topBarRow}>
      <Text style={[styles.selectCount, { color: theme.colors.onSurface }]}>
        已选择 {count} 项
      </Text>
      <View style={styles.topBarActions}>
        <Pressable
          onPress={onSelectAll}
          style={[styles.topBarPill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[styles.topBarPillText, { color: theme.colors.onSurface }]}>
            {allSelected ? '取消全选' : '全选'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          style={[styles.topBarPill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
        >
          <Text style={[styles.topBarPillText, { color: theme.colors.onSurface }]}>完成</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Bottom Bar Components ──────────────────────────────────────

function DefaultBottomBar({
  serverLabel,
  isSyncing,
  onSearch,
  onServerPicker,
  onSync,
  theme,
}: {
  serverLabel: string;
  isSyncing: boolean;
  onSearch: () => void;
  onServerPicker: () => void;
  onSync: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={styles.bottomBarRow}>
      <Pressable
        onPress={onSearch}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="search" size={20} color={theme.colors.onSurface} />
      </Pressable>
      <Pressable
        onPress={onServerPicker}
        style={[styles.bottomBarPill, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="time-outline" size={16} color={theme.colors.onSurface} />
        <Text
          style={[styles.bottomBarPillText, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {serverLabel}
        </Text>
        <Ionicons name="chevron-expand-outline" size={12} color={theme.colors.onSurfaceVariant} />
      </Pressable>
      <Pressable
        onPress={onSync}
        disabled={isSyncing}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        {isSyncing ? (
          <Ionicons name="sync" size={20} color={theme.colors.onSurfaceVariant} />
        ) : (
          <Ionicons name="sync" size={20} color={theme.colors.onSurface} />
        )}
      </Pressable>
    </View>
  );
}

function SearchBottomBar({
  searchText,
  onChangeText,
  onClose,
  theme,
}: {
  searchText: string;
  onChangeText: (t: string) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <View style={styles.bottomBarRow}>
      <View
        style={[
          styles.searchInput,
          { backgroundColor: theme.colors.surfaceContainerHigh },
        ]}
      >
        <Ionicons name="search" size={16} color={theme.colors.onSurfaceVariant} />
        <TextInput
          style={[styles.searchTextInput, { color: theme.colors.onSurface }]}
          value={searchText}
          onChangeText={onChangeText}
          placeholder="搜索剪贴板"
          placeholderTextColor={theme.colors.onSurfaceVariant}
          autoFocus
        />
        {searchText.length > 0 && (
          <Pressable onPress={() => onChangeText('')}>
            <Ionicons name="close-circle" size={16} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={onClose}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="close" size={20} color={theme.colors.onSurface} />
      </Pressable>
    </View>
  );
}

function SelectModeBottomBar({
  disabled,
  onCopy,
  onShare,
  onDelete,
  theme,
}: {
  disabled: boolean;
  onCopy: () => void;
  onShare: () => void;
  onDelete: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  const iconColor = disabled ? theme.colors.outline : theme.colors.onSurface;
  return (
    <View style={styles.selectBottomRow}>
      <Pressable
        onPress={onCopy}
        disabled={disabled}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="copy-outline" size={20} color={iconColor} />
      </Pressable>
      <Pressable
        onPress={onShare}
        disabled={disabled}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="share-outline" size={20} color={iconColor} />
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={disabled}
        style={[styles.bottomBarCircle, { backgroundColor: theme.colors.surfaceContainerHigh }]}
      >
        <Ionicons name="trash-outline" size={20} color={disabled ? theme.colors.outline : '#F44336'} />
      </Pressable>
    </View>
  );
}

// ─── Server Switcher Modal ───────────────────────────────────────

function ServerSwitcherModal({
  visible,
  servers,
  activeIndex,
  onSelect,
  onClose,
  onAdd,
  theme,
}: {
  visible: boolean;
  servers: ServerConfig[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onAdd: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={modalStyles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View
        style={[
          modalStyles.sheet,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        {/* Handle */}
        <View style={modalStyles.handleRow}>
          <View style={[modalStyles.handle, { backgroundColor: theme.colors.outlineVariant }]} />
        </View>
        {/* Header: ✕ 服务器 + */}
        <View style={modalStyles.header}>
          <Pressable onPress={onClose} style={modalStyles.headerButton}>
            <Ionicons name="close" size={20} color={theme.colors.onSurface} />
          </Pressable>
          <Text style={[modalStyles.headerTitle, { color: theme.colors.onSurface }]}>
            服务器
          </Text>
          <Pressable onPress={onAdd} style={modalStyles.headerButton}>
            <Ionicons name="add" size={22} color={theme.colors.primary} />
          </Pressable>
        </View>
        {/* Server list */}
        <ScrollView style={modalStyles.list}>
          {servers.length === 0 ? (
            <View style={modalStyles.emptyState}>
              <Ionicons name="server-outline" size={40} color={theme.colors.outlineVariant} />
              <Text style={[modalStyles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
                还没有服务器
              </Text>
              <Pressable
                onPress={onAdd}
                style={[modalStyles.addButton, { backgroundColor: theme.colors.primary }]}
              >
                <Ionicons name="add" size={18} color={theme.colors.onPrimary} />
                <Text style={[modalStyles.addButtonText, { color: theme.colors.onPrimary }]}>
                  添加服务器
                </Text>
              </Pressable>
            </View>
          ) : (
            servers.map((server, index) => {
              const isActive = index === activeIndex;
              return (
                <Pressable
                  key={`${server.url}-${index}`}
                  onPress={() => onSelect(index)}
                  style={[
                    modalStyles.serverRow,
                    {
                      backgroundColor: isActive
                        ? 'rgba(76,175,80,0.08)'
                        : 'transparent',
                    },
                  ]}
                >
                  <Ionicons
                    name={isActive ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={isActive ? '#4CAF50' : theme.colors.onSurfaceVariant}
                  />
                  <View style={modalStyles.serverInfo}>
                    <Text
                      style={[modalStyles.serverName, { color: theme.colors.onSurface }]}
                      numberOfLines={1}
                    >
                      {server.name || server.url}
                    </Text>
                    <Text
                      style={[modalStyles.serverUrl, { color: theme.colors.onSurfaceVariant }]}
                      numberOfLines={1}
                    >
                      {server.url}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 32,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 2,
  },
  serverInfo: {
    flex: 1,
    gap: 2,
  },
  serverName: {
    fontSize: 15,
    fontWeight: '600',
  },
  serverUrl: {
    fontSize: 12,
  },
});

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Top Bar
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
  },
  serverStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  serverLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topBarPill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarPillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  topBarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectCount: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Empty state
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
  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  bottomBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bottomBarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  bottomBarPill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  bottomBarPillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  searchInput: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchTextInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  selectBottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
});
