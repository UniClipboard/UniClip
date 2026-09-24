import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Share, Linking, BackHandler, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import * as Haptics from 'expo-haptics';
import type { CardAnchorRect } from '@/components/CardContextOverlay.types';
import { AnimatedCardGridHandle } from '@/components/AnimatedCardGrid';
import { useHistoryStore } from '@/features/history';
import { useClipboardStore } from '@/features/clipboard';
import { useSettingsStore } from '@/stores';
import { createLogger } from '@/support/observability';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { notifyDeviceClipboardChanged } from '@/features/transfer';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { historyStorage } from '@/features/history';
import { getUnifiedSyncRuntime } from '@/features/sync';
import { getUnifiedSpaceService } from '@/features/space';
import {
  p2pDeliveryCountsFromResend,
  p2pDeliveryStateFromResend,
  p2pDeliveryTranslationOptions,
  p2pDeliveryUpdates,
} from '@/features/transfer';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { importFileToHistory } from '@/utils/uploadFile';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { DisplayKind, getDisplayKind } from '@/utils/displayKind';
import { buildActionMenuGroups, ActionMenuItem } from '@/utils/actionMenuItems';
import { saveToGallery, saveFile, shareFile } from '@/utils/fileActions';
import type { HistoryDateFilter, HistorySourceFilter } from '@/utils/historyFilters';
import { useHomeHistoryFilter } from './useHomeHistoryFilter';
import { CLEAR_FILTERS_ON_CLOSE_SEARCH } from './searchFilterPolicy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { CameraCaptureResult } from '@/components/CameraCaptureSheet.types';
import { HOME_LONG_PRESS_MODE } from '@/utils/homeLongPressMode';
import { HOME_CARD_TAP_MODE } from '@/utils/homeCardTapMode';
import {
  createHistorySendJob,
  createTextSendJob,
  releaseHistorySendJob,
} from '@/utils/historySendJob';
import type { PendingShareJob } from '@/features/transfer';
import { useUndoableHistoryDelete } from './useUndoableHistoryDelete';

