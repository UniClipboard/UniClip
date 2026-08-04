/**
 * historyStore handleStorageChange 排序测试
 * 验证 update 事件到达 store 后，items 列表重排
 */

import { useHistoryStore } from '../features/history';
import { ClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { historyStorage } from '../features/history/commands';

// Mock historyStorage，避免真实 AsyncStorage 依赖
jest.mock('../features/history/commands', () => ({
  historyStorage: {
    searchItems: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    addItem: jest.fn(),
    addItems: jest.fn(),
    updateItem: jest.fn(),
    softDeleteItem: jest.fn(),
    softDeleteItems: jest.fn(),
    toggleStar: jest.fn(),
    togglePin: jest.fn(),
    incrementUseCount: jest.fn(),
    clear: jest.fn(),
    setSortConfig: jest.fn(),
  },
}));

function createItem(
  profileHash: string,
  timestamp: number,
  overrides?: Partial<ClipboardItem>
): ClipboardItem {
  return {
    type: 'Text',
    text: `item-${profileHash}`,
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

function hashes(items: ClipboardItem[]): string[] {
  return items.map((i) => i.profileHash);
}

describe('historyStore handleStorageChange 排序', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useHistoryStore.getState().reset();
  });

  it('update 事件中 lastAccessed 变化时，删除+按序插入使记录移到正确位置', () => {
    const { handleStorageChange, setSort } = useHistoryStore.getState();

    // 设置排序为 lastAccessed desc
    setSort({ field: 'lastAccessed', order: 'desc' });

    // 直接设置初始 items（模拟已加载状态）
    useHistoryStore.setState({
      items: [
        createItem('a', 100, { lastAccessed: 300 }),
        createItem('b', 200, { lastAccessed: 200 }),
        createItem('c', 300, { lastAccessed: 100 }),
      ],
      totalCount: 3,
    });

    // 模拟 c 的 lastAccessed 更新为 999（复制操作）
    handleStorageChange([createItem('c', 300, { lastAccessed: 999 })], 'update');

    const items = useHistoryStore.getState().items;
    // c 应该移到首位
    expect(hashes(items)).toEqual(['c', 'a', 'b']);
  });

  it('update 事件中 pinned 变化时，删除+按序插入使记录移到 pinned 区域', () => {
    const { handleStorageChange, setSort } = useHistoryStore.getState();

    setSort({ field: 'timestamp', order: 'desc' });

    useHistoryStore.setState({
      items: [createItem('c', 300), createItem('b', 200), createItem('a', 100)],
      totalCount: 3,
    });

    // a 被置顶
    handleStorageChange([createItem('a', 100, { pinned: true })], 'update');

    const items = useHistoryStore.getState().items;
    // pinned 的 a 在最前，其余按 timestamp desc
    expect(hashes(items)).toEqual(['a', 'c', 'b']);
  });

  it('update 事件中排序字段没变时不重排', () => {
    const { handleStorageChange, setSort } = useHistoryStore.getState();

    setSort({ field: 'timestamp', order: 'desc' });

    useHistoryStore.setState({
      items: [createItem('c', 300), createItem('b', 200), createItem('a', 100)],
      totalCount: 3,
    });

    // 只更新 text，不影响排序字段
    handleStorageChange([{ ...createItem('a', 100), text: 'updated text' }], 'update');

    const items = useHistoryStore.getState().items;
    // 顺序不变
    expect(hashes(items)).toEqual(['c', 'b', 'a']);
    // 但内容已更新
    expect(items[2].text).toBe('updated text');
  });

  it('searchItems 不传 sort 时不覆盖已有的 sort 配置', async () => {
    const { setSort, searchItems } = useHistoryStore.getState();

    // 先设置排序为 lastAccessed desc（模拟 loadSortSetting 完成）
    setSort({ field: 'lastAccessed', order: 'desc' });

    // searchItems 只传 filter，不传 sort（模拟防抖 useEffect 搜索）
    await searchItems({ keyword: 'test' });

    // sort 不应该被覆盖
    const sort = useHistoryStore.getState().sort;
    expect(sort).toEqual({ field: 'lastAccessed', order: 'desc' });
  });

  it('首屏只读取 20 条，继续滚动时从下一条接着读取', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      createItem(`first-${index}`, 1_000 - index)
    );
    const secondPage = [createItem('next-1', 900), createItem('next-2', 899)];
    const searchItemsMock = historyStorage.searchItems as jest.MockedFunction<
      typeof historyStorage.searchItems
    >;
    searchItemsMock
      .mockResolvedValueOnce({ items: firstPage, total: 52 })
      .mockResolvedValueOnce({ items: secondPage, total: 52 });

    await useHistoryStore.getState().loadItems();

    expect(searchItemsMock).toHaveBeenNthCalledWith(
      1,
      undefined,
      { field: 'timestamp', order: 'desc' },
      { limit: 20, offset: 0 }
    );
    expect(useHistoryStore.getState().items).toHaveLength(20);

    await useHistoryStore.getState().loadMoreItems();

    expect(searchItemsMock).toHaveBeenNthCalledWith(
      2,
      undefined,
      { field: 'timestamp', order: 'desc' },
      { limit: 20, offset: 20 }
    );
    expect(hashes(useHistoryStore.getState().items)).toEqual([
      ...hashes(firstPage),
      'next-1',
      'next-2',
    ]);
  });

  it('图片本地文件就绪后立即进入列表，不等待长期保存完成', async () => {
    let finishPersistence!: (item: ClipboardItem) => void;
    const persistence = new Promise<ClipboardItem>((resolve) => {
      finishPersistence = resolve;
    });
    const addItemMock = historyStorage.addItem as jest.MockedFunction<
      typeof historyStorage.addItem
    >;
    addItemMock.mockReturnValueOnce(persistence);
    const image = createItem('image-fast', 500, {
      type: 'Image',
      text: '',
      hasData: true,
      dataName: 'clipboard.png',
      fileUri: 'file://cache/clipboard.png',
    });

    const saving = useHistoryStore.getState().addItem(image);

    expect(hashes(useHistoryStore.getState().items)).toEqual(['image-fast']);
    expect(useHistoryStore.getState().items[0].fileUri).toBe('file://cache/clipboard.png');

    finishPersistence({ ...image, fileUri: 'file://history/image-fast/clipboard.png' });
    await saving;

    expect(useHistoryStore.getState().items[0].fileUri).toBe(
      'file://history/image-fast/clipboard.png'
    );
  });

  it('长期保存失败时撤回尚未落稳的图片卡片', async () => {
    const addItemMock = historyStorage.addItem as jest.MockedFunction<
      typeof historyStorage.addItem
    >;
    addItemMock.mockRejectedValueOnce(new Error('disk full'));
    const image = createItem('image-failed', 500, {
      type: 'Image',
      text: '',
      hasData: true,
      dataName: 'clipboard.png',
      fileUri: 'file://cache/clipboard.png',
    });

    await useHistoryStore.getState().addItem(image);

    expect(useHistoryStore.getState().items).toEqual([]);
    expect(useHistoryStore.getState().error).toBe('disk full');
  });

  it('更新已有记录但长期保存失败时恢复原内容', async () => {
    const original = createItem('same-image', 400, {
      type: 'Image',
      text: '',
      hasData: true,
      dataName: 'original.png',
      fileUri: 'file://history/same-image/original.png',
    });
    useHistoryStore.setState({ items: [original], totalCount: 1 });
    const addItemMock = historyStorage.addItem as jest.MockedFunction<
      typeof historyStorage.addItem
    >;
    addItemMock.mockRejectedValueOnce(new Error('disk full'));
    const replacement = {
      ...original,
      timestamp: 500,
      dataName: 'replacement.png',
      fileUri: 'file://cache/replacement.png',
    };

    await useHistoryStore.getState().addItem(replacement);

    expect(useHistoryStore.getState().items).toEqual([original]);
    expect(useHistoryStore.getState().totalCount).toBe(1);
    expect(useHistoryStore.getState().error).toBe('disk full');
  });

  it('searchItems 不传 sort 时，handleStorageChange update 仍按正确 sort 重排', async () => {
    const { setSort, searchItems, handleStorageChange } = useHistoryStore.getState();

    // 设置排序为 lastAccessed desc
    setSort({ field: 'lastAccessed', order: 'desc' });

    // searchItems 只传 filter 不传 sort（模拟初始加载）
    await searchItems(undefined);

    // 手动设置 items（模拟数据已加载）
    useHistoryStore.setState({
      items: [
        createItem('a', 100, { lastAccessed: 300 }),
        createItem('b', 200, { lastAccessed: 200 }),
        createItem('c', 300, { lastAccessed: 100 }),
      ],
      totalCount: 3,
    });

    // update c 的 lastAccessed
    handleStorageChange([createItem('c', 300, { lastAccessed: 999 })], 'update');

    const items = useHistoryStore.getState().items;
    // sort 应该还是 lastAccessed desc，c 移到首位
    expect(hashes(items)).toEqual(['c', 'a', 'b']);
  });

  it('update 事件中记录不再匹配当前筛选时从列表移除', () => {
    const { handleStorageChange } = useHistoryStore.getState();

    useHistoryStore.setState({
      items: [createItem('url', 200, { text: 'https://uniclip.app' })],
      totalCount: 1,
      filter: { displayKinds: ['url'] },
    });

    handleStorageChange([createItem('url', 200, { text: 'plain text' })], 'update');

    expect(useHistoryStore.getState().items).toEqual([]);
    expect(useHistoryStore.getState().totalCount).toBe(0);
  });

  it('快速切换筛选时忽略较晚返回的旧结果', async () => {
    let resolveImageSearch!: (result: { items: ClipboardItem[]; total: number }) => void;
    const imageSearch = new Promise<{ items: ClipboardItem[]; total: number }>((resolve) => {
      resolveImageSearch = resolve;
    });
    const imageItem = createItem('image', 200, { type: 'Image', text: 'photo.png' });
    const textItem = createItem('text', 300, { type: 'Text', text: 'latest note' });
    const searchItemsMock = historyStorage.searchItems as jest.MockedFunction<
      typeof historyStorage.searchItems
    >;
    searchItemsMock
      .mockImplementationOnce(() => imageSearch)
      .mockResolvedValueOnce({ items: [textItem], total: 1 });

    const oldRequest = useHistoryStore.getState().searchItems({ displayKinds: ['image'] });
    await useHistoryStore.getState().searchItems({ displayKinds: ['text'] });
    expect(hashes(useHistoryStore.getState().items)).toEqual(['text']);

    resolveImageSearch({ items: [imageItem], total: 1 });
    await oldRequest;

    expect(hashes(useHistoryStore.getState().items)).toEqual(['text']);
    expect(useHistoryStore.getState().filter).toEqual({ displayKinds: ['text'] });
  });
});
