/**
 * History List Item Component
 * 历史记录列表项组件
 */

import React, {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useCallback,
  memo,
} from 'react';
import { View, Text, StyleSheet, TouchableHighlight, Image, TouchableOpacity } from 'react-native';
import { Copy, Download, Share, Trash2, ExternalLink } from 'react-native-feather';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, {
  useAnimatedReaction,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardItem } from '@/types/clipboard';
import { useSettingsStore } from '@/stores';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { getHistoryTransferQueue } from '@/services/HistoryTransferQueue';
import { getProfileId } from '@/services/HistoryAPI';
import { formatSizeWithType, formatFileSize } from '@/utils';

export interface HistoryListItemHandle {
  startDelete: () => void;
}

interface DeleteActionComponentProps {
  progress: SharedValue<number>;
  onDelete: (item: ClipboardItem) => void;
  swipeDeleteHint: 'default' | 'continue' | 'release';
  theme: ReturnType<typeof useTheme>['theme'];
  item: ClipboardItem;
  deleteAnimProgress: SharedValue<number>;
  updateSwipeDeleteState: (
    hint: 'default' | 'continue' | 'release',
    shouldAutoDelete: boolean
  ) => void;
}

const DeleteActionComponent = memo(
  ({
    progress,
    onDelete,
    swipeDeleteHint,
    theme,
    item,
    deleteAnimProgress,
    updateSwipeDeleteState,
  }: DeleteActionComponentProps) => {
    const deleteButtonHideStyle = useAnimatedStyle(() => {
      const opacity = deleteAnimProgress.value > 0 ? 0 : 1;
      return {
        opacity,
      };
    });

    useAnimatedReaction(
      () => progress.value,
      (progressVal, previousVal) => {
        const continueThreshold = 1.02;
        const releaseThreshold = 1.55;
        const continueBufferBack = 0.95;
        const releaseBufferBack = 1.4;

        let hint: 'default' | 'continue' | 'release' = 'default';

        if (progressVal >= releaseThreshold) {
          hint = 'release';
        } else if (progressVal >= continueThreshold) {
          hint = 'continue';
        } else if (
          previousVal !== null &&
          previousVal >= releaseThreshold &&
          progressVal >= releaseBufferBack
        ) {
          hint = 'release';
        } else if (
          previousVal !== null &&
          previousVal >= continueThreshold &&
          progressVal >= continueBufferBack
        ) {
          hint = 'continue';
        }

        const shouldAutoDelete = progressVal >= releaseThreshold;
        scheduleOnRN(updateSwipeDeleteState, hint, shouldAutoDelete);
      }
    );

    return (
      <Reanimated.View style={[styles.swipeActionsContainer, deleteButtonHideStyle]}>
        <View style={[styles.deleteButton, { backgroundColor: theme.colors.error || '#F44336' }]}>
          <TouchableOpacity
            style={styles.deleteButtonContent}
            onPress={() => {
              deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
                if (finished) {
                  scheduleOnRN(onDelete, item);
                }
              });
            }}
          >
            <Trash2 color={theme.colors.white} width={20} height={20} />
            <Text style={[styles.deleteButtonText, { color: theme.colors.white }]}>
              {swipeDeleteHint === 'release'
                ? '松手删除'
                : swipeDeleteHint === 'continue'
                  ? '继续滑动删除'
                  : '删除'}
            </Text>
          </TouchableOpacity>
        </View>
      </Reanimated.View>
    );
  }
);

interface HistoryListItemProps {
  item: ClipboardItem;
  onCopy: (item: ClipboardItem) => void;
  onShare: (item: ClipboardItem) => void;
  onSave?: (item: ClipboardItem) => void;
  onOpen?: (item: ClipboardItem) => void;
  onLongPress: (item: ClipboardItem) => void;
  onDelete?: (item: ClipboardItem) => void;
  onToggleStar?: (item: ClipboardItem) => void;
  onDownload?: (item: ClipboardItem) => void;
  onUpload?: (item: ClipboardItem) => void;
  showFullImage?: boolean;
  enableHistorySync?: boolean;
}