const log = createLogger('HomeView');

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
  const storeItems = useHistoryStore((s) => s.items);
  const storeResultCount = useHistoryStore((s) => s.totalCount);
  const isHistoryLoading = useHistoryStore((s) => s.isLoading);
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
  const deleteItems = useHistoryStore((s) => s.deleteItems);

  // message 不在此订阅，交给自隔离的 <ConnectedMessageToast/>，toast 出现/消失只重渲它自身
  const showMessage = useMessageStore((s) => s.showMessage);
  const clearError = useErrorStore((s) => s.clearError);

  // 删除:Android 先隐藏再给「撤销」,iOS 直接删除(策略见 historyDeleteMode.*)
  const deleteMessages = useMemo(
    () => ({
      deleted: t('toast.deleted'),
      deletedCount: (count: number) => t('toast.deletedCount', { count }),
      undo: t('action.undo', { ns: 'common' }),
    }),
    [t]
  );
  const { pendingIds: pendingDeleteIds, requestDelete } = useUndoableHistoryDelete({
    deleteItems,
    showMessage,
    messages: deleteMessages,
  });
  const items = useMemo(
    () =>
      pendingDeleteIds.size === 0
        ? storeItems
        : storeItems.filter((item) => !pendingDeleteIds.has(item.profileHash)),
    [storeItems, pendingDeleteIds]
  );
  const resultCount = Math.max(0, storeResultCount - pendingDeleteIds.size);

  const p2pRefreshRevision = useUnifiedEngineStore((s) => s.refreshRevision);

  // UI state
  const [refreshing, setRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedFilterKinds, setSelectedFilterKinds] = useState<DisplayKind[]>([]);
  const [selectedDateFilter, setSelectedDateFilter] = useState<HistoryDateFilter>('all');
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<HistorySourceFilter>('all');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [wordPickerTarget, setWordPickerTarget] = useState<{
    text: string;
    anchor: CardAnchorRect | null;
    deviceName?: string | null;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Expanded 双栏专用:右栏当前展示的条目。Compact 不使用。
  const [detailItem, setDetailItem] = useState<ClipboardItem | null>(null);
  // 右栏是否「锚定首项」:选中项就是当前首项时为 true —— 之后列表首项变化(新内容置顶/复制置顶)
  // 详情会自动跟到新的第一张;若用户选的是非首项则为 false,新变化不打扰。用 ref 不触发重渲。
  const followFirstRef = useRef(true);

  const hasSearchCriteria =
    (isSearching && searchText.trim().length > 0) ||
    selectedFilterKinds.length > 0 ||
    selectedDateFilter !== 'all' ||
    selectedSourceFilter !== 'all';
  const emptyContent = useMemo(
    () => ({
      icon: hasSearchCriteria ? ('search-outline' as const) : ('clipboard-outline' as const),
      title: t(hasSearchCriteria ? 'search.emptyTitle' : 'empty.online.title'),
      description: t(hasSearchCriteria ? 'search.emptyDescription' : 'empty.online.description'),
      tint: theme.colors.textSecondary,
    }),
    [t, theme.colors.textSecondary, hasSearchCriteria]
  );

  const listRef = useRef<AnimatedCardGridHandle>(null);

  useEffect(() => {
    if (p2pRefreshRevision > 0) {
      loadItems();
    }
  }, [loadItems, p2pRefreshRevision]);

  // Listen for storage changes
  useEffect(() => {
    const handleChange = (changedItems: ClipboardItem[], action: 'add' | 'update' | 'delete') => {
      handleStorageChange(changedItems, action);
    };
    historyStorage.addChangeCallback(handleChange);
    return () => historyStorage.removeChangeCallback(handleChange);
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
    selectedSourceFilter,
    searchItems,
  });

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    clearSelection();
  }, [clearSelection]);

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
  const copyItemLocally = useCallback(async (item: ClipboardItem) => {
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
    }
    return { result, content };
  }, []);

  const startPostCopyFlow = useCallback((item: ClipboardItem, content: ClipboardContent) => {
    // 本机复制与提示已经完成。同步和卡片重排都留在后台，不能反向阻塞复制反馈。
    void notifyDeviceClipboardChanged(content);
    void historyStorage
      .updateLastAccessed(item.profileHash)
      .catch((error) => log.error(`Failed to update copied item order (${getErrorCode(error)})`));
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

  // 复制单条到系统剪贴板:iOS 单击、Android 双击共用。返回是否成功,供卡片播放「已复制」反馈。
  const handleItemCopy = useCallback(
    async (item: ClipboardItem) => {
      // 排序重排后卡片的移动动画由 AnimatedCardGrid/GridCell 按下标变化自动处理，
      // 这里只需要触发复制本身
      const { result, content } = await copyItemLocally(item);
      if (result.success) {
        showMessage(getCopySuccessMessage(), 'success');
        startPostCopyFlow(item, content);
      } else {
        showMessage(result.message || t('toast.copyFailed'), 'error');
      }
      return result.success;
    },
    [copyItemLocally, showMessage, getCopySuccessMessage, startPostCopyFlow, t]
  );

  // 全屏详情页(Android 单击卡片 / 多选溢出菜单「查看详情」)。与 Expanded 右栏的 detailItem
  // 分开:右栏会跟随列表首项,详情页必须钉住打开时的那一条。
  const [detailPageTarget, setDetailPageTarget] = useState<ClipboardItem | null>(null);
  // 取列表里的最新版本(下载完成、投递状态变化会替换条目);条目被删除或过滤掉时为 null。
  const detailPageItem = useMemo(
    () =>
      detailPageTarget
        ? items.find((i) => i.profileHash === detailPageTarget.profileHash) ?? null
        : null,
    [items, detailPageTarget]
  );
  const openDetailPage = useCallback((item: ClipboardItem) => {
    setDetailPageTarget(item);
  }, []);
  const closeDetailPage = useCallback(() => {
    setDetailPageTarget(null);
  }, []);
  useEffect(() => {
    if (detailPageTarget && !detailPageItem) setDetailPageTarget(null);
  }, [detailPageTarget, detailPageItem]);

  // 应用内「发送到」:把一条历史经同步通道发给所选设备(Android 详情页入口)。
  // jobs 在关闭后仍保留,供发送页滑出动画渲染;visible 单独控制显隐。
  const [sendToJobs, setSendToJobs] = useState<PendingShareJob[] | null>(null);
  const [sendToVisible, setSendToVisible] = useState(false);
  const sendToJobsRef = useRef<PendingShareJob[] | null>(null);
  const releaseSendToJobs = useCallback(() => {
    sendToJobsRef.current?.forEach(releaseHistorySendJob);
  }, []);
  const presentSendTo = useCallback(
    (prepare: () => PendingShareJob | null) => {
      releaseSendToJobs();
      let job: PendingShareJob | null = null;
      try {
        job = prepare();
      } catch (error) {
        log.error(`Failed to prepare send-to job (${getErrorCode(error)})`);
      }
      if (!job) {
        showMessage(t('toast.sendToUnavailable'), 'error');
        return;
      }
      sendToJobsRef.current = [job];
      setSendToJobs([job]);
      setSendToVisible(true);
    },
    [releaseSendToJobs, showMessage, t]
  );
  const openSendTo = useCallback(
    (item: ClipboardItem) =>
      presentSendTo(() => createHistorySendJob(item, getDisplayKind(item.type, item.text))),
    [presentSendTo]
  );
  /** 发送一段文本(分词选择的结果):发送页盖在分词页之上,返回后仍在分词页 */
  const openSendToText = useCallback(
    (text: string) => presentSendTo(() => createTextSendJob(text)),
    [presentSendTo]
  );
  const closeSendTo = useCallback(() => {
    setSendToVisible(false);
    releaseSendToJobs();
  }, [releaseSendToJobs]);
  useEffect(() => releaseSendToJobs, [releaseSendToJobs]);

  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      if (isSelectMode) {
        toggleSelection(item.profileHash);
        return;
      }
      if (HOME_CARD_TAP_MODE === 'detail') {
        openDetailPage(item);
        return;
      }
      await handleItemCopy(item);
    },
    [isSelectMode, toggleSelection, openDetailPage, handleItemCopy]
  );
  // 只有「单击看详情」的平台才识别双击;iOS 为 undefined,卡片单击不做延迟。
  const handleItemDoublePress = HOME_CARD_TAP_MODE === 'detail' ? handleItemCopy : undefined;

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
      if (HOME_LONG_PRESS_MODE === 'select') {
        // Android:长按即进入多选并选中该卡,操作由上下文操作栏承接
        Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch(() => {});
        setIsSelectMode(true);
        clearSelection();
        toggleSelection(item.profileHash);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
      setContextTarget({ item, anchor });
    },
    [isSelectMode, toggleSelection, clearSelection]
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
          const { result, content } = await copyItemLocally(item);
          showMessage(
            result.success ? getCopySuccessMessage() : result.message || t('toast.copyFailed'),
            result.success ? 'success' : 'error'
          );
          if (result.success) {
            startPostCopyFlow(item, content);
          }
        },
        onSelectText: () => {
          // 动作经 close(after) 在浮层退场后才执行，那时 contextTarget 已清空——
          // 这里提前把锚点捕获进闭包，分词浮层才能从同一张卡片原位生长
          setWordPickerTarget({ text: item.text, anchor, deviceName: item.deviceName });
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
            log.error(`saveToGallery failed (${getErrorCode(error)})`);
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
            log.error('saveFile failed:', e);
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
            log.error('Failed to resend P2P content:', error);
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
          await requestDelete([item.profileHash], { announce: true });
        },
      }),
    [
      copyItemLocally,
      startPostCopyFlow,
      showMessage,
      clearSelection,
      toggleSelection,
      requestDelete,
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
    const ids = [...selectedIds];
    setIsSelectMode(false);
    clearSelection();
    await requestDelete(ids, { announce: false });
  }, [selectedIds, clearSelection, requestDelete]);

  // 多选恰好选中一项时,上下文操作栏的溢出菜单承接该项的内容类动作(Android 长按入口)。
  // 复制 / 分享 / 删除已在底栏,多选本身即当前模式,故剔除。
  const singleSelectedItem = useMemo(() => {
    if (!isSelectMode || selectedIds.size !== 1) return null;
    const [id] = selectedIds;
    return items.find((i) => i.profileHash === id) ?? null;
  }, [isSelectMode, selectedIds, items]);
  const selectionItemActions = useMemo<ActionMenuItem[]>(() => {
    if (!singleSelectedItem) return [];
    const item = singleSelectedItem;
    const kind = getDisplayKind(item.type, item.text);
    const excluded = new Set(['copy', 'share', 'select', 'delete']);
    const contentActions = makeActionGroups(item, kind, null)
      .flat()
      .filter((action) => !excluded.has(action.key));
    return [
      {
        key: 'details',
        label: t('detail.view'),
        icon: 'expand-outline',
        onPress: () => openDetailPage(item),
      },
      ...contentActions,
    ].map((action) => ({
      ...action,
      onPress: () => {
        exitSelectMode();
        action.onPress();
      },
    }));
  }, [singleSelectedItem, makeActionGroups, openDetailPage, exitSelectMode, t]);

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
      await getUnifiedSyncRuntime().synchronize();
      await loadItems();
    } catch {
      // 下拉刷新同时是同步入口(Android FAB 菜单不再提供「立即同步」),失败必须可见
      showMessage(t('toast.syncFailed'), 'error');
    } finally {
      setRefreshing(false);
    }
  }, [loadItems, showMessage, t]);

  // Sync button — refresh current server value + reload local history
  const handleSyncHistory = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await getUnifiedSyncRuntime().synchronize();
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
      const result = await getUnifiedSyncRuntime().sendCurrentClipboard();
      await loadItems();
      showMessage(
        t(`toast.p2pDelivery.${result.state}`, p2pDeliveryTranslationOptions(result.counts)),
        result.state === 'delivered'
          ? 'success'
          : result.state === 'partial' || result.state === 'pending'
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
        log.error('Failed to save imported content:', error);
        showMessage(t('toast.saveFailed'), 'error');
        return;
      }

      try {
        const sendResult = await getUnifiedSyncRuntime().sendImportedAsset(
          {
            kind: result.contentType === 'Image' ? 'image' : 'file',
            uri: result.fileUri,
            fileName: result.fileName,
            mimeType: payload.mimeType,
          },
          result.profileHash
        );
        await loadItems();
        showMessage(
          t(
            `toast.p2pDelivery.${sendResult.state}`,
            p2pDeliveryTranslationOptions(sendResult.counts)
          ),
          sendResult.state === 'delivered'
            ? 'success'
            : sendResult.state === 'partial' || sendResult.state === 'pending'
            ? 'info'
            : 'error'
        );
      } catch (error) {
        log.error('Failed to send imported content:', error);
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

  // 从相册选择照片或视频上传
  const handleUploadImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await saveAndPush({
        uri: asset.uri,
        fileName: asset.fileName || `asset_${Date.now()}`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch {
      showMessage(t('toast.pickImageFailed'), 'error');
    }
  }, [saveAndPush, showMessage, t]);

  // 拍照/录像上传 —— iOS 原生相机在同时允许图片与视频时自带照片/视频切换,直接走系统相机;
  // Android 的系统相机 intent 只支持拍照或录像之一(MediaStore 的
  // ACTION_IMAGE_CAPTURE / ACTION_VIDEO_CAPTURE 互斥),改用自绘相机页提供照片/视频切换。
  const handleTakePhoto = useCallback(async () => {
    if (Platform.OS === 'android') {
      setCameraOpen(true);
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showMessage(t('toast.cameraPermissionNeeded'), 'error');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const isVideo = asset.mimeType?.startsWith('video/') || asset.type === 'video';
      await saveAndPush({
        uri: asset.uri,
        fileName:
          asset.fileName || (isVideo ? `video_${Date.now()}.mov` : `photo_${Date.now()}.jpg`),
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch {
      showMessage(t('toast.takePhotoFailed'), 'error');
    }
  }, [saveAndPush, showMessage, t]);

  // 自绘相机页(Android)拍摄/录制完成:收起相机页并落库。
  const handleCameraCapture = useCallback(
    (result: CameraCaptureResult) => {
      setCameraOpen(false);
      void saveAndPush({
        uri: result.uri,
        fileName: result.fileName,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
      });
    },
    [saveAndPush]
  );

  // Search
  const openSearch = useCallback(() => {
    setShowAddMenu(false);
    setIsSearching(true);
  }, []);
  const hasActiveFilters =
    selectedFilterKinds.length > 0 ||
    selectedDateFilter !== 'all' ||
    selectedSourceFilter !== 'all';
  // 类型筛选是全局单选(chip 行、iOS 平板 FilterRail 共用):点新类型替换,点已选类型取消
  // (回到「全部」)。状态保持数组是为了兼容 HistoryFilter.displayKinds 的存储/查询管线。
  const handleToggleFilterKind = useCallback((kind: DisplayKind) => {
    setSelectedFilterKinds((current) => (current.includes(kind) ? [] : [kind]));
  }, []);
  // 菜单式单选(Android 搜索筛选):显式设值,null 即「全部类型」,不做再点取消。
  const handleSelectFilterKind = useCallback((kind: DisplayKind | null) => {
    setSelectedFilterKinds(kind ? [kind] : []);
  }, []);
  const handleClearFilters = useCallback(() => {
    setSelectedFilterKinds([]);
    setSelectedDateFilter('all');
    setSelectedSourceFilter('all');
  }, []);
  const handleClearFilterKinds = useCallback(() => {
    setSelectedFilterKinds([]);
  }, []);
  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSearchText('');
    if (CLEAR_FILTERS_ON_CLOSE_SEARCH) handleClearFilters();
  }, [handleClearFilters]);

  // Only the focused home screen consumes Back; selection takes priority over search.
  useFocusEffect(
    useCallback(() => {
      if (!isSelectMode && !isSearching) return;
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isSelectMode) {
          exitSelectMode();
        } else {
          closeSearch();
        }
        return true;
      });
      return () => handler.remove();
    }, [isSelectMode, isSearching, exitSelectMode, closeSearch])
  );

  const resetSearch = useCallback(() => {
    setSearchText('');
    handleClearFilters();
  }, [handleClearFilters]);

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
    resultCount,
    isHistoryLoading,
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
    selectionItemActions,
    // search
    isSearching,
    openSearch,
    closeSearch,
    resetSearch,
    searchText,
    setSearchText,
    selectedFilterKinds,
    selectedDateFilter,
    setSelectedDateFilter,
    selectedSourceFilter,
    setSelectedSourceFilter,
    hasActiveFilters,
    handleSelectFilterKind,
    handleToggleFilterKind,
    handleClearFilters,
    handleClearFilterKinds,
    // grid
    listRef,
    keyExtractor,
    handleItemPress,
    handleItemDoublePress,
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
    // camera sheet (android)
    cameraOpen,
    setCameraOpen,
    handleCameraCapture,
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
    // full-screen detail page (Android card tap / selection overflow)
    detailPageItem,
    openDetailPage,
    closeDetailPage,
    // send to devices (Android detail page)
    sendToJobs,
    sendToVisible,
    openSendTo,
    openSendToText,
    closeSendTo,
  };
}

export type HomeController = ReturnType<typeof useHomeController>;
