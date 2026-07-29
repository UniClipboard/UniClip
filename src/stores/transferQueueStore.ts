import { create } from 'zustand';
import {
  TransferTask,
  TransferType,
  TransferTaskStatus,
  getHistoryTransferQueue,
} from '@/services/HistoryTransferQueue';
import { useErrorStore } from './errorStore';
import { useMessageStore } from './messageStore';
import i18n from '@/i18n';

interface TransferQueueState {
  tasks: TransferTask[];
  pendingCount: number;
  activeCount: number;
  hasTasks: boolean;

  subscribe: () => () => void;
  getTasks: () => TransferTask[];
  getPendingTasks: () => TransferTask[];
  getActiveTasks: () => TransferTask[];
  getTasksByStatus: (status: TransferTaskStatus) => TransferTask[];
  getTasksByType: (type: TransferType) => TransferTask[];
}

export const useTransferQueueStore = create<TransferQueueState>((set, get) => ({
  tasks: [],
  pendingCount: 0,
  activeCount: 0,
  hasTasks: false,

  subscribe: () => {
    const queue = getHistoryTransferQueue();

    const syncSnapshot = () => {
      set(queue.getSnapshot());
    };

    const handleTaskStatusChanged = (task: TransferTask) => {
      syncSnapshot();

      if (task.status === 'failed' && task.errorMessage && !task.userCancelled) {
        const operationName =
          task.type === 'download'
            ? i18n.t('sync:operation.download')
            : i18n.t('sync:operation.upload');
        useErrorStore.getState().showNetworkError(operationName, task.errorMessage);
        useMessageStore.getState().showMessage(
          i18n.t('sync:transfer.failedWithDetail', {
            operation: operationName,
            detail: task.errorMessage,
          }),
          'error'
        );
      }
    };

    queue.onTaskStatusChanged(handleTaskStatusChanged);
    syncSnapshot();

    return () => {
      queue.offTaskStatusChanged(handleTaskStatusChanged);
    };
  },

  getTasks: () => get().tasks,

  getPendingTasks: () =>
    get().tasks.filter((t) => t.status === 'pending' || t.status === 'waitForRetry'),

  getActiveTasks: () => get().tasks.filter((t) => t.status === 'running'),

  getTasksByStatus: (status: TransferTaskStatus) => get().tasks.filter((t) => t.status === status),

  getTasksByType: (type: TransferType) => get().tasks.filter((t) => t.type === type),
}));
