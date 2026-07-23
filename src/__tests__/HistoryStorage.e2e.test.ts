/**
 * HistoryStorage 端到端存储测试(真实 SQLite,经 better-sqlite3 mock 驱动)
 *
 * 验证「复制」与「分享」两条入口下,文本 / 链接 / 图片 / 文件各类型内容
 * 正确写入 SQLite,并可正确检索(displayKind 过滤)、去重、软/硬删除、统计、关键词搜索。
 *
 * Phase 0 迁移后,复制(ClipboardMonitor→clipboardStore)与分享(uploadFile)
 * 最终都走 historyStorage.addItem → SQLite,故在存储层统一验证全类型。
 */
import { ClipboardItem, createDefaultClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { HistoryStorage } from '../services/HistoryStorage';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

jest.mock('../utils/fileStorage', () => ({
  getHistoryFileDir: jest.fn(() => ({ uri: 'file://history', exists: true, create: jest.fn() })),
  saveHistoryFile: jest.fn(async () => 'file://history/saved'),
  deleteHistoryFileDir: jest.fn(async () => {}),
  initFileStorage: jest.fn(async () => {}),
  HISTORY_BASE_DIR: { exists: false, list: jest.fn(() => []) },
}));

jest.mock('../services/ConfigStorage', () => ({
  configStorage: { getConfig: jest.fn().mockResolvedValue({ maxHistoryItems: 1000 }) },
}));

jest.mock('../services/Logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/** 重置单例 + 打开全新 :memory: DB(afterEach 由 jest.setup 关库) */
async function freshStorage(): Promise<HistoryStorage> {
  (HistoryStorage as unknown as { instance: null }).instance = null;
  const storage = HistoryStorage.getInstance();
  await storage.initialize();
  return storage;
}

const T0 = 1_800_000_000_000;

function textItem(text: string, hash: string, ts = T0): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Text',
    text,
    profileHash: hash,
    hasData: false,
    size: text.length,
    timestamp: ts,
    localClipboardHash: hash,
  });
}

function imageItem(hash: string, ts = T0): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'Image',
    text: '',
    profileHash: hash,
    hasData: true,
    dataName: `${hash}.png`,
    size: 2048,
    timestamp: ts,
    fileUri: `file://history/${hash}.png`,
    localClipboardHash: hash,
  });
}

function fileItem(hash: string, name: string, ts = T0): ClipboardItem {
  return createDefaultClipboardItem({
    type: 'File',
    text: name,
    profileHash: hash,
    hasData: true,
    dataName: name,
    size: 4096,
    timestamp: ts,
    fileUri: `file://history/${name}`,
    localClipboardHash: hash,
  });
}

const hashesOf = (items: ClipboardItem[]) => items.map((i) => i.profileHash);

describe('复制路径 → SQLite 各类型', () => {
  it('复制纯文本 → Text / displayKind=text', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('hello world 你好', 'CP_TEXT_1'));

    expect(await s.getItem('CP_TEXT_1')).toMatchObject({
      type: 'Text',
      text: 'hello world 你好',
      hasData: false,
    });
    const { items } = await s.searchItems({ displayKinds: ['text'] });
    expect(hashesOf(items)).toContain('CP_TEXT_1');
  });

  it('复制链接文本 → displayKind=url(不落入 text 过滤)', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('https://example.com/a/b?x=1', 'CP_URL_1'));

    const url = await s.searchItems({ displayKinds: ['url'] });
    expect(hashesOf(url.items)).toContain('CP_URL_1');
    const text = await s.searchItems({ displayKinds: ['text'] });
    expect(hashesOf(text.items)).not.toContain('CP_URL_1');
  });

  it('复制图片 → Image / hasData / dataName / fileUri 保留', async () => {
    const s = await freshStorage();
    await s.addItem(imageItem('CP_IMG_1'));

    expect(await s.getItem('CP_IMG_1')).toMatchObject({
      type: 'Image',
      hasData: true,
      dataName: 'CP_IMG_1.png',
      fileUri: 'file://history/CP_IMG_1.png',
    });
    const { items } = await s.searchItems({ displayKinds: ['image'] });
    expect(hashesOf(items)).toContain('CP_IMG_1');
  });

  it('复制文件 → File / hasData / dataName', async () => {
    const s = await freshStorage();
    await s.addItem(fileItem('CP_FILE_1', 'report.pdf'));

    expect(await s.getItem('CP_FILE_1')).toMatchObject({
      type: 'File',
      hasData: true,
      dataName: 'report.pdf',
    });
    const { items } = await s.searchItems({ displayKinds: ['file'] });
    expect(hashesOf(items)).toContain('CP_FILE_1');
  });
});

