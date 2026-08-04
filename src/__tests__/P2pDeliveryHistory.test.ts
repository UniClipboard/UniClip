import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createDefaultClipboardItem } from '../types/clipboard';
import { fromRow, toRow } from '../features/history/internal/rowMapper';
import { getClipboardCardActionDescriptors } from '../utils/actionMenuItems';
import { persistP2pDeliveryReport } from '../features/transfer';
import { updateHistoryItem } from '../features/history';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../features/history', () => ({
  updateHistoryItem: jest.fn(async () => true),
}));

const mockedUpdateHistoryItem = updateHistoryItem as jest.MockedFunction<typeof updateHistoryItem>;

describe('P2P delivery history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists the core entry id and delivery state with a history item', () => {
    const item = createDefaultClipboardItem({
      type: 'File',
      text: 'offline.txt',
      profileHash: 'OFFLINE_FILE_HASH',
      hasData: true,
      timestamp: 1,
      p2pEntryId: 'entry-1',
      p2pDeliveryState: 'offline',
      p2pDeliveryCounts: {
        accepted: 0,
        duplicate: 0,
        offline: 1,
        errored: 0,
        pending: 0,
      },
    });

    expect(fromRow(toRow(item))).toMatchObject({
      p2pEntryId: 'entry-1',
      p2pDeliveryState: 'offline',
      p2pDeliveryCounts: {
        accepted: 0,
        duplicate: 0,
        offline: 1,
        errored: 0,
        pending: 0,
      },
    });
  });

  it('persists mixed delivery counts as a partial result', async () => {
    await persistP2pDeliveryReport('MIXED_HASH', {
      entryId: 'entry-mixed',
      totalAccepted: 1,
      totalDuplicate: 2,
      totalOffline: 3,
      totalErrored: 4,
      totalPending: 5,
    });

    expect(mockedUpdateHistoryItem).toHaveBeenCalledWith(
      'MIXED_HASH',
      expect.objectContaining({
        p2pDeliveryState: 'partial',
        p2pDeliveryCounts: {
          accepted: 1,
          duplicate: 2,
          offline: 3,
          errored: 4,
          pending: 5,
        },
      })
    );
  });

  it('offers resend only for locally sent P2P items that are not delivered', () => {
    const base = createDefaultClipboardItem({
      type: 'Text',
      text: 'retry me',
      profileHash: 'RETRY_HASH',
      hasData: false,
      timestamp: 1,
      p2pEntryId: 'entry-1',
      p2pDeliveryState: 'offline',
    });

    expect(getClipboardCardActionDescriptors(base, 'text').map((item) => item.key)).toContain(
      'resend'
    );
    expect(
      getClipboardCardActionDescriptors({ ...base, p2pDeliveryState: 'delivered' }, 'text').map(
        (item) => item.key
      )
    ).not.toContain('resend');
  });

  it('publishes delivery changes through history storage so mounted cards refresh', async () => {
    await persistP2pDeliveryReport('RETRY_HASH', {
      entryId: 'entry-2',
      totalAccepted: 1,
      totalDuplicate: 0,
      totalOffline: 0,
      totalErrored: 0,
      totalPending: 0,
    });

    expect(mockedUpdateHistoryItem).toHaveBeenCalledWith(
      'RETRY_HASH',
      expect.objectContaining({
        p2pEntryId: 'entry-2',
        p2pDeliveryState: 'delivered',
      })
    );
  });
});
