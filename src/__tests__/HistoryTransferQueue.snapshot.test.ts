const mockGetItem = jest.fn().mockResolvedValue(null);

jest.mock('../services/HistoryStorage', () => ({
  HistoryStorage: {
    getInstance: () => ({ getItem: mockGetItem }),
  },
}));

import { HistoryTransferQueue, type TransferTask } from '../services/HistoryTransferQueue';

describe('HistoryTransferQueue task snapshots', () => {
  beforeEach(() => {
    mockGetItem.mockResolvedValue(null);
  });

  it('publishes detached task snapshots without its cancellation handle', async () => {
    const queue = new HistoryTransferQueue();
    const observed: TransferTask[] = [];
    queue.onTaskStatusChanged((task) => observed.push(task));

    const returned = await queue.addDownloadTask('unparseable-profile');

    expect(returned).not.toHaveProperty('abortController');
    expect(observed).toHaveLength(1);
    expect(observed[0]).not.toHaveProperty('abortController');
    expect(observed[0]).not.toBe(returned);
  });

  it('reports pending work through one queue snapshot', async () => {
    const queue = new HistoryTransferQueue();
    const task = await queue.addUploadTask('unparseable-profile');

    expect(queue).toHaveProperty('getSnapshot');
    expect(queue.getSnapshot()).toEqual({
      tasks: [task],
      pendingCount: 1,
      activeCount: 0,
      hasTasks: true,
    });
  });
});
