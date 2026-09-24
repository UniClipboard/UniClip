import type { ClipboardItem } from '@/types/clipboard';
import {
  buildHistoryListRows,
  formatHistoryDayLabel,
  formatHistoryRowTime,
} from '@/utils/historyDayGroups';
import { startOfDay } from '@/utils/historyFilters';

const NOW = new Date(2026, 8, 24, 15, 30).getTime();
const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0).getTime();
const item = (profileHash: string, timestamp: number) =>
  ({ profileHash, timestamp } as ClipboardItem);
const key = (i: ClipboardItem) => i.profileHash;

describe('history day groups', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('groups adjacent items by local calendar day without reordering them', () => {
    const rows = buildHistoryListRows(
      [
        item('a', at(24, 14)),
        item('b', at(24, 9)),
        item('c', at(24, 0)),
        item('d', at(23, 23)),
        item('e', at(20, 8)),
        item('f', at(20, 7)),
      ],
      key
    );

    expect(rows.map((r) => (r.type === 'header' ? `#${r.dayStart}` : r.key))).toEqual([
      `#${startOfDay(at(24, 0))}`,
      'a',
      'b',
      'c',
      `#${startOfDay(at(23, 0))}`,
      'd',
      `#${startOfDay(at(20, 0))}`,
      'e',
      'f',
    ]);
    expect(rows.flatMap((r) => (r.type === 'item' ? [r.position] : []))).toEqual([
      'first',
      'middle',
      'last',
      'single',
      'first',
      'last',
    ]);
  });

  it('keeps row keys unique when dirty data repeats a profile hash', () => {
    const rows = buildHistoryListRows([item('a', at(24, 9)), item('a', at(24, 8))], key);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses the same today / yesterday wording as the search date filter', () => {
    expect(formatHistoryDayLabel(startOfDay(NOW), NOW)).toBe('今天');
    expect(formatHistoryDayLabel(startOfDay(at(23, 12)), NOW)).toBe('昨天');
    expect(formatHistoryDayLabel(startOfDay(at(20, 12)), NOW)).toMatch(/9月20日/);
    expect(formatHistoryDayLabel(startOfDay(new Date(2025, 11, 31).getTime()), NOW)).toMatch(
      /2025/
    );
  });

  it('shows relative time for today and clock time for earlier days', () => {
    expect(formatHistoryRowTime(NOW - 2000, NOW)).toBe('刚刚');
    expect(formatHistoryRowTime(at(23, 18) + 20 * 60000, NOW)).toBe('18:20');
  });
});
