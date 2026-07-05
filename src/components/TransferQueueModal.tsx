import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { X, Upload, Download, AlertCircle, Clock, CheckCircle } from 'react-native-feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, alpha } from '@/theme';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { TransferTask, getHistoryTransferQueue } from '@/services/HistoryTransferQueue';
import { formatFileSize } from '@/utils';

interface TransferQueueModalProps {
  visible: boolean;
  onClose: () => void;
}

// 状态 → i18n 键(键在模块级安全,文案在渲染时经 t 求值以支持语言切换)
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: 'transferQueue.status.pending',
  running: 'transferQueue.status.running',
  completed: 'transferQueue.status.completed',
  failed: 'transferQueue.status.failed',
  cancelled: 'transferQueue.status.cancelled',
  waitForRetry: 'transferQueue.status.waitForRetry',
};

const statusColors: Record<string, string> = {
  pending: '#FFA726',
  running: '#2196F3',
  completed: '#4CAF50',
  failed: '#F44336',
  cancelled: '#9E9E9E',
  waitForRetry: '#FF9800',
};

export const TransferQueueModal: React.FC<TransferQueueModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation('history');
  const { theme } = useTheme();
  const { tasks, subscribe, pendingCount, activeCount } = useTransferQueueStore();

  useEffect(() => {
    if (visible) {
      return subscribe();
    }
  }, [visible, subscribe]);

  const handleCancelTask = (task: TransferTask) => {
    const queue = getHistoryTransferQueue();
    queue.cancelTask(task.profileId, task.type);
  };

  const renderTask = ({ item: task }: { item: TransferTask }) => {
    const displayText = task.displayName || task.profileId.slice(0, 8);
    const statusColor = statusColors[task.status] || theme.colors.textSecondary;

    return (
      <View style={[styles.taskItem, { backgroundColor: theme.colors.surfaceLow }]}>
        <View style={styles.taskHeader}>
          <View style={[styles.taskTypeIcon, { backgroundColor: theme.colors.accentContainer }]}>
            {task.type === 'upload' ? (
              <Upload width={16} height={16} color={theme.colors.onAccentContainer} />
            ) : (
              <Download width={16} height={16} color={theme.colors.onAccentContainer} />
            )}
          </View>
          <View style={styles.taskInfo}>
            <Text style={[styles.taskText, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {displayText}
            </Text>
            <View style={styles.taskStatusRow}>
              <View style={[styles.statusBadge, { backgroundColor: alpha(statusColor, 0.16) }]}>
                {task.status === 'running' && (
                  <ActivityIndicator size="small" color={statusColor} />
                )}
                {task.status === 'failed' && (
                  <AlertCircle width={12} height={12} color={statusColor} />
                )}
                {task.status === 'completed' && (
                  <CheckCircle width={12} height={12} color={statusColor} />
                )}
                {(task.status === 'pending' || task.status === 'waitForRetry') && (
                  <Clock width={12} height={12} color={statusColor} />
                )}
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {STATUS_LABEL_KEYS[task.status] ? t(STATUS_LABEL_KEYS[task.status]) : ''}
                </Text>
              </View>
              {task.status === 'running' && task.progress >= 0 && (
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {Math.round(task.progress)}%
                  {task.totalBytes
                    ? ` (${formatFileSize(task.bytesTransferred)}/${formatFileSize(task.totalBytes)})`
                    : ''}
                </Text>
              )}
              {task.status === 'running' && task.progress < 0 && (
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {formatFileSize(task.bytesTransferred)}
                </Text>
              )}
            </View>
          </View>
          {(task.status === 'pending' ||
            task.status === 'running' ||
            task.status === 'waitForRetry') && (
            <TouchableOpacity
              style={[styles.cancelButton, { backgroundColor: theme.colors.errorContainer }]}
              onPress={() => handleCancelTask(task)}
            >
              <X width={14} height={14} color={theme.colors.onErrorContainer} />
            </TouchableOpacity>
          )}
        </View>
        {task.status === 'running' && task.progress >= 0 && (
          <View style={[styles.progressBar, { backgroundColor: theme.colors.separator }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: theme.colors.accent, width: `${task.progress}%` },
              ]}
            />
          </View>
        )}
        {task.status === 'running' && task.progress < 0 && (
          <View style={[styles.progressBar, { backgroundColor: theme.colors.separator }]}>
            <View
              style={[styles.progressFillIndeterminate, { backgroundColor: theme.colors.accent }]}
            />
          </View>
        )}
        {task.errorMessage && (
          <Text style={[styles.errorText, { color: theme.colors.error || '#F44336' }]}>
            {task.errorMessage}
          </Text>
        )}
      </View>
    );
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      running: 0,
      pending: 1,
      waitForRetry: 2,
      failed: 3,
      completed: 4,
      cancelled: 5,
    };
    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.overlay, { backgroundColor: theme.colors.backdrop }]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.modalContainer, { backgroundColor: theme.colors.surfaceHigh }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* M3 sheet drag handle */}
          <View style={styles.dragHandleWrap}>
            <View style={[styles.dragHandle, { backgroundColor: theme.colors.separator }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
              {t('transferQueue.title')}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X width={24} height={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: theme.colors.accent }]}>{activeCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                {t('transferQueue.status.running')}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: theme.colors.textPrimary }]}>
                {pendingCount}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>
                {t('transferQueue.status.pending')}
              </Text>
            </View>
          </View>

          {tasks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                {t('transferQueue.empty')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={sortedTasks}
              renderItem={renderTask}
              keyExtractor={(item) => `${item.type}-${item.profileId}`}
              contentContainerStyle={styles.listContent}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    maxHeight: '70%',
    minHeight: '40%',
  },
  dragHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.base,
  },
  title: {
    fontSize: typography.title3.fontSize,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    gap: spacing.xxxl,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: typography.title1.fontSize,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: typography.caption1.fontSize,
    marginTop: spacing.xs,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  taskItem: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskTypeIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  taskInfo: {
    flex: 1,
  },
  taskText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  taskStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  statusText: {
    fontSize: typography.caption2.fontSize,
    fontWeight: '500',
  },
  progressText: {
    fontSize: typography.caption2.fontSize,
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressFillIndeterminate: {
    height: '100%',
    borderRadius: 2,
    width: '30%',
  },
  errorText: {
    fontSize: 11,
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
  },
});
