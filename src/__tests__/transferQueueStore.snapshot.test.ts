const task = {
  profileId: 'Image:hash',
  displayName: 'photo.png',
  type: 'download' as const,
  status: 'pending' as const,
  progress: -1,
  bytesTransferred: 0,
  createdTime: 1,
  failureCount: 0,
  isImmediateTask: false,
};

const mockOnTaskStatusChanged = jest.fn();
const mockOffTaskStatusChanged = jest.fn();
const mockGetSnapshot = jest.fn();
const mockGetActiveTasks = jest.fn();

jest.mock('@/services/HistoryTransferQueue', () => ({
  getHistoryTransferQueue: () => ({
    onTaskStatusChanged: mockOnTaskStatusChanged,
    offTaskStatusChanged: mockOffTaskStatusChanged,
    getSnapshot: mockGetSnapshot,
    getActiveTasks: mockGetActiveTasks,
  }),
}));

jest.mock('@/stores/errorStore', () => ({
  useErrorStore: { getState: () => ({ showNetworkError: jest.fn() }) },
}));

jest.mock('@/stores/messageStore', () => ({
  useMessageStore: { getState: () => ({ showMessage: jest.fn() }) },
}));

import { useTransferQueueStore } from '../stores/transferQueueStore';

describe('transferQueueStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveTasks.mockReturnValue([]);
    mockGetSnapshot.mockReturnValue({
      tasks: [task],
      pendingCount: 1,
      activeCount: 0,
      hasTasks: true,
    });
    useTransferQueueStore.setState({
      tasks: [],
      pendingCount: 0,
      activeCount: 0,
      hasTasks: false,
    });
  });

  it('seeds its state from the queue snapshot', () => {
    const unsubscribe = useTransferQueueStore.getState().subscribe();

    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(useTransferQueueStore.getState()).toMatchObject({
      tasks: [task],
      pendingCount: 1,
      activeCount: 0,
      hasTasks: true,
    });

    unsubscribe();
  });
});
