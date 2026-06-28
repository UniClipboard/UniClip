import {
  createDefaultClipboardItem,
  HistorySyncStatus,
  type ClipboardItem,
} from '../types/clipboard';
import {
  createHistorySearchFilter,
  filterHistoryItems,
  type HistoryDateFilter,
} from '../utils/historyFilters';
import {
  getHistoryDateFilterLabel,
  HISTORY_FILTER_KIND_OPTIONS,
} from '../utils/historyFilterOptions';

function createItem(
  profileHash: string,
  timestamp: number,
  overrides?: Partial<ClipboardItem>
): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Text',
    text: `item-${profileHash}`,
    profileHash,
    hasData: false,
    timestamp,
    syncStatus: HistorySyncStatus.LocalOnly,
    ...overrides,
  });
}

function hashes(items: ClipboardItem[]): string[] {
  return items.map((item) => item.profileHash);
}

describe('history advanced filters', () => {
  const now = new Date(2026, 5, 28, 15, 30).getTime();
  const today = new Date(2026, 5, 28, 9).getTime();
  const yesterday = new Date(2026, 5, 27, 20).getTime();
  const eightDaysAgo = new Date(2026, 5, 20, 12).getTime();

  it('filters URL display kind separately from plain text', () => {
    const items = [
      createItem('plain', today, { text: 'regular note' }),
      createItem('url', today, { text: 'https://uniclip.app/start' }),
      createItem('image', today, {
        type: 'Image',
        text: 'screenshot.png',
        dataName: 'screenshot.png',
      }),
    ];

    const urlFilter = createHistorySearchFilter({ displayKinds: ['url'], now });
    const textFilter = createHistorySearchFilter({ displayKinds: ['text'], now });

    expect(hashes(filterHistoryItems(items, urlFilter))).toEqual(['url']);
    expect(hashes(filterHistoryItems(items, textFilter))).toEqual(['plain']);
  });

  it.each([
    ['today', ['today']],
    ['yesterday', ['yesterday']],
    ['pastWeek', ['today', 'yesterday']],
  ] as Array<[HistoryDateFilter, string[]]>)(
    'filters by %s date preset',
    (dateFilter, expected) => {
      const items = [
        createItem('today', today),
        createItem('yesterday', yesterday),
        createItem('old', eightDaysAgo),
      ];

      const filter = createHistorySearchFilter({ dateFilter, now });

      expect(hashes(filterHistoryItems(items, filter))).toEqual(expected);
    }
  );

  it('combines keyword, display kind, and date filter', () => {
    const items = [
      createItem('matching-file', today, {
        type: 'File',
        text: 'quarterly.pdf',
        dataName: 'quarterly.pdf',
      }),
      createItem('wrong-kind', today, {
        type: 'Text',
        text: 'quarterly notes',
      }),
      createItem('wrong-date', eightDaysAgo, {
        type: 'File',
        text: 'quarterly-old.pdf',
        dataName: 'quarterly-old.pdf',
      }),
    ];

    const filter = createHistorySearchFilter({
      keyword: 'quarterly',
      displayKinds: ['file'],
      dateFilter: 'pastWeek',
      now,
    });

    expect(hashes(filterHistoryItems(items, filter))).toEqual(['matching-file']);
  });

  it('keeps shared filter option labels stable', () => {
    expect(HISTORY_FILTER_KIND_OPTIONS).toEqual(['text', 'url', 'image', 'file', 'group']);
    expect(getHistoryDateFilterLabel('all')).toBe('全部');
    expect(getHistoryDateFilterLabel('today')).toBe('今天');
    expect(getHistoryDateFilterLabel('yesterday')).toBe('昨天');
    expect(getHistoryDateFilterLabel('pastWeek')).toBe('7 天内');
  });
});
