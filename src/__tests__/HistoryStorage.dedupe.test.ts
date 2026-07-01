/**
 * HistoryStorage 重复记录自愈测试
 * 真机曾出现 AsyncStorage 中持久化了相同 profileHash 的多条历史记录
 * (早期导入/同步路径写入),导致 HomeView 网格 React key 冲突、
 * 快速滚动时卡片乱飞/空洞。loadHistory 必须在加载时去重合并并回写。
 */

import { HistoryStorage } from '../services/HistoryStorage';
import { ClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { STORAGE_KEYS } from '../types/storage';

const asyncStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(asyncStore[key] ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    asyncStore[key] = value;
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    delete asyncStore[key];
    return Promise.resolve();
  }),
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((pathOrDir: unknown, name?: string) => ({
    exists: false,
    uri: name ? `file://test/${name}` : 'file://test',
    move: jest.fn(),
  })),
  Directory: jest.fn().mockImplementation(() => ({
    exists: true,
    create: jest.fn(),
    uri: 'file://test/history',
  })),
}));

jest.mock('../utils/fileStorage', () => ({
  getHistoryFileDir: jest.fn().mockReturnValue({
    uri: 'file://test/history',
    exists: true,
    create: jest.fn(),
  }),
}));

jest.mock('../services/ConfigStorage', () => ({
  configStorage: {
    getConfig: jest.fn().mockResolvedValue({ maxHistoryItems: 1000 }),
  },
}));

jest.mock('../services/Logger', () => ({
  log: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function createItem(
  profileHash: string,
  timestamp: number,
  overrides?: Partial<ClipboardItem>
): ClipboardItem {
  return {
    type: 'Text',
    text: `item-${profileHash}-${timestamp}`,
    profileHash,
    hasData: false,
    size: 0,
    timestamp,
    starred: false,
    syncStatus: HistorySyncStatus.LocalOnly,
    version: 0,
    lastModified: timestamp,
    lastAccessed: timestamp,
    isDeleted: false,
    pinned: false,
    isLocalFileReady: true,
    ...overrides,
  };
}

/** 将种子历史写入 mock AsyncStorage 并初始化全新 storage 实例 */
async function initWithStoredHistory(items: ClipboardItem[]): Promise<HistoryStorage> {
  for (const key of Object.keys(asyncStore)) delete asyncStore[key];
  asyncStore[STORAGE_KEYS.HISTORY] = JSON.stringify(items);
  asyncStore[STORAGE_KEYS.HISTORY_VERSION] = '1';
  asyncStore['@syncclipboard:history:appgroup-imported'] = '1';

  (HistoryStorage as unknown as { instance: null }).instance = null;
  const storage = HistoryStorage.getInstance();
  await storage.initialize();
  return storage;
}

describe('HistoryStorage 加载时去重自愈', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('持久化数据中的重复 profileHash 在加载后只保留一条', async () => {
    const storage = await initWithStoredHistory([
      createItem('AAA', 300),
      createItem('bbb', 200),
      createItem('AAA', 100),
    ]);

    const items = await storage.getAllItems();
    const hashes = items.map((i) => i.profileHash.toLowerCase());
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.sort()).toEqual(['aaa', 'bbb']);
  });

  it('保留 lastAccessed 最新的副本', async () => {
    const storage = await initWithStoredHistory([
      createItem('dup', 100, { lastAccessed: 100, text: 'old-copy' }),
      createItem('x', 250),
      createItem('dup', 300, { lastAccessed: 300, text: 'new-copy' }),
    ]);

    const items = await storage.getAllItems();
    const kept = items.find((i) => i.profileHash === 'dup')!;
    expect(kept.text).toBe('new-copy');
    expect(kept.lastAccessed).toBe(300);
  });

  it('合并副本的 starred/pinned/useCount', async () => {
    const storage = await initWithStoredHistory([
      createItem('dup', 300, { lastAccessed: 300, useCount: 1 }),
      createItem('dup', 100, { lastAccessed: 100, starred: true, pinned: true, useCount: 5 }),
    ]);

    const items = await storage.getAllItems();
    const kept = items.find((i) => i.profileHash === 'dup')!;
    expect(kept.starred).toBe(true);
    expect(kept.pinned).toBe(true);
    expect(kept.useCount).toBe(5);
  });

  it('大小写不同的相同 hash 视为重复', async () => {
    const storage = await initWithStoredHistory([
      createItem('AbCdEf', 300),
      createItem('abcdef', 100),
    ]);

    const items = await storage.getAllItems();
    expect(items).toHaveLength(1);
  });

  it('发现重复时回写清理后的历史', async () => {
    await initWithStoredHistory([createItem('dup', 300), createItem('dup', 100)]);

    const persisted = JSON.parse(asyncStore[STORAGE_KEYS.HISTORY]) as ClipboardItem[];
    expect(persisted.filter((i) => i.profileHash.toLowerCase() === 'dup')).toHaveLength(1);
  });

  it('无重复时不改写存储', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    await initWithStoredHistory([createItem('a', 300), createItem('b', 100)]);

    const historyWrites = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
      ([key]: [string]) => key === STORAGE_KEYS.HISTORY
    );
    expect(historyWrites).toHaveLength(0);
  });
});
