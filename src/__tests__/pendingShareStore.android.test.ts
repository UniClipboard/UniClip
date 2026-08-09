/**
 * AndroidPendingShareStore 文件系统行为测试
 *
 * 用内存 fake 替换 expo-file-system(与 fileStorage.appGroup.test.ts 同模式),
 * 验证 §3.3/§4 契约:
 * - staging 原子写(payload 与记录都走 `{id}.tmp` → move,不留 tmp 残渣);
 * - claim 把 pending 记录移入 processing,缺 payload 的记录被清除;
 * - release 放回 pending;complete 连同 payload 一并清除;
 * - 15 分钟租约恢复;7 天过期(记录 + payload + 孤儿 payload)。
 */

const DOCUMENT = 'file:///documents';

type FakeEntry = { type: 'dir' | 'file'; content?: string; modified: number };

function buildFs() {
  const entries = new Map<string, FakeEntry>();
  const doc = { uri: DOCUMENT, type: 'dir' as const, modified: 0 };

  function normalize(parts: Array<Directory | File | string>): string {
    const joined = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    const pathPart = joined.replace(/^file:\/*/, '');
    return `file:///${pathPart.replace(/\/+/g, '/')}`;
  }

  function basename(raw: string): string {
    const trimmed = raw.split('/').filter(Boolean).pop() ?? '';
    return trimmed;
  }

  class Directory {
    uri: string;
    name: string;
    exists: boolean;

    constructor(...parts: Array<Directory | File | string>) {
      this.uri = normalize(parts);
      this.name = basename(String(parts[parts.length - 1] ?? ''));
      this.exists = entries.get(this.uri)?.type === 'dir';
    }

    create() {
      entries.set(this.uri, { type: 'dir', modified: Date.now() });
      this.exists = true;
    }

    list(): (Directory | File)[] {
      const prefix = this.uri.endsWith('/') ? this.uri : `${this.uri}/`;
      const children: (Directory | File)[] = [];
      for (const [uri, entry] of entries) {
        if (!uri.startsWith(prefix)) continue;
        const rest = uri.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        children.push(entry.type === 'dir' ? new Directory(uri) : new File(uri));
      }
      return children;
    }
  }

  class File {
    uri: string;
    name: string;

    constructor(...parts: Array<Directory | File | string>) {
      this.uri = normalize(parts);
      this.name = basename(String(parts[parts.length - 1] ?? ''));
    }

    get exists(): boolean {
      return entries.get(this.uri)?.type === 'file';
    }

    get size(): number {
      return entries.get(this.uri)?.content?.length ?? 0;
    }

    write(content: string) {
      entries.set(this.uri, { type: 'file', content, modified: Date.now() });
    }

    textSync(): string {
      return entries.get(this.uri)?.content ?? '';
    }

    delete() {
      entries.delete(this.uri);
    }

    info(): { exists: boolean; size: number; modificationTime: number } {
      const entry = entries.get(this.uri);
      return {
        exists: entry?.type === 'file',
        size: entry?.content?.length ?? 0,
        modificationTime: entry?.modified ?? 0,
      };
    }

    async move(destination: File) {
      this.moveSync(destination);
    }

    moveSync(destination: File) {
      const source = entries.get(this.uri);
      if (!source || source.type !== 'file') throw new Error(`missing source ${this.uri}`);
      entries.delete(this.uri);
      entries.set(destination.uri, { ...source, modified: Date.now() });
    }

    async copy(destination: File) {
      const source = entries.get(this.uri);
      if (!source || source.type !== 'file') throw new Error(`missing source ${this.uri}`);
      entries.set(destination.uri, { ...source, modified: Date.now() });
    }
  }

  entries.set(DOCUMENT, doc);

  return {
    entries,
    Directory,
    File,
    dir: (path: string) => new Directory(`${DOCUMENT}/${path}`),
    file: (path: string) => new File(`${DOCUMENT}/${path}`),
  };
}

describe('AndroidPendingShareStore', () => {
  let fs: ReturnType<typeof buildFs>;
  let AndroidPendingShareStore: typeof import('../features/transfer/internal/pendingShareStore').AndroidPendingShareStore;
  let resetPendingShareStoreForTest: typeof import('../features/transfer/internal/pendingShareStore').resetPendingShareStoreForTest;
  let store: import('../features/transfer/internal/pendingShareStore').AndroidPendingShareStore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    fs = buildFs();
    jest.doMock('expo-file-system', () => ({
      Paths: { document: DOCUMENT, cache: 'file:///cache' },
      Directory: fs.Directory,
      File: fs.File,
    }));
    const module =
      require('../features/transfer/internal/pendingShareStore') as typeof import('../features/transfer/internal/pendingShareStore');
    AndroidPendingShareStore = module.AndroidPendingShareStore;
    resetPendingShareStoreForTest = module.resetPendingShareStoreForTest;
    store = new AndroidPendingShareStore();
  });

  afterEach(() => {
    jest.dontMock('expo-file-system');
    resetPendingShareStoreForTest();
  });

  function pendingIds(): string[] {
    return fs
      .dir('pending-share/pending')
      .list()
      .map((entry) => entry.name)
      .sort();
  }

  function processingIds(): string[] {
    return fs
      .dir('pending-share/processing')
      .list()
      .map((entry) => entry.name)
      .sort();
  }

  it('stages text atomically with a UTF-8 payload and no tmp leftovers', async () => {
    const job = await store.stageText('你好,world');

    expect(job.kind).toBe('text');
    expect(job.displayName).toBe('分享的文本.txt');
    expect(job.mimeType).toBe('text/plain');
    expect(job.byteCount).toBe(new TextEncoder().encode('你好,world').byteLength);
    expect(job.fileUri).toBe(`file:///documents/pending-share/files/${job.id}.payload`);

    const payload = fs.file(`pending-share/files/${job.id}.payload`);
    expect(payload.exists).toBe(true);
    expect(payload.textSync()).toBe('你好,world');

    const record = fs.file(`pending-share/pending/${job.id}.json`);
    expect(record.exists).toBe(true);
    expect(JSON.parse(record.textSync())).toMatchObject({
      id: job.id,
      kind: 'text',
      displayName: '分享的文本.txt',
      byteCount: job.byteCount,
      mimeType: 'text/plain',
      createdAtMs: job.createdAtMs,
    });
    expect(
      fs
        .dir('pending-share/files')
        .list()
        .map((e) => e.name)
    ).toEqual([`${job.id}.payload`]);
    expect(pendingIds()).toEqual([`${job.id}.json`]);
  });

  it('stages assets by copying bytes and derives image kind from the mime prefix', async () => {
    fs.file('sources/photo.jpg').write('JPEG-BYTES');

    const image = await store.stageAsset(
      'file:///documents/sources/photo.jpg',
      'photo.jpg',
      'image/jpeg'
    );
    expect(image.kind).toBe('image');
    expect(image.displayName).toBe('photo.jpg');
    expect(fs.file(`pending-share/files/${image.id}.payload`).textSync()).toBe('JPEG-BYTES');

    fs.file('sources/archive.zip').write('ZIP-BYTES');
    const file = await store.stageAsset(
      'file:///documents/sources/archive.zip',
      'archive.zip',
      'application/zip'
    );
    expect(file.kind).toBe('file');
    expect(fs.file(`pending-share/files/${file.id}.payload`).textSync()).toBe('ZIP-BYTES');

    fs.file('sources/no-name').write('BYTES');
    const unnamed = await store.stageAsset('file:///documents/sources/no-name', '', null);
    expect(unnamed.displayName).toMatch(/^shared_\d+$/);
  });

  it('claims pending jobs by moving records into processing, oldest first', async () => {
    await store.stageText('first');
    await store.stageText('second');
    const before = pendingIds();
    expect(before).toHaveLength(2);

    const claimed = await store.claimPending();

    expect(claimed).toHaveLength(2);
    expect(claimed.map((j) => j.displayName)).toEqual(['分享的文本.txt', '分享的文本.txt']);
    expect(claimed[0].createdAtMs).toBeLessThanOrEqual(claimed[1].createdAtMs);
    expect(pendingIds()).toEqual([]);
    expect(processingIds()).toEqual(before);
  });

  it('skips and clears records whose payload is missing', async () => {
    await store.stageText('doomed');
    const record = fs.file('pending-share/pending/doomed.json');
    record.write(
      JSON.stringify({
        id: 'doomed',
        kind: 'text',
        displayName: 'x.txt',
        byteCount: 1,
        mimeType: null,
        createdAtMs: Date.now(),
      })
    );

    const claimed = await store.claimPending();

    expect(claimed).toHaveLength(1);
    expect(fs.file('pending-share/processing/doomed.json').exists).toBe(false);
  });

  it('releases a claimed job back to pending', async () => {
    await store.stageText('retry me');
    const [job] = await store.claimPending();

    await store.releaseJob(job.id);

    expect(processingIds()).toEqual([]);
    expect(pendingIds()).toEqual([`${job.id}.json`]);
  });

  it('completes a job by clearing the record and the payload', async () => {
    await store.stageText('done');
    const [job] = await store.claimPending();

    await store.completeJob(job.id);

    expect(pendingIds()).toEqual([]);
    expect(processingIds()).toEqual([]);
    expect(fs.file(`pending-share/files/${job.id}.payload`).exists).toBe(false);
  });

  it('recovers processing jobs abandoned past the 15 minute lease', async () => {
    await store.stageText('abandoned');
    await store.claimPending();
    expect(processingIds()).toHaveLength(1);

    const record = fs.file(`pending-share/processing/${processingIds()[0]}`);
    record.write(record.textSync());
    const aged = fs.entries.get(record.uri);
    if (!aged) throw new Error('missing aged record');
    aged.modified = Date.now() - 16 * 60 * 1000;

    const claimed = await store.claimPending();

    expect(claimed).toHaveLength(1);
    expect(pendingIds()).toEqual([]);
    expect(processingIds()).toHaveLength(1);
  });

  it('expires jobs older than seven days on cleanup', async () => {
    await store.stageText('old');
    const oldId = pendingIds()[0].slice(0, -'.json'.length);
    const record = fs.file(`pending-share/pending/${oldId}.json`);
    const stored = JSON.parse(record.textSync()) as { createdAtMs: number };
    record.write(JSON.stringify({ ...stored, createdAtMs: Date.now() - 8 * 24 * 60 * 60 * 1_000 }));

    await store.cleanup();

    expect(pendingIds()).toEqual([]);
    expect(fs.file(`pending-share/files/${oldId}.payload`).exists).toBe(false);
  });

  it('removes orphan payloads older than seven days but keeps fresh ones', async () => {
    const fresh = fs.file('pending-share/files/orphan-fresh.payload');
    fresh.write('fresh');
    const stale = fs.file('pending-share/files/orphan-stale.payload');
    stale.write('stale');
    const staleEntry = fs.entries.get(stale.uri);
    if (!staleEntry) throw new Error('missing stale payload');
    staleEntry.modified = Date.now() - 8 * 24 * 60 * 60 * 1_000;

    await store.cleanup();

    expect(fresh.exists).toBe(true);
    expect(stale.exists).toBe(false);
  });

  it('decodes records without a kind as file for legacy compatibility', async () => {
    const legacy = fs.file('pending-share/pending/legacy.json');
    legacy.write(
      JSON.stringify({
        id: 'legacy',
        displayName: 'old.bin',
        byteCount: 3,
        mimeType: null,
        createdAtMs: Date.now(),
      })
    );
    const payload = fs.file('pending-share/files/legacy.payload');
    payload.write('xyz');

    const [job] = await store.claimPending();

    expect(job.kind).toBe('file');
    expect(job.displayName).toBe('old.bin');
  });
});