describe('分享路径 → SQLite 各类型(uploadFile 构造的 item)', () => {
  it('等待 Android 文件移动真正完成后才返回可发送的历史条目', async () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const mockedFile = File as unknown as { moveMock: jest.Mock; existsMock: jest.Mock };
    const moveMock = mockedFile.moveMock;
    mockedFile.existsMock.mockImplementation((uri: string) => !uri.startsWith('file://history'));
    let finishMove: (() => void) | undefined;
    moveMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve;
        })
    );

    try {
      const storage = await freshStorage();
      let settled = false;
      const adding = storage
        .addItem(
          createDefaultClipboardItem({
            type: 'Image',
            text: '',
            profileHash: 'SH_IMG_PENDING_MOVE',
            hasData: true,
            dataName: 'shared.png',
            size: 68,
            timestamp: T0,
            fileUri: 'file://temp/shared.png',
            from: 'share',
          })
        )
        .then(() => {
          settled = true;
        });

      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const settledBeforeMove = settled;
      finishMove?.();
      await adding;
      expect(moveMock).toHaveBeenCalledTimes(1);
      expect(settledBeforeMove).toBe(false);
      expect(settled).toBe(true);
    } finally {
      mockedFile.existsMock.mockReset();
      mockedFile.existsMock.mockReturnValue(true);
      moveMock.mockReset();
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    }
  });

  it('分享文本 → Text 落库并可检索(from=share)', async () => {
    const s = await freshStorage();
    await s.addItem(
      createDefaultClipboardItem({
        type: 'Text',
        text: '通过分享进入的文本',
        profileHash: 'SH_TEXT_1',
        hasData: false,
        size: 20,
        timestamp: T0,
        from: 'share',
      })
    );
    expect(await s.getItem('SH_TEXT_1')).toMatchObject({
      type: 'Text',
      text: '通过分享进入的文本',
      from: 'share',
    });
  });

  it('分享图片 → Image 落库,hasData/dataName 正确', async () => {
    const s = await freshStorage();
    await s.addItem(
      createDefaultClipboardItem({
        type: 'Image',
        text: '',
        profileHash: 'SH_IMG_1',
        hasData: true,
        dataName: 'shared.png',
        size: 8192,
        timestamp: T0,
        fileUri: 'file://history/shared.png',
        from: 'share',
      })
    );
    expect(await s.getItem('SH_IMG_1')).toMatchObject({
      type: 'Image',
      hasData: true,
      dataName: 'shared.png',
    });
    expect(hashesOf((await s.searchItems({ displayKinds: ['image'] })).items)).toContain(
      'SH_IMG_1'
    );
  });

  it('分享文件 → File 落库', async () => {
    const s = await freshStorage();
    await s.addItem(
      createDefaultClipboardItem({
        type: 'File',
        text: 'doc.zip',
        profileHash: 'SH_FILE_1',
        hasData: true,
        dataName: 'doc.zip',
        size: 16384,
        timestamp: T0,
        fileUri: 'file://history/doc.zip',
        from: 'share',
      })
    );
    expect(await s.getItem('SH_FILE_1')).toMatchObject({
      type: 'File',
      hasData: true,
      dataName: 'doc.zip',
    });
  });
});