export const HistoryListItem = forwardRef<HistoryListItemHandle, HistoryListItemProps>(
  (
    {
      item,
      onCopy,
      onShare,
      onSave,
      onOpen,
      onLongPress,
      onDelete,
      onToggleStar,
      onDownload,
      onUpload,
      showFullImage = false,
      enableHistorySync = true,
    },
    ref
  ) => {
    const { theme } = useTheme();
    const { config } = useSettingsStore();
    const isDebugMode = config?.debugMode ?? false;
    const tasks = useTransferQueueStore((state) => state.tasks);
    const profileId = getProfileId(item.type, item.profileHash);
    const activeTask = tasks.find(
      (t) => t.profileId === profileId && (t.status === 'running' || t.status === 'pending')
    );
    const isTransferring = !!activeTask;
    const transferProgress = activeTask?.progress || 0;
    const isUploadTask = activeTask?.type === 'upload';
    const bytesTransferred = activeTask?.bytesTransferred || 0;
    const totalBytes = activeTask?.totalBytes;

    const handleCancelTransfer = () => {
      if (activeTask) {
        const queue = getHistoryTransferQueue();
        queue.cancelTask(activeTask.profileId, activeTask.type);
      }
    };

    const [imageDimensions, setImageDimensions] = useState<{
      width: number;
      height: number;
    } | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);
    const swipeableRef = useRef<React.ComponentRef<typeof Swipeable>>(null);
    const shouldAutoDeleteRef = useRef<boolean>(false);
    const [swipeDeleteHint, setSwipeDeleteHint] = useState<'default' | 'continue' | 'release'>(
      'default'
    );
    const isDeletingRef = useRef(false);
    const lastHintRef = useRef<'default' | 'continue' | 'release'>('default');
    const deleteAnimProgress = useSharedValue(0);

    // 当item改变时重置所有动画和状态（处理FlashList容器复用的情况）
    useEffect(() => {
      // 重置删除动画进度
      deleteAnimProgress.value = 0;
      // 重置删除标志
      isDeletingRef.current = false;
      shouldAutoDeleteRef.current = false;
      lastHintRef.current = 'default';
      setSwipeDeleteHint('default');
      // 重置图片尺寸（避免复用时使用旧尺寸）
      setImageDimensions(null);
      setContainerWidth(0);
      // 关闭Swipeable（如果打开）
      if (swipeableRef.current) {
        swipeableRef.current.close();
      }
    }, [item.profileHash, deleteAnimProgress]);

    // 暴露 imperative handle
    useImperativeHandle(
      ref,
      () => ({
        startDelete: () => {
          if (isDeletingRef.current) return;
          isDeletingRef.current = true;
          deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
            if (finished && onDelete) {
              scheduleOnRN(onDelete, item);
            }
          });
        },
      }),
      [item, onDelete]
    );

    // 处理自动删除的函数
    const handleAutoDelete = () => {
      if (onDelete && shouldAutoDeleteRef.current && !isDeletingRef.current) {
        isDeletingRef.current = true;
        // 触发滑出动画
        deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
          if (finished) {
            scheduleOnRN(onDelete, item);
          }
        });
      }
    };

    const getTypeIcon = (type: string): string => {
      switch (type) {
        case 'Text':
          return '📝';
        case 'Image':
          return '🖼️';
        case 'File':
          return '📄';
        case 'Group':
          return '📦';
        default:
          return '📋';
      }
    };

    const getTypeLabel = (type: string): string => {
      switch (type) {
        case 'Text':
          return '文本';
        case 'Image':
          return '图片';
        case 'File':
          return '文件';
        case 'Group':
          return '文件组';
        default:
          return '未知';
      }
    };

    const formatTime = (timestamp: number): string => {
      const now = Date.now();
      const diff = now - timestamp;

      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

      const date = new Date(timestamp);
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const getPreviewText = (): string => {
      if (item.type === 'Text') {
        return item.text || '';
      }
      if (item.type === 'Image') {
        // Image: isLocalFileReady 为 false 时显示 text，为 true 时不显示文本
        return item.text || '图片';
      }
      if (item.type === 'File') {
        // File: 无论 isLocalFileReady 为 true 还是 false 都显示 text
        return item.text || '文件';
      }
      if (item.type === 'Group') {
        return item.text || '文件组';
      }
      return '';
    };

    // 卡片滑出动画样式
    const cardDeleteAnimStyle = useAnimatedStyle(() => {
      const translateX = interpolate(
        deleteAnimProgress.value,
        [0, 1],
        [0, -500],
        Extrapolation.CLAMP
      );
      const opacity = interpolate(deleteAnimProgress.value, [0, 1], [1, 0], Extrapolation.CLAMP);
      return {
        transform: [{ translateX }],
        opacity,
        overflow: 'hidden',
      };
    });

    const previewText = getPreviewText();

    const updateSwipeDeleteState = useCallback(
      (hint: 'default' | 'continue' | 'release', shouldAutoDelete: boolean) => {
        // 只在状态真正变化时更新，避免频繁重渲染导致闪烁
        if (lastHintRef.current !== hint) {
          lastHintRef.current = hint;
          setSwipeDeleteHint(hint);
        }
        shouldAutoDeleteRef.current = shouldAutoDelete;
      },
      []
    );

    const renderRightActions = useCallback(
      (progress: SharedValue<number>) => {
        if (!onDelete) return null;
        return (
          <DeleteActionComponent
            progress={progress}
            onDelete={onDelete}
            swipeDeleteHint={swipeDeleteHint}
            theme={theme}
            item={item}
            deleteAnimProgress={deleteAnimProgress}
            updateSwipeDeleteState={updateSwipeDeleteState}
          />
        );
      },
      [onDelete, swipeDeleteHint, theme, item, deleteAnimProgress, updateSwipeDeleteState]
    );

    const handleSwipeableWillOpen = useCallback(() => {
      if (shouldAutoDeleteRef.current && onDelete) {
        handleAutoDelete();
      }
    }, [onDelete, handleAutoDelete]);

    const handleSwipeableOpen = useCallback(() => {
      if (shouldAutoDeleteRef.current && onDelete) {
        handleAutoDelete();
      }
    }, [onDelete, handleAutoDelete]);

    const handleSwipeableClose = useCallback(() => {
      shouldAutoDeleteRef.current = false;
      lastHintRef.current = 'default';
      setSwipeDeleteHint('default');
      isDeletingRef.current = false;
    }, []);

    return (
      <Reanimated.View style={[cardDeleteAnimStyle]} renderToHardwareTextureAndroid={true}>
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          friction={1.2}
          rightThreshold={50}
          overshootRight={true}
          dragOffsetFromRightEdge={30}
          onSwipeableWillOpen={handleSwipeableWillOpen}
          onSwipeableOpen={handleSwipeableOpen}
          onSwipeableClose={handleSwipeableClose}
          enabled={!isDeletingRef.current}
          childrenContainerStyle={styles.swipeableChildrenContainer}
          /*
        新的交互流程：
        1. 用户左滑，在80px时显示删除按钮
        2. 如果松手，界面保持在删除按钮状态
        3. 用户可以点击删除按钮删除
        4. 或用户继续左滑，距离超过150px或快速滑动会自动删除
      */
        >
          <TouchableHighlight
            onLongPress={() => onLongPress(item)}
            underlayColor={theme.colors.border}
            style={styles.touchable}
          >
            <View
              style={[
                styles.container,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
              ]}
            >
              {/* 顶部内容区 */}
              <View style={styles.topContent}>
                {/* 左侧图标 */}
                <View style={styles.iconContainer}>
                  <Text style={styles.typeIcon}>{getTypeIcon(item.type)}</Text>
                </View>

                {/* 类型标签和时间 */}
                <Text
                  style={[
                    styles.typeLabel,
                    styles.typeLabelSpacing,
                    { color: theme.colors.primary },
                  ]}
                >
                  {getTypeLabel(item.type)}
                </Text>

                {/* 时间戳 */}
                <Text
                  style={[
                    styles.timestamp,
                    styles.timestampAlign,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {formatTime(item.timestamp)}
                </Text>
              </View>

              {/* 预览文本 - 另起一行（文本类型始终显示，图片/文件类型在本地文件未就绪时显示） */}
              {(item.type === 'Text' ||
                item.type === 'File' ||
                (item.type === 'Image' && item.isLocalFileReady === false)) && (
                <Text
                  style={[styles.previewText, { color: theme.colors.text }]}
                  numberOfLines={10}
                  ellipsizeMode="tail"
                >
                  {previewText}
                </Text>
              )}

              {/* 图片预览 - 占据整个宽度（仅当有本地文件时显示） */}
              {item.type === 'Image' && item.fileUri && (
                <View
                  style={styles.imagePreviewContainer}
                  onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
                >
                  {showFullImage ? (
                    <Image
                      source={{ uri: item.fileUri }}
                      style={[
                        styles.imagePreview,
                        imageDimensions && containerWidth > 0
                          ? {
                              height:
                                (containerWidth / imageDimensions.width) * imageDimensions.height,
                            }
                          : styles.imagePreviewLimited,
                      ]}
                      resizeMode="cover"
                      onLoad={(e) => {
                        const { width, height } = e.nativeEvent.source;
                        setImageDimensions({ width, height });
                      }}
                    />
                  ) : (
                    <Image
                      source={{ uri: item.fileUri }}
                      style={[styles.imagePreview, styles.imagePreviewLimited]}
                      resizeMode="cover"
                    />
                  )}
                </View>
              )}

              {/* 底部信息区 */}
              <View style={styles.bottomContent}>
                <View style={styles.metaInfo}>
                  {item.size !== undefined && (
                    <Text style={[styles.metaText, { color: theme.colors.textTertiary }]}>
                      {formatSizeWithType(item.size, item.type)}
                    </Text>
                  )}
                  {/* 传输中状态 - 复用按钮显示取消 */}
                  {enableHistorySync && isTransferring && (
                    <TouchableOpacity style={styles.syncBadge} onPress={handleCancelTransfer}>
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={theme.colors.error || '#F44336'}
                      />
                      <Text
                        style={[styles.syncBadgeText, { color: theme.colors.error || '#F44336' }]}
                      >
                        {transferProgress > 0
                          ? `${Math.round(transferProgress)}%${totalBytes ? ` (${formatFileSize(bytesTransferred)}/${formatFileSize(totalBytes)})` : ''}`
                          : isUploadTask
                            ? '取消上传'
                            : '取消下载'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {/* 同步状态显示，仅当启用同步且不在传输中时显示 */}
                  {enableHistorySync && !isTransferring && item.syncStatus !== undefined && (
                    <TouchableOpacity style={styles.syncBadge} onPress={() => onUpload?.(item)}>
                      <Ionicons
                        name={
                          item.syncStatus === 1
                            ? 'cloud-done'
                            : item.syncStatus === 0
                              ? 'cloud-upload'
                              : 'cloud-download'
                        }
                        size={14}
                        color={
                          item.syncStatus === 1
                            ? theme.colors.success || '#4CAF50'
                            : theme.colors.textTertiary
                        }
                      />
                      <Text
                        style={[
                          styles.syncBadgeText,
                          {
                            color:
                              item.syncStatus === 1
                                ? theme.colors.success || '#4CAF50'
                                : theme.colors.textTertiary,
                          },
                        ]}
                      >
                        {item.syncStatus === 1
                          ? '已同步'
                          : item.syncStatus === 0
                            ? '仅本地'
                            : '待同步'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {/* 兼容旧的 synced 字段，仅当启用同步且不在传输中时显示 */}
                  {enableHistorySync &&
                    !isTransferring &&
                    item.syncStatus === undefined &&
                    item.synced !== undefined && (
                      <View style={styles.syncBadge}>
                        <Ionicons
                          name={item.synced ? 'cloud-done' : 'cloud-outline'}
                          size={14}
                          color={
                            item.synced
                              ? theme.colors.success || '#4CAF50'
                              : theme.colors.textTertiary
                          }
                        />
                        <Text
                          style={[
                            styles.syncBadgeText,
                            {
                              color: item.synced
                                ? theme.colors.success || '#4CAF50'
                                : theme.colors.textTertiary,
                            },
                          ]}
                        >
                          {item.synced ? '已同步' : '未同步'}
                        </Text>
                      </View>
                    )}
                  {/* 未下载标识 - 图片/文件类型但本地文件未就绪，仅当启用同步且不在传输中时显示 */}
                  {enableHistorySync &&
                    !isTransferring &&
                    (item.type === 'Image' || item.type === 'File') &&
                    item.isLocalFileReady === false && (
                      <TouchableOpacity
                        style={styles.syncBadge}
                        onPress={() => onDownload?.(item)}
                        disabled={!onDownload}
                      >
                        <Ionicons
                          name="cloud-download-outline"
                          size={14}
                          color={onDownload ? theme.colors.primary : theme.colors.textTertiary}
                        />
                        <Text
                          style={[
                            styles.syncBadgeText,
                            {
                              color: onDownload ? theme.colors.primary : theme.colors.textTertiary,
                            },
                          ]}
                        >
                          未下载
                        </Text>
                      </TouchableOpacity>
                    )}
                </View>
                <View style={styles.actionsRow}>
                  {/* 收藏按钮 */}
                  {onToggleStar && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => onToggleStar(item)}
                      hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                    >
                      <Ionicons
                        name={item.starred ? 'star' : 'star-outline'}
                        size={18}
                        color={theme.colors.primary}
                      />
                    </TouchableOpacity>
                  )}
                  {item.type === 'Text' && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => onCopy(item)}
                      hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                    >
                      <View style={{ transform: [{ scale: 0.6 }] }}>
                        <Copy color={theme.colors.primary} />
                      </View>
                    </TouchableOpacity>
                  )}
                  {item.type === 'Image' && (
                    <>
                      {item.fileUri && onOpen && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onOpen(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <ExternalLink color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                      {item.fileUri && onSave && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onSave(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <Download color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                      {item.isLocalFileReady !== false && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onShare(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <Share color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                  {(item.type === 'File' || item.type === 'Group') && (
                    <>
                      {item.fileUri && onOpen && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onOpen(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <ExternalLink color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                      {item.fileUri && onSave && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onSave(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <Download color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                      {item.isLocalFileReady !== false && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onShare(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <Share color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>

              {/* 调试信息：profileHash */}
              {isDebugMode && item.profileHash && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    Hash:
                  </Text>
                  <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
                    {item.profileHash.substring(0, 16)}...
                  </Text>
                </View>
              )}

              {/* 调试信息：fileUrl */}
              {isDebugMode && item.fileUri && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    URL:
                  </Text>
                  <Text
                    style={[
                      styles.debugValue,
                      styles.debugValueFlex,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {item.fileUri}
                  </Text>
                </View>
              )}

              {/* 调试信息：lastModified */}
              {isDebugMode && item.lastModified !== undefined && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    LastModified:
                  </Text>
                  <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
                    {new Date(item.lastModified).toISOString()}
                  </Text>
                </View>
              )}

              {/* 调试信息：lastAccessed */}
              {isDebugMode && item.lastAccessed !== undefined && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    LastAccessed:
                  </Text>
                  <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
                    {new Date(item.lastAccessed).toISOString()}
                  </Text>
                </View>
              )}

              {/* 调试信息：version */}
              {isDebugMode && item.version !== undefined && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    Version:
                  </Text>
                  <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
                    {item.version}
                  </Text>
                </View>
              )}
            </View>
          </TouchableHighlight>
        </Swipeable>
      </Reanimated.View>
    );
  }
);

HistoryListItem.displayName = 'HistoryListItem';

const styles = StyleSheet.create({
  touchable: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
  },
  container: {
    flexDirection: 'column',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  topContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  bottomContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    overflow: 'hidden',
  },
  typeIcon: {
    fontSize: 13,
  },
  imagePreviewContainer: {
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  imagePreview: {
    width: '100%',
  },
  imagePreviewLimited: {
    height: 180,
  },
  contentContainer: {
    flex: 1,
    marginLeft: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  typeLabelSpacing: {
    marginLeft: 8,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
  },
  timestampAlign: {
    flex: 1,
    textAlign: 'right',
  },
  previewText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
  },

  metaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
  },
  syncBadge: {
    marginLeft: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  progressContainer: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressOverlay: {
    position: 'absolute',
    bottom: -4,
  },
  progressText: {
    fontSize: 8,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 10,
    marginLeft: 4,
    flex: 1,
  },
  actionButtonIcon: {
    fontSize: 14,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  debugLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  debugValue: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  debugValueFlex: {
    flex: 1,
  },
  swipeActionsContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginVertical: 4,
    marginRight: 16,
  },
  swipeableChildrenContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  deleteButton: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  deleteButtonContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
