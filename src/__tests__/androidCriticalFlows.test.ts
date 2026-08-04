/**
 * Android 关键路径回归测试
 *
 * 覆盖三处刚修过、且回归后症状隐蔽的行为:
 * 1. HistoryStorage.initialize() —— 并发调用共享一次初始化;失败后门闩住,不再重放整条重型 IO 流水线
 * 2. historyRepository 批量写 —— 同一批内相同 profileHash 必须后写者胜(顺序执行,不能并发下发)
 */
import { HistoryStorage } from '../features/history/internal/historyStorage';
import { historyRepository } from '../features/history/internal/historyRepository';
import { createDefaultClipboardItem, type ClipboardItem } from '../types/clipboard';
import { useHistoryStore } from '../features/history/store';

// 只影响 historyStore 走的 `@/services` 桶文件;上面几个直接路径 import 仍是真实实现
jest.mock('../features/history/commands', () => ({
  historyStorage: {
    searchItems: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    setSortConfig: jest.fn(),
  },
}));

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

// 默认转发真实实现;个别用例用 mockResolvedValueOnce 注入假 db 来观测 statement 的执行时序
jest.mock('../platform/database', () => {
  const actual = jest.requireActual('../platform/database');
  return { ...actual, getDatabase: jest.fn(actual.getDatabase) };
});

const { configStorage } = jest.requireMock('../features/settings');
const { getDatabase } = jest.requireMock('../platform/database');
const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;

/** 重置单例,拿到一个尚未初始化的实例(afterEach 由 jest.setup 关库) */
function freshStorage(): HistoryStorage {
  (HistoryStorage as unknown as { instance: null }).instance = null;
  return HistoryStorage.getInstance();
}

function textItem(hash: string, text: string, ts: number): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Text',
    text,
    profileHash: hash,
    hasData: false,
    size: text.length,
    timestamp: ts,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  configStorage.getConfig.mockResolvedValue({ maxHistoryItems: 1000 });
  AsyncStorage.getItem.mockResolvedValue(null);
});

describe('HistoryStorage.initialize', () => {
  it('并发调用只跑一次初始化流水线', async () => {
    const storage = freshStorage();

    await Promise.all([storage.initialize(), storage.initialize(), storage.initialize()]);

    // getConfig 位于流水线首步:跑了几次初始化,它就被调了几次
    expect(configStorage.getConfig).toHaveBeenCalledTimes(1);
  });

  it('初始化成功后再调用直接返回,不重跑流水线', async () => {
    const storage = freshStorage();

    await storage.initialize();
    await storage.initialize();

    expect(configStorage.getConfig).toHaveBeenCalledTimes(1);
  });

  it('建库失败是致命的:向调用方抛出,不再假装已就绪', async () => {
    const storage = freshStorage();
    getDatabase.mockRejectedValueOnce(new Error('db is toast'));

    await expect(storage.initialize()).rejects.toThrow('db is toast');
  });

  it('建库失败后门闩住:后续调用快速抛出首个错误,不重放流水线', async () => {
    const storage = freshStorage();
    getDatabase.mockRejectedValueOnce(new Error('db is toast'));

    await expect(storage.initialize()).rejects.toThrow('db is toast');
    expect(configStorage.getConfig).toHaveBeenCalledTimes(1);

    // 门闩生效:同样的错误再抛一次,但配置读取 / 建库 / 数据搬运不会被重放
    await expect(storage.initialize()).rejects.toThrow('db is toast');
    expect(configStorage.getConfig).toHaveBeenCalledTimes(1);

    // 走 initialize() 守卫的普通读方法同样快速失败,而不是各自重跑一遍整条流水线
    await expect(storage.getAllItems()).rejects.toThrow('db is toast');
    expect(configStorage.getConfig).toHaveBeenCalledTimes(1);
  });

  it('一次性数据搬运失败不致命:DB 可用就带着已有历史继续跑', async () => {
    const storage = freshStorage();
    // 迁移路径上的 AsyncStorage 读失败(iOS App Group 读空是有先例的)
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('app group unreadable'));

    await expect(storage.initialize()).resolves.toBeUndefined();

    // 历史功能整体仍然可用,而不是被搬不动的遗留数据拖垮
    await expect(storage.getAllItems()).resolves.toEqual([]);
    await storage.addItem(textItem('AFTER_IMPORT_FAIL', 'still works', 1_800_000_000_000));
    expect((await historyRepository.getByProfileHash('AFTER_IMPORT_FAIL'))?.text).toBe(
      'still works'
    );
  });

  it('配置读取失败不致命:退回默认上限继续初始化', async () => {
    const storage = freshStorage();
    configStorage.getConfig.mockRejectedValueOnce(new Error('config gone'));

    await expect(storage.initialize()).resolves.toBeUndefined();
    await expect(storage.getAllItems()).resolves.toEqual([]);
  });
});

