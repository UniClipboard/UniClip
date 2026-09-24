/**
 * 来源筛选的 SQL 与 JS 语义必须等价(historyRepository.buildWhere ↔ matchesHistoryFilter):
 * 初始查询走 SQL,增量更新走 JS。
 */
import { HistoryStorage } from '../features/history/internal/historyStorage';
import { historyRepository } from '../features/history/internal/historyRepository';
import { createDefaultClipboardItem, type ClipboardItem } from '../types/clipboard';
import { filterHistoryItems } from '../utils/historyFilters';
import type { HistoryFilter } from '../types/storage';

jest.mock('../platform/files', () => ({
  getHistoryFileDir: jest.fn(() => ({ uri: 'file://history', exists: true, create: jest.fn() })),
  saveHistoryFile: jest.fn(async () => 'file://history/saved'),
  deleteHistoryFileDir: jest.fn(async () => {}),
  initFileStorage: jest.fn(async () => {}),
  HISTORY_BASE_DIR: { exists: false, list: jest.fn(() => []) },
}));

jest.mock('../features/settings', () => ({
  configStorage: { getConfig: jest.fn().mockResolvedValue({ maxHistoryItems: 1000 }) },
}));

jest.mock('../support/observability', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

function item(hash: string, from: string | undefined, ts: number): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Text',
    text: hash,
    profileHash: hash,
    hasData: false,
    timestamp: ts,
    from,
  });
}

describe('history source filter', () => {
  const items = [
    item('CAPTURED', 'local', 1_800_000_000_003),
    item('IMPORTED', undefined, 1_800_000_000_002),
    item('SYNCED', 'server', 1_800_000_000_001),
  ];

  beforeEach(async () => {
    (HistoryStorage as unknown as { instance: null }).instance = null;
    await HistoryStorage.getInstance().initialize();
    await historyRepository.replaceMany(items);
  });

  it.each<[HistoryFilter['source'], string[]]>([
    ['local', ['CAPTURED', 'IMPORTED']],
    ['remote', ['SYNCED']],
  ])('matches %s items the same way in SQL and in memory', async (source, expected) => {
    const filter: HistoryFilter = { source };
    const rows = await historyRepository.find(filter);
    const sqlHashes = rows.map((row) => row.profileHash).sort();
    const jsHashes = filterHistoryItems(items, filter)
      .map((row) => row.profileHash)
      .sort();

    expect(sqlHashes).toEqual([...expected].sort());
    expect(jsHashes).toEqual(sqlHashes);
    expect(await historyRepository.count(filter)).toBe(expected.length);
  });
});