describe('检索 / 去重 / 删除 / 统计(全类型)', () => {
  it('getItemByLocalHash 命中图片(按内容 hash)', async () => {
    const s = await freshStorage();
    await s.addItem(imageItem('LH_IMG_1'));
    expect((await s.getItemByLocalHash('LH_IMG_1'))?.profileHash).toBe('LH_IMG_1');
  });

  it('相同 profileHash 再次复制 → 更新而非新增(总数不变)', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('dup content', 'DUP_1', T0));
    await s.addItem(textItem('dup content', 'DUP_1', T0 + 1000));
    expect((await s.getAllItems()).filter((i) => i.profileHash === 'DUP_1')).toHaveLength(1);
  });

  it('大小写不同的 profileHash 视为同一条(COLLATE NOCASE)', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('x', 'AbCdEf'));
    await s.addItem(textItem('x', 'abcdef'));
    expect(await s.getCount()).toBe(1);
  });

  it('软删除图片 → 从可见列表消失,仍在 includingDeleted 且标记 NeedSync', async () => {
    const s = await freshStorage();
    await s.addItem(imageItem('DEL_IMG_1'));
    await s.softDeleteItem('DEL_IMG_1');

    expect(hashesOf(await s.getAllItems())).not.toContain('DEL_IMG_1');
    const withDeleted = await s.getAllItemsIncludingDeleted();
    const item = withDeleted.find((i) => i.profileHash === 'DEL_IMG_1');
    expect(item?.isDeleted).toBe(true);
    expect(item?.syncStatus).toBe(HistorySyncStatus.NeedSync);
  });

  it('物理删除文件 → 彻底移除', async () => {
    const s = await freshStorage();
    await s.addItem(fileItem('DEL_FILE_1', 'x.bin'));
    await s.physicalDeleteItem('DEL_FILE_1');

    expect(await s.getItem('DEL_FILE_1')).toBeNull();
    expect(hashesOf(await s.getAllItemsIncludingDeleted())).not.toContain('DEL_FILE_1');
  });

  it('混合类型:getStats 按类型统计正确', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('t1', 'ST_T1', T0 + 1));
    await s.addItem(textItem('https://a.com', 'ST_U1', T0 + 2));
    await s.addItem(imageItem('ST_I1', T0 + 3));
    await s.addItem(fileItem('ST_F1', 'f.dat', T0 + 4));

    const stats = await s.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byType).toMatchObject({ Text: 2, Image: 1, File: 1 });
  });

  it('多类型混合时按 displayKind 分别检索互不串台', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('plain', 'MX_T', T0 + 1));
    await s.addItem(textItem('https://b.com', 'MX_U', T0 + 2));
    await s.addItem(imageItem('MX_I', T0 + 3));
    await s.addItem(fileItem('MX_F', 'g.dat', T0 + 4));

    expect((await s.searchItems({ displayKinds: ['text'] })).items).toHaveLength(1);
    expect((await s.searchItems({ displayKinds: ['url'] })).items).toHaveLength(1);
    expect((await s.searchItems({ displayKinds: ['image'] })).items).toHaveLength(1);
    expect((await s.searchItems({ displayKinds: ['file'] })).items).toHaveLength(1);
    expect((await s.searchItems({ displayKinds: ['image', 'file'] })).items).toHaveLength(2);
  });

  it('关键词搜索命中文本 / 文件名,LIKE 子串语义', async () => {
    const s = await freshStorage();
    await s.addItem(textItem('meeting notes 2026', 'KW_T'));
    await s.addItem(fileItem('KW_F', 'quarterly-notes.pdf'));
    await s.addItem(textItem('unrelated', 'KW_X'));

    const r = await s.searchItems({ keyword: 'notes' });
    const hs = hashesOf(r.items);
    expect(hs).toContain('KW_T');
    expect(hs).toContain('KW_F');
    expect(hs).not.toContain('KW_X');
  });
});