describe('historyRepository 批量写', () => {
  beforeEach(async () => {
    await freshStorage().initialize();
  });

  // 测试环境的 SQLite(better-sqlite3)是同步的,单看写入结果无法区分串行与并发下发——
  // 真实的竞态只在原生多线程上出现。所以这里直接观测在飞数量,而不是指望结果暴露顺序。
  function trackingStatement() {
    let inFlight = 0;
    const tracker = { maxInFlight: 0, order: [] as unknown[] };
    const stmt = {
      executeAsync: jest.fn(async (...args: unknown[]) => {
        inFlight += 1;
        tracker.maxInFlight = Math.max(tracker.maxInFlight, inFlight);
        await Promise.resolve(); // 异步边界:并发下发时三个调用会在此全部挂起并交错
        tracker.order.push(args[0]);
        inFlight -= 1;
      }),
      finalizeAsync: jest.fn(async () => {}),
    };
    getDatabase.mockResolvedValueOnce({
      withExclusiveTransactionAsync: (task: (txn: unknown) => Promise<void>) =>
        task({ prepareAsync: async () => stmt }),
    });
    return { stmt, tracker };
  }

  it('replaceMany 串行执行,不并发复用同一个 prepared statement', async () => {
    // prepared statement 的参数绑定是有状态的(原生侧 reset + bind + step 整段在互斥锁里),
    // 并发下发不会更快——锁会把它们排回队列——只会让批内同 profileHash 的胜出者变成竞态。
    const { stmt, tracker } = trackingStatement();

    await historyRepository.replaceMany([
      textItem('A', 'a', 1_800_000_000_000),
      textItem('B', 'b', 1_800_000_000_001),
      textItem('C', 'c', 1_800_000_000_002),
    ]);

    expect(stmt.executeAsync).toHaveBeenCalledTimes(3);
    expect(tracker.maxInFlight).toBe(1);
    expect(stmt.finalizeAsync).toHaveBeenCalledTimes(1);
  });

  it('removeMany 串行执行,不并发复用同一个 prepared statement', async () => {
    const { stmt, tracker } = trackingStatement();

    await historyRepository.removeMany(['A', 'B', 'C']);

    expect(stmt.executeAsync).toHaveBeenCalledTimes(3);
    expect(tracker.maxInFlight).toBe(1);
    expect(tracker.order).toEqual(['A', 'B', 'C']);
  });

  it('replaceMany 在同一批内遇到相同 profileHash 时后写者胜', async () => {
    // 记录 INSERT OR REPLACE 的 upsert 契约(换成 INSERT OR IGNORE 会在此变红)。
    // 注意:并发回归由上面的在飞观测把关,这条在同步 mock 下无法区分。
    await historyRepository.replaceMany([
      textItem('DUP_HASH', 'first', 1_800_000_000_000),
      textItem('DUP_HASH', 'second', 1_800_000_000_001),
      textItem('DUP_HASH', 'winner', 1_800_000_000_002),
    ]);

    const row = await historyRepository.getByProfileHash('DUP_HASH');
    expect(row?.text).toBe('winner');
    expect(await historyRepository.count(undefined, { includeDeleted: true })).toBe(1);
  });

  it('replaceMany 写入整批且不丢条目', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      textItem(`HASH_${i}`, `item ${i}`, 1_800_000_000_000 + i)
    );

    await historyRepository.replaceMany(items);

    expect(await historyRepository.count(undefined, { includeDeleted: true })).toBe(50);
    expect((await historyRepository.getByProfileHash('HASH_49'))?.text).toBe('item 49');
  });

  it('removeMany 删除整批', async () => {
    await historyRepository.replaceMany([
      textItem('KEEP', 'keep', 1_800_000_000_000),
      textItem('DROP_A', 'a', 1_800_000_000_001),
      textItem('DROP_B', 'b', 1_800_000_000_002),
    ]);

    await historyRepository.removeMany(['DROP_A', 'DROP_B']);

    expect(await historyRepository.getByProfileHash('DROP_A')).toBeNull();
    expect(await historyRepository.getByProfileHash('DROP_B')).toBeNull();
    expect((await historyRepository.getByProfileHash('KEEP'))?.text).toBe('keep');
  });
});

describe('搜索防抖所依赖的前提', () => {
  it('searchItems(undefined) 把 store.filter 落回 falsy', async () => {
    // useHomeController 的防抖 effect 靠 `!hasFilter && !getState().filter` 判断
    // 「想要全量、且已经是全量」来跳过冗余查询。若这里改成写入 `{}` 之类的 truthy 空值,
    // 清空关键词后的恢复查询会被静默跳过,列表将停在过滤态。
    await useHistoryStore.getState().searchItems({ keyword: 'x' });
    expect(useHistoryStore.getState().filter).toBeTruthy();

    await useHistoryStore.getState().searchItems(undefined);
    expect(useHistoryStore.getState().filter).toBeFalsy();
  });

  it('store.filter 初值为 falsy,首次进入搜索态无需重查', () => {
    useHistoryStore.setState({ filter: null });
    expect(useHistoryStore.getState().filter).toBeFalsy();
  });
});
