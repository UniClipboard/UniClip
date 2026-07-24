import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createDefaultClipboardItem } from '../types/clipboard';
import { fromRow, toRow } from '../services/db/rowMapper';
import { getClipboardCardActionDescriptors } from '../utils/actionMenuItems';
import { persistP2pDeliveryReport } from '../services/P2pDeliveryState';
import { historyRepository } from '../services/db/historyRepository';
import { historyStorage } from '../services/HistoryStorage';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../services/db/historyRepository', () => ({
  historyRepository: {
    getByProfileHash: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('../services/HistoryStorage', () => ({
  historyStorage: {
    updateItem: jest.fn(),
  },
}));

const mockedRepository = historyRepository as jest.Mocked<typeof historyRepository>;
const mockedHistoryStorage = historyStorage as jest.Mocked<typeof historyStorage>;

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
    });

    expect(fromRow(toRow(item))).toMatchObject({
      p2pEntryId: 'entry-1',
      p2pDeliveryState: 'offline',
    });
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
    mockedRepository.getByProfileHash.mockResolvedValue(
      createDefaultClipboardItem({
        type: 'File',
        text: 'retry.txt',
        profileHash: 'RETRY_HASH',
        hasData: true,
        timestamp: 1,
      })
    );

    await persistP2pDeliveryReport('RETRY_HASH', {
      entryId: 'entry-2',
      totalAccepted: 1,
      totalDuplicate: 0,
      totalOffline: 0,
      totalErrored: 0,
      totalPending: 0,
    });

    expect(mockedHistoryStorage.updateItem).toHaveBeenCalledWith(
      'RETRY_HASH',
      expect.objectContaining({
        p2pEntryId: 'entry-2',
        p2pDeliveryState: 'delivered',
      })
    );
  });
});
