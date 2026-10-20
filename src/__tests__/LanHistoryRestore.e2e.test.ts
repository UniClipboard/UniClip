import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { getDatabase, TABLE_HISTORY } from '../platform/database';
import { LanRemoteContentApplier } from '../features/lan-sync/internal/lanRemoteContentApplier';
import { ClipboardManager } from '../features/clipboard/internal/clipboardManager';
import { historyStorage, useHistoryStore } from '../features/history';
import {
  createDefaultClipboardItem,
  HistorySyncStatus,
  type ClipboardContent,
  type ClipboardItem,
} from '../types/clipboard';

const mockGetFileSourceIdAsync = jest.fn();
const mockSaveFileToFileAsync = jest.fn();

jest.mock('expo-image-picker', () => ({}));

jest.mock('android-util', () => ({
  isNativeHashModuleAvailable: false,
  nativeCalculateFileHash: jest.fn(),
  nativeSetClipboardImageFromFile: jest.fn(),
  nativeSaveClipboardFileToFile: jest.fn().mockResolvedValue(null),
  nativeGetClipboardFileSourceId: jest.fn().mockReturnValue(null),
  isTailscaleActive: jest.fn().mockReturnValue(false),
  singleAttemptSender: jest.fn().mockReturnValue(null),
}));

jest.mock('../utils/clipboardProxy', () => ({
  getFileSourceIdAsync: (...args: unknown[]) => mockGetFileSourceIdAsync(...args),
  saveFileToFileAsync: (...args: unknown[]) => mockSaveFileToFileAsync(...args),
  getStringAsync: jest.fn().mockResolvedValue(''),
  hasImageAsync: jest.fn().mockResolvedValue(false),
  hasStringAsync: jest.fn().mockResolvedValue(false),
  saveImageToFileAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../utils/androidBackgroundClipboardAccess', () => ({
  getBackgroundClipboardAdapter: jest.fn(() => null),
}));

jest.mock('expo-file-system', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const url = require('node:url') as typeof import('node:url');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uniclip-history-'));
  const makeGate = () => {
    let enter!: () => void;
    let release!: () => void;
    return {
      entered: new Promise<void>((resolve) => { enter = resolve; }),
      enter,
      wait: new Promise<void>((resolve) => { release = resolve; }),
      release,
    };
  };
  const moveGates = new Map<string, ReturnType<typeof makeGate>>();
  const movedGates = new Map<string, ReturnType<typeof makeGate>>();
  const moveFailures = new Map<string, Error>();
  const deleteFailures = new Map<string, Error>();
  const constructionFailures = new Map<string, Error>();
  const existsFailures = new Map<string, Error>();

  const pathOf = (value: unknown): string => {
    if (typeof value === 'object' && value !== null && 'path' in value) {
      return String((value as { path: string }).path);
    }
    const raw =
      typeof value === 'object' && value !== null && 'uri' in value
        ? String((value as { uri: string }).uri)
        : String(value);
    return raw.startsWith('file:') ? url.fileURLToPath(raw) : raw;
  };
  const uriOf = (filePath: string): string => url.pathToFileURL(filePath).href;
  const matchingFailure = (filePath: string, failures: Map<string, Error>) =>
    [...failures].find(([hash]) =>
      filePath.toLowerCase().includes(`-${hash.toLowerCase()}/`)
    )?.[1];

  class FakeDirectory {
    readonly path: string;
    readonly uri: string;
    readonly name: string;
    readonly isDirectory = true;

    constructor(...parts: unknown[]) {
      this.path = path.join(pathOf(parts[0]), ...parts.slice(1).map(String));
      this.uri = uriOf(this.path);
      this.name = path.basename(this.path);
    }

    get exists(): boolean {
      return fs.existsSync(this.path);
    }

    create(options?: { intermediates?: boolean; idempotent?: boolean }): void {
      fs.mkdirSync(this.path, {
        recursive: options?.intermediates === true || options?.idempotent === true,
      });
    }

    delete(): void {
      fs.rmSync(this.path, { recursive: true, force: true });
    }

    list(): Array<FakeDirectory | FakeFile> {
      if (!this.exists) return [];
      return fs.readdirSync(this.path, { withFileTypes: true }).map((entry) =>
        entry.isDirectory()
          ? new FakeDirectory(this, entry.name)
          : new FakeFile(this, entry.name)
      );
    }
  }

  class FakeFile {
    path: string;
    uri: string;
    name: string;
    readonly isDirectory = false;

    constructor(...parts: unknown[]) {
      const raw = parts.map((part) => pathOf(part)).join('/');
      const constructionFailure = constructionFailures.get(raw);
      if (constructionFailure) throw constructionFailure;
      this.path = path.join(pathOf(parts[0]), ...parts.slice(1).map(String));
      this.uri = uriOf(this.path);
      this.name = path.basename(this.path);
    }

    get exists(): boolean {
      const failure = existsFailures.get(this.uri);
      if (failure) throw failure;
      return fs.existsSync(this.path);
    }

    get size(): number | null {
      return this.exists ? fs.statSync(this.path).size : null;
    }

    info(): { exists: boolean; size: number | null } {
      return { exists: this.exists, size: this.size };
    }

    open(): { readBytes(size: number): Uint8Array; close(): void } {
      const bytes = fs.readFileSync(this.path);
      let offset = 0;
      return {
        readBytes(size: number) {
          const chunk = bytes.subarray(offset, offset + size);
          offset += chunk.length;
          return chunk;
        },
        close() {},
      };
    }

    text(): Promise<string> {
      return fs.promises.readFile(this.path, 'utf8');
    }

    textSync(): string {
      return fs.readFileSync(this.path, 'utf8');
    }

    arrayBuffer(): Promise<ArrayBuffer> {
      return fs.promises.readFile(this.path).then((bytes) =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
    }

    write(data: string | Uint8Array): void {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path, data);
    }

    delete(): void {
      const failure = matchingFailure(this.path, deleteFailures);
      if (failure) throw failure;
      fs.rmSync(this.path, { force: true });
    }

    async move(target: FakeFile): Promise<void> {
      const gate = [...moveGates].find(([hash]) =>
        target.path.toLowerCase().includes(`-${hash.toLowerCase()}/`)
      )?.[1];
      gate?.enter();
      await gate?.wait;
      const failure = matchingFailure(target.path, moveFailures);
      if (failure) throw failure;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      if (fs.existsSync(target.path)) throw new Error(`EEXIST: ${target.path}`);
      fs.renameSync(this.path, target.path);
      this.path = target.path;
      this.uri = target.uri;
      this.name = target.name;
      const movedGate = [...movedGates].find(([hash]) =>
        target.path.toLowerCase().includes(`-${hash.toLowerCase()}/`)
      )?.[1];
      movedGate?.enter();
      await movedGate?.wait;
    }
  }

  const controls = {
    fixtureRoot,
    reset() {
      moveGates.clear();
      movedGates.clear();
      moveFailures.clear();
      deleteFailures.clear();
      constructionFailures.clear();
      existsFailures.clear();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fs.mkdirSync(fixtureRoot, { recursive: true });
    },
    clean() {
      moveGates.clear();
      movedGates.clear();
      moveFailures.clear();
      deleteFailures.clear();
      constructionFailures.clear();
      existsFailures.clear();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    },
    failMove(profileHash: string, error: Error) {
      moveFailures.set(profileHash, error);
    },
    blockMove(profileHash: string) {
      const gate = makeGate();
      moveGates.set(profileHash, gate);
      return gate;
    },
    blockAfterMove(profileHash: string) {
      const gate = makeGate();
      movedGates.set(profileHash, gate);
      return gate;
    },
    failDelete(profileHash: string, error: Error) {
      deleteFailures.set(profileHash, error);
    },
    failConstruction(uri: string, error: Error) {
      constructionFailures.set(uri, error);
    },
    failExists(uri: string, error: Error) {
      existsFailures.set(uri, error);
    },
    restoreExists(uri: string) {
      existsFailures.delete(uri);
    },
    async deleteHistoryFileDir(type: string, profileHash: string): Promise<void> {
      fs.rmSync(
        path.join(fixtureRoot, 'documents/clipboards/history', `${type}-${profileHash}`),
        { recursive: true, force: true }
      );
    },
  };

  return {
    File: FakeFile,
    Directory: FakeDirectory,
    Paths: {
      get document() {
        return path.join(fixtureRoot, 'documents');
      },
      get cache() {
        return path.join(fixtureRoot, 'cache');
      },
    },
    __controls: controls,
  };
});

jest.mock('@/platform/files', () => {
  const actual = jest.requireActual('@/platform/files');
  const android = jest.requireActual('@/platform/files/fileStorage.android');
  return {
    ...actual,
    deleteHistoryFileDir: (type: string, profileHash: string) =>
      require('expo-file-system').__controls.deleteHistoryFileDir(type, profileHash),
    getHistoryFileUri: android.getHistoryFileUri,
  };
});

jest.mock('../features/settings', () => ({
  configStorage: { getConfig: jest.fn().mockResolvedValue({ maxHistoryItems: 1000 }) },
  useSettingsStore: {
    getState: jest.fn(() => ({
      config: { clipboardAccessMethod: 'overlay-polling' },
      isTempDisabledBackgroundTasks: false,
    })),
  },
}));

type FsControls = {
  fixtureRoot: string;
  reset(): void;
  clean(): void;
  failMove(profileHash: string, error: Error): void;
  blockMove(profileHash: string): FsGate;
  blockAfterMove(profileHash: string): FsGate;
  failDelete(profileHash: string, error: Error): void;
  failConstruction(uri: string, error: Error): void;
  failExists(uri: string, error: Error): void;
  restoreExists(uri: string): void;
};

type FsGate = { entered: Promise<void>; release(): void };

const controls = (require('expo-file-system') as { __controls: FsControls }).__controls;
const freshTime = 1_800_000_123_456;
const originalPlatform = Platform.OS;
const clipboardSourceId = 'content://clipboard/current-file';
let nativeCopySequence = 0;
const asyncStorageValues = new Map<string, string>();
const asyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

type NativeClipboardFile = {
  filePath: string;
  displayName: string;
  mimeType: string;
  size: number;
  sourceId: string;
};

function fileHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function nativeClipboardFile(
  bytes: Buffer,
  displayName = 'clipboard.log',
  sourceId = clipboardSourceId
): NativeClipboardFile {
  const filePath = join(
    controls.fixtureRoot,
    'cache/temp_files',
    `${++nativeCopySequence}-${displayName}`
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return {
    filePath: pathToFileURL(filePath).href,
    displayName,
    mimeType: 'text/plain',
    size: bytes.length,
    sourceId,
  };
}

function historyItemFromContent(content: ClipboardContent): ClipboardItem {
  return createDefaultClipboardItem({
    type: content.type,
    text: content.text ?? '',
    profileHash: content.profileHash ?? '',
    hasData: Boolean(content.fileUri),
    dataName: content.fileName,
    size: content.fileSize,
    timestamp: content.timestamp,
    fileUri: content.fileUri,
    localClipboardHash: content.localClipboardHash,
  });
}

type MutableStorageState = {
  initialized: boolean;
  initializationPromise: Promise<void> | null;
  initializationError: unknown;
  startupMaintenancePromise: Promise<void> | null;
  startupMaintenanceCompleted: boolean;
  pendingChanges: unknown[];
  notifyTimer: ReturnType<typeof setTimeout> | null;
  changeCallbacks: Set<unknown>;
  profileMutations: Map<string, Promise<void>>;
};

const storageState = historyStorage as unknown as MutableStorageState;

function permanentFile(profileHash: string, dataName: string): string {
  return join(
    controls.fixtureRoot,
    'documents/clipboards/history',
    `File-${profileHash}`,
    dataName
  );
}

function sourceFile(profileHash: string, dataName: string, bytes: Buffer): string {
  const filePath = join(controls.fixtureRoot, 'cache', `${profileHash}-${dataName}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return pathToFileURL(filePath).href;
}

function oldItem(profileHash: string, overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  const dataName = overrides.dataName ?? 'old.log';
  const filePath = permanentFile(profileHash, dataName);
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, Buffer.from('old bytes'));
  return createDefaultClipboardItem({
    type: 'File',
    text: dataName,
    profileHash,
    contentId: 'blake3v1:old',
    hasData: true,
    dataName,
    size: 9,
    timestamp: freshTime - 3_600_000,
    localClipboardHash: `old-${profileHash}`,
    fileUri: pathToFileURL(filePath).href,
    syncStatus: HistorySyncStatus.LocalOnly,
    version: 4,
    lastModified: freshTime - 3_600_000,
    lastAccessed: freshTime - 3_600_000,
    isDeleted: true,
    isLocalFileReady: false,
    from: 'old-device',
    starred: true,
    pinned: true,
    useCount: 7,
    ...overrides,
  });
}

function remoteInput(profileHash: string, dataName: string, bytes: Buffer) {
  return {
    type: 'File' as const,
    text: dataName,
    profileHash,
    contentId: `blake3v1:fresh-${profileHash.toLowerCase()}`,
    hasData: true,
    dataName,
    fileUri: sourceFile(profileHash, dataName, bytes),
    size: 117,
  };
}

function applier() {
  const display = jest.fn<void, [ClipboardContent]>();
  return {
    display,
    value: new LanRemoteContentApplier({
      pauseClipboardMonitoring: jest.fn(),
      resumeClipboardMonitoring: jest.fn(),
      setClipboardContent: jest.fn(async () => undefined),
      readClipboardContent: jest.fn(async () => null),
      setClipboardWatermark: jest.fn(async () => undefined),
      noteApplied: jest.fn(),
      clearActivate: jest.fn(async () => undefined),
      addHistoryItem: (item) =>
        useHistoryStore.getState().addItem(item, { throwOnFailure: true }),
      setCurrentContentDisplay: display,
      readTextFile: (uri) => new File(uri).text(),
    }),
  };
}

async function waitForGate(gate: FsGate): Promise<void> {
  const entered = await Promise.race([
    gate.entered.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
  if (!entered) {
    gate.release();
    throw new Error('payload move did not reach the test gate');
  }
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

beforeEach(async () => {
  controls.reset();
  nativeCopySequence = 0;
  jest.clearAllMocks();
  asyncStorageValues.clear();
  asyncStorage.getItem.mockReset().mockImplementation(async (key) =>
    asyncStorageValues.get(key) ?? null
  );
  asyncStorage.setItem.mockReset().mockImplementation(async (key, value) => {
    asyncStorageValues.set(key, value);
  });
  asyncStorage.removeItem.mockReset().mockImplementation(async (key) => {
    asyncStorageValues.delete(key);
  });
  mockGetFileSourceIdAsync.mockReset();
  mockSaveFileToFileAsync.mockReset();
  mockGetFileSourceIdAsync.mockResolvedValue(clipboardSourceId);
  mockSaveFileToFileAsync.mockResolvedValue(null);
  if (storageState.notifyTimer) clearTimeout(storageState.notifyTimer);
  Object.assign(storageState, {
    initialized: false,
    initializationPromise: null,
    initializationError: null,
    startupMaintenancePromise: null,
    startupMaintenanceCompleted: false,
    pendingChanges: [],
    notifyTimer: null,
    changeCallbacks: new Set(),
  });
  useHistoryStore.getState().reset();
  storageState.profileMutations.clear();
  jest.spyOn(Date, 'now').mockReturnValue(freshTime);
  await historyStorage.initialize();
});

afterEach(() => {
  if (storageState.notifyTimer) clearTimeout(storageState.notifyTimer);
  useHistoryStore.getState().reset();
  jest.restoreAllMocks();
  jest.useRealTimers();
  controls.clean();
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: originalPlatform, configurable: true });
});

describe('LAN receive history persistence', () => {
  it('replaces stale metadata and bytes while preserving preferences', async () => {
    const hash = 'RESTORE_BYTES';
    await historyStorage.addItem(oldItem(hash, { isDeleted: false, dataName: 'same.log' }));
    const oldUri = (await historyStorage.getItem(hash))!.fileUri!;
    const freshBytes = Buffer.from('new payload must replace the old target');
    const { value, display } = applier();

    await value.apply(remoteInput(hash, 'same.log', freshBytes));

    const saved = await historyStorage.getItem(hash);
    expect(saved).toMatchObject({
      text: 'same.log',
      dataName: 'same.log',
      contentId: 'blake3v1:fresh-restore_bytes',
      size: freshBytes.length,
      timestamp: freshTime,
      localClipboardHash: hash,
      isDeleted: false,
      isLocalFileReady: true,
      from: 'server',
      starred: true,
      pinned: true,
      useCount: 7,
    });
    expect(saved?.fileUri).not.toBe(oldUri);
    expect(existsSync(fileURLToPath(oldUri))).toBe(false);
    expect(readFileSync(fileURLToPath(saved!.fileUri!))).toEqual(freshBytes);
    expect(display).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileName: 'same.log', fileSize: freshBytes.length })
    );
  });

  it('replaces payload-backed Text with coherent inline Text', async () => {
    const hash = 'TEXT_PAYLOAD_TO_INLINE';
    const fullText = 'complete incoming text '.repeat(100);
    const payload = await historyStorage.addItem(createDefaultClipboardItem({
      type: 'Text',
      text: `${fullText.slice(0, 200)}...`,
      profileHash: hash,
      hasData: true,
      dataName: 'full.txt',
      size: fullText.length,
      fileUri: sourceFile(hash, 'full.txt', Buffer.from(fullText)),
      localClipboardHash: hash,
    }));

    await applier().value.apply({
      type: 'Text',
      text: fullText,
      profileHash: hash,
      contentId: 'blake3v1:inline-text',
      hasData: false,
      size: fullText.length,
    });

    await expect(historyStorage.getItem(hash)).resolves.toMatchObject({
      text: fullText,
      hasData: false,
      dataName: undefined,
      fileUri: undefined,
    });
    expect(existsSync(fileURLToPath(payload.fileUri!))).toBe(false);
  });

  it('keeps the same Text representation contract in addItems', async () => {
    const hash = 'BATCH_TEXT_PAYLOAD_TO_INLINE';
    const fullText = 'complete batch text '.repeat(100);
    const payload = await historyStorage.addItem(createDefaultClipboardItem({
      type: 'Text',
      text: `${fullText.slice(0, 200)}...`,
      profileHash: hash,
      hasData: true,
      dataName: 'batch.txt',
      size: fullText.length,
      fileUri: sourceFile(hash, 'batch.txt', Buffer.from(fullText)),
      localClipboardHash: hash,
    }));

    await historyStorage.addItems([createDefaultClipboardItem({
      type: 'Text',
      text: fullText,
      profileHash: hash,
      hasData: false,
      size: fullText.length,
      localClipboardHash: hash,
    })]);

    await expect(historyStorage.getItem(hash)).resolves.toMatchObject({
      text: fullText,
      hasData: false,
      dataName: undefined,
      fileUri: undefined,
    });
    expect(existsSync(fileURLToPath(payload.fileUri!))).toBe(false);
  });

  it('skips an old guarded delete but preserves unguarded delete behavior', async () => {
    const hash = 'VERSION_GUARD';
    const old = await historyStorage.addItem(oldItem(hash, { isDeleted: false }));
    await applier().value.apply(remoteInput(hash, 'fresh.log', Buffer.from('new generation')));

    await expect(
      historyStorage.softDeleteItems(
        [hash],
        new Map([[hash.toLowerCase(), old.version]])
      )
    ).resolves.toEqual([]);
    expect((await historyStorage.getItem(hash))?.isDeleted).toBe(false);

    await expect(historyStorage.softDeleteItems([hash])).resolves.toEqual([hash]);
    expect((await historyStorage.getItem(hash))?.isDeleted).toBe(true);
  });

  it('queues an old guarded delete behind an in-flight receive', async () => {
    const hash = 'RECEIVE_FIRST';
    const old = await historyStorage.addItem(oldItem(hash, { isDeleted: false }));
    const freshBytes = Buffer.from('receive wins after its move completes');
    const gate = controls.blockMove(hash);
    const receive = applier().value.apply(remoteInput(hash, 'fresh.log', freshBytes));
    await waitForGate(gate);
    let deleteSettled = false;
    const staleDelete = historyStorage
      .softDeleteItems([hash], new Map([[hash.toLowerCase(), old.version]]))
      .then((result) => {
        deleteSettled = true;
        return result;
      });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(deleteSettled).toBe(false);
    gate.release();
    await expect(Promise.all([receive, staleDelete])).resolves.toEqual([undefined, []]);

    const saved = await historyStorage.getItem(hash);
    expect(saved?.isDeleted).toBe(false);
    expect(readFileSync(fileURLToPath(saved!.fileUri!))).toEqual(freshBytes);
  });

  it('does not let count cleanup delete a row while LAN replacement is staged', async () => {
    const hash = 'CLEANUP_DURING_RECEIVE';
    await historyStorage.addItem(oldItem(hash, {
      isDeleted: false,
      starred: false,
      pinned: false,
    }));
    for (let index = 0; index < 9; index += 1) {
      await historyStorage.addItem(createDefaultClipboardItem({
        type: 'Text',
        text: `retention candidate ${index}`,
        profileHash: `RETENTION_${index}`,
        timestamp: freshTime - 3_000_000 + index,
        lastModified: freshTime - 3_000_000 + index,
        lastAccessed: freshTime - 3_000_000 + index,
      }));
    }
    historyStorage.setMaxHistorySize(10);

    const freshBytes = Buffer.from('replacement survives concurrent count cleanup');
    const gate = controls.blockAfterMove(hash);
    const receive = applier().value.apply(remoteInput(hash, 'fresh.log', freshBytes));
    await waitForGate(gate);

    let addSettled = false;
    const add = useHistoryStore.getState().addItem(createDefaultClipboardItem({
      type: 'Text',
      text: 'new item triggers retention cleanup',
      profileHash: 'RETENTION_TRIGGER',
      timestamp: freshTime + 1,
    }), { throwOnFailure: true }).then(() => {
      addSettled = true;
    });
    const settledBeforeReceive = await Promise.race([
      add.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    gate.release();
    await Promise.all([receive, add]);

    expect(settledBeforeReceive).toBe(false);
    expect(addSettled).toBe(true);
    const saved = await historyStorage.getItem(hash);
    expect(saved?.isDeleted).toBe(false);
    expect(existsSync(fileURLToPath(saved!.fileUri!))).toBe(true);
    expect(readFileSync(fileURLToPath(saved!.fileUri!))).toEqual(freshBytes);
    await expect(historyStorage.getAllItems()).resolves.toHaveLength(10);
  });

  it('reselects the oldest overflow when candidate rank changes while cleanup waits', async () => {
    const blockedHash = 'RANK_BLOCKED';
    await historyStorage.addItem(oldItem(blockedHash, {
      isDeleted: false,
      starred: false,
      pinned: false,
    }));
    for (let index = 0; index < 9; index += 1) {
      await historyStorage.addItem(createDefaultClipboardItem({
        type: 'Text',
        text: `rank candidate ${index}`,
        profileHash: `RANK_${index}`,
        timestamp: freshTime - 3_000_000 + index,
      }));
    }
    historyStorage.setMaxHistorySize(10);

    let enterSql!: () => void;
    let releaseSql!: () => void;
    const sqlEntered = new Promise<void>((resolve) => { enterSql = resolve; });
    const sqlWait = new Promise<void>((resolve) => { releaseSql = resolve; });
    const db = await getDatabase();
    const originalRun = db.runAsync.bind(db);
    let blockNextRun = true;
    jest.spyOn(db, 'runAsync').mockImplementation(async (source, ...params) => {
      if (blockNextRun) {
        blockNextRun = false;
        enterSql();
        await sqlWait;
      }
      return originalRun(source, ...params);
    });

    const blockedUpdate = historyStorage.incrementUseCount(blockedHash);
    await sqlEntered;
    const blockedReservation = storageState.profileMutations.get(blockedHash.toLowerCase());

    const triggerAdd = historyStorage.addItem(createDefaultClipboardItem({
      type: 'Text',
      text: 'starts cleanup',
      profileHash: 'RANK_TRIGGER',
      timestamp: freshTime + 1,
    }));
    await waitForCondition(
      () => storageState.profileMutations.get(blockedHash.toLowerCase()) !== blockedReservation,
      'cleanup did not reserve the initially oldest candidate'
    );

    const newlyOldestHash = 'RANK_NEWLY_OLDEST';
    const olderAdd = historyStorage.addItem(createDefaultClipboardItem({
      type: 'Text',
      text: 'becomes oldest while cleanup waits',
      profileHash: newlyOldestHash,
      timestamp: freshTime - 4_000_000,
    }));
    await waitForCondition(
      () => storageState.profileMutations.has(newlyOldestHash.toLowerCase()),
      'new oldest row did not reserve its profile mutation'
    );
    await waitForCondition(
      () => storageState.profileMutations.has(newlyOldestHash.toLowerCase()) === false,
      'new oldest row did not finish its profile mutation'
    );
    await historyStorage.physicalDeleteItem('RANK_8');

    releaseSql();
    await Promise.all([blockedUpdate, triggerAdd, olderAdd]);

    await expect(historyStorage.getItem(blockedHash)).resolves.not.toBeNull();
    await expect(historyStorage.getItem(newlyOldestHash)).resolves.toBeNull();
    await expect(historyStorage.getAllItems()).resolves.toHaveLength(10);
  });

  it('preserves the previous row and bytes when SQLite rejects a replacement', async () => {
    const hash = 'DB_REPLACE_FAILURE';
    await historyStorage.addItem(oldItem(hash, { isDeleted: false }));
    const existing = (await historyStorage.getItem(hash))!;
    const db = await getDatabase();
    jest.spyOn(db, 'runAsync').mockRejectedValueOnce(new Error('sqlite write failed'));

    await expect(
      applier().value.apply(remoteInput(hash, existing.dataName!, Buffer.from('staged fresh')))
    ).rejects.toThrow('sqlite write failed');

    expect(await historyStorage.getItem(hash)).toEqual(existing);
    expect(readFileSync(fileURLToPath(existing.fileUri!))).toEqual(Buffer.from('old bytes'));
    expect(readdirSync(dirname(fileURLToPath(existing.fileUri!)))).toEqual([existing.dataName]);
    expect(useHistoryStore.getState().error).toBe('sqlite write failed');
  });

  it('removes a newly staged payload when SQLite rejects a new row', async () => {
    const hash = 'DB_NEW_FILE_FAILURE';
    const input = remoteInput(hash, 'new.log', Buffer.from('uncommitted payload'));
    const db = await getDatabase();
    jest.spyOn(db, 'runAsync').mockRejectedValueOnce(new Error('sqlite insert failed'));

    await expect(applier().value.apply(input)).rejects.toThrow('sqlite insert failed');

    await expect(historyStorage.getItem(hash)).resolves.toBeNull();
    expect(readdirSync(dirname(permanentFile(hash, 'new.log')))).toEqual([]);
  });

  it('rejects a failed move without replacing the row', async () => {
    const hash = 'MOVE_FAILURE';
    await historyStorage.addItem(oldItem(hash));
    const existing = (await historyStorage.getItem(hash))!;
    controls.failMove(hash, new Error('disk full'));

    await expect(
      applier().value.apply(remoteInput(hash, existing.dataName!, Buffer.from('fresh bytes')))
    ).rejects.toThrow('disk full');

    await expect(historyStorage.getItem(hash)).resolves.toEqual(existing);
    expect(readFileSync(fileURLToPath(existing.fileUri!))).toEqual(Buffer.from('old bytes'));
  });
});

describe('clipboard file cache persistence', () => {
  it('re-reads a changed file when the cached history payload disappears', async () => {
    const oldBytes = Buffer.from('clipboard bytes before replacement');
    const freshBytes = Buffer.from('fresh bytes behind the same source id');
    mockSaveFileToFileAsync
      .mockImplementationOnce(async () => nativeClipboardFile(oldBytes))
      .mockImplementationOnce(async () => nativeClipboardFile(freshBytes));
    const manager = new ClipboardManager();

    const first = (await manager.getClipboardContent())!;
    const stored = await historyStorage.addItem(historyItemFromContent(first));
    const cached = await manager.getClipboardContent();

    expect(cached?.fileUri).toBe(stored.fileUri);
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);

    rmSync(fileURLToPath(stored.fileUri!));
    const refreshed = await manager.getClipboardContent();

    expect(refreshed).toMatchObject({
      fileUri: expect.any(String),
      localClipboardHash: fileHash(freshBytes),
      hasData: true,
    });
    expect(readFileSync(fileURLToPath(refreshed!.fileUri!))).toEqual(freshBytes);
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
  });

  it('returns null for a failed stale-cache refresh and retries on the next tick', async () => {
    const firstBytes = Buffer.from('temporary clipboard payload');
    const retryBytes = Buffer.from('payload available on the next poll');
    mockSaveFileToFileAsync
      .mockImplementationOnce(async () => nativeClipboardFile(firstBytes))
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => nativeClipboardFile(retryBytes));
    const manager = new ClipboardManager();

    const first = (await manager.getClipboardContent())!;
    rmSync(fileURLToPath(first.fileUri!));

    await expect(manager.getClipboardContent()).resolves.toBeNull();
    const retried = await manager.getClipboardContent();

    expect(retried?.localClipboardHash).toBe(fileHash(retryBytes));
    expect(readFileSync(fileURLToPath(retried!.fileUri!))).toEqual(retryBytes);
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent refreshes of the same stale cached file', async () => {
    const firstBytes = Buffer.from('cached file that will disappear');
    const retryBytes = Buffer.from('one shared fresh native copy');
    mockSaveFileToFileAsync.mockImplementationOnce(async () => nativeClipboardFile(firstBytes));
    const manager = new ClipboardManager();
    const first = (await manager.getClipboardContent())!;
    rmSync(fileURLToPath(first.fileUri!));

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    mockSaveFileToFileAsync.mockImplementationOnce(async () => {
      await refreshGate;
      return nativeClipboardFile(retryBytes);
    });
    const reads = [manager.getClipboardContent(), manager.getClipboardContent()];
    await Promise.resolve();
    releaseRefresh();
    const [left, right] = await Promise.all(reads);

    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
    expect(left?.fileUri).toBe(right?.fileUri);
    expect(readFileSync(fileURLToPath(left!.fileUri!))).toEqual(retryBytes);
  });

  it.each(['constructor', 'exists'] as const)(
    'recovers from a persisted URI whose File %s throws',
    async (failureKind) => {
      const bytes = Buffer.from(`payload for ${failureKind} failure`);
      const hash = fileHash(bytes);
      const sourceUri = sourceFile(hash, 'clipboard.log', bytes);
      const stored = await historyStorage.addItem(createDefaultClipboardItem({
        type: 'File',
        text: 'clipboard.log',
        profileHash: hash,
        localClipboardHash: hash,
        hasData: true,
        dataName: 'clipboard.log',
        size: bytes.length,
        fileUri: sourceUri,
      }));
      const corruptUri = failureKind === 'constructor'
        ? 'content://corrupt/persisted-file'
        : pathToFileURL(join(controls.fixtureRoot, 'cache/unreadable-persisted-file')).href;
      if (failureKind === 'constructor') {
        controls.failConstruction(corruptUri, new Error('invalid persisted URI'));
      } else {
        controls.failExists(corruptUri, new Error('persisted URI cannot be inspected'));
      }
      const db = await getDatabase();
      await db.runAsync(
        `UPDATE ${TABLE_HISTORY} SET fileUri = ? WHERE profileHash = ?`,
        corruptUri,
        hash
      );
      expect(await historyStorage.getItemByLocalHash(hash)).toMatchObject({
        fileUri: corruptUri,
      });
      expect(existsSync(fileURLToPath(stored.fileUri!))).toBe(true);
      const { getHistoryFileUri } = await import('@/platform/files');
      await expect(getHistoryFileUri('File', hash, 'clipboard.log')).resolves.toBe(stored.fileUri);
      if (failureKind === 'exists') {
        expect(() => new File(corruptUri).exists).toThrow('persisted URI cannot be inspected');
      }
      mockSaveFileToFileAsync.mockImplementation(async () => nativeClipboardFile(bytes));
      const manager = new ClipboardManager();

      const first = await manager.getClipboardContent();
      const cached = await manager.getClipboardContent();

      expect(first?.fileUri).toBe(stored.fileUri);
      expect(cached?.fileUri).toBe(stored.fileUri);
      expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
      expect(readdirSync(join(controls.fixtureRoot, 'cache/temp_files'))).toEqual([]);

      rmSync(fileURLToPath(stored.fileUri!));
      const fresh = await manager.getClipboardContent();

      expect(fresh?.fileUri).toEqual(expect.any(String));
      expect(fresh?.fileUri).not.toBe(stored.fileUri);
      expect(readFileSync(fileURLToPath(fresh!.fileUri!))).toEqual(bytes);
      expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
    }
  );
});

describe('clipboard monitor deferred file persistence', () => {
  it.each(['deleted', 'unreadable'] as const)(
    'drops a file that becomes %s, then emits the valid same-source retry',
    async (failureKind) => {
      const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
        typeof import('../features/clipboard/internal/clipboardMonitor');
      jest.useFakeTimers({ doNotFake: ['Date'] });
      const bytes = Buffer.from('file removed during the debounce window');
      const copies: NativeClipboardFile[] = [];
      mockSaveFileToFileAsync.mockImplementation(async () => {
        const copy = nativeClipboardFile(bytes);
        copies.push(copy);
        return copy;
      });
      const monitor = new ClipboardMonitor(new ClipboardManager(), {
        pollingInterval: 60_000,
        debounceDelay: 300,
        stopOnBackground: false,
      });
      const persistence: Promise<void>[] = [];
      const persist = jest.fn((content: ClipboardContent) => {
        persistence.push(
          useHistoryStore
            .getState()
            .addItem(historyItemFromContent(content), { throwOnFailure: true })
        );
      });
      const externalNotify = jest.fn();
      monitor.addCallback(persist);
      monitor.addCallback(externalNotify);
      await monitor.start();

      const check = monitor.triggerCheck();
      await jest.advanceTimersByTimeAsync(0);
      await check;
      const firstUri = copies[0].filePath;
      if (failureKind === 'deleted') {
        rmSync(fileURLToPath(firstUri));
      } else {
        controls.failExists(firstUri, new Error('clipboard payload is unreadable'));
      }
      await jest.advanceTimersByTimeAsync(300);
      await Promise.resolve();

      expect(persist).not.toHaveBeenCalled();
      expect(externalNotify).not.toHaveBeenCalled();
      await expect(historyStorage.getItem(fileHash(bytes))).resolves.toBeNull();
      expect(useHistoryStore.getState().error).toBeNull();

      if (failureKind === 'unreadable') controls.restoreExists(firstUri);
      const retry = monitor.triggerCheck();
      await jest.advanceTimersByTimeAsync(0);
      await retry;
      await jest.advanceTimersByTimeAsync(300);
      await Promise.all(persistence);

      expect(persist).toHaveBeenCalledTimes(1);
      expect(externalNotify).toHaveBeenCalledTimes(1);
      expect(externalNotify).toHaveBeenCalledWith(persist.mock.calls[0][0]);
      if (failureKind === 'deleted') {
        expect(persist.mock.calls[0][0].fileUri).not.toBe(firstUri);
        expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
      } else {
        expect(persist.mock.calls[0][0].fileUri).toBe(firstUri);
        expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
      }
      const stored = await historyStorage.getItem(fileHash(bytes));
      expect(stored?.isDeleted).toBe(false);
      expect(readFileSync(fileURLToPath(stored!.fileUri!))).toEqual(bytes);
      monitor.stop();
    }
  );

  it('does not let a persisted dropped hash suppress the same file after restart', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const bytes = Buffer.from('same native file after monitor restart');
    const copies: NativeClipboardFile[] = [];
    mockSaveFileToFileAsync.mockImplementation(async () => {
      const copy = nativeClipboardFile(bytes);
      copies.push(copy);
      return copy;
    });
    const firstMonitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    await firstMonitor.start();
    const firstCheck = firstMonitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await firstCheck;
    rmSync(fileURLToPath(copies[0].filePath));
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    firstMonitor.stop();

    expect(asyncStorageValues.size).toBe(0);

    const restartedMonitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    const persistence: Promise<void>[] = [];
    const persist = jest.fn((content: ClipboardContent) => {
      persistence.push(
        useHistoryStore
          .getState()
          .addItem(historyItemFromContent(content), { throwOnFailure: true })
      );
    });
    restartedMonitor.addCallback(persist);
    await restartedMonitor.start();
    const retry = restartedMonitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await retry;
    await jest.advanceTimersByTimeAsync(300);
    await Promise.all(persistence);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].fileUri).not.toBe(copies[0].filePath);
    const stored = await historyStorage.getItem(fileHash(bytes));
    expect(readFileSync(fileURLToPath(stored!.fileUri!))).toEqual(bytes);
    restartedMonitor.stop();
  });

  it('does not clear newer clipboard state when an older deferred file is dropped', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const bytes = Buffer.from('older deferred file');
    let copiedFile: NativeClipboardFile | null = null;
    mockSaveFileToFileAsync.mockImplementationOnce(async () => {
      copiedFile = nativeClipboardFile(bytes);
      return copiedFile;
    });
    const monitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    await monitor.start();
    const check = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await check;

    const newerContent: ClipboardContent = {
      type: 'Text',
      text: 'newer clipboard content',
      profileHash: 'NEWER_CONTENT',
      localClipboardHash: 'NEWER_CONTENT',
      timestamp: freshTime + 1,
    };
    await monitor.setLastContent(newerContent);
    rmSync(fileURLToPath(copiedFile!.filePath));
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    monitor.stop();

    expect([...asyncStorageValues.values()]).toEqual([
      JSON.stringify({
        localClipboardHash: 'NEWER_CONTENT',
        profileHash: 'NEWER_CONTENT',
        type: 'Text',
      }),
    ]);
    const restartedMonitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    await restartedMonitor.start();
    await expect(restartedMonitor.checkAndUpdateLastContent(newerContent)).resolves.toBe(false);
    restartedMonitor.stop();
  });

  it('rechecks newer clipboard state after an asynchronous history lookup', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    const bytes = Buffer.from('native temp whose lookup races a newer clipboard value');
    let copiedFile: NativeClipboardFile | null = null;
    mockSaveFileToFileAsync.mockImplementationOnce(async () => {
      copiedFile = nativeClipboardFile(bytes);
      return copiedFile;
    });

    jest.useFakeTimers({ doNotFake: ['Date'] });
    const monitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    await monitor.start();
    const check = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await check;
    rmSync(fileURLToPath(copiedFile!.filePath));

    const db = await getDatabase();
    const originalGetFirst = db.getFirstAsync.bind(db);
    let enterLookup!: () => void;
    let releaseLookup!: () => void;
    let finishLookup!: () => void;
    const lookupEntered = new Promise<void>((resolve) => { enterLookup = resolve; });
    const lookupWait = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const lookupFinished = new Promise<void>((resolve) => { finishLookup = resolve; });
    jest.spyOn(db, 'getFirstAsync').mockImplementation(async (source, ...params) => {
      enterLookup();
      await lookupWait;
      const result = await originalGetFirst(source, ...params);
      finishLookup();
      return result;
    });

    const debounce = jest.advanceTimersByTimeAsync(300);
    await lookupEntered;
    const newerContent: ClipboardContent = {
      type: 'Text',
      text: 'wins while dropped history is being classified',
      profileHash: 'ASYNC_LOOKUP_WINNER',
      localClipboardHash: 'ASYNC_LOOKUP_WINNER',
      timestamp: freshTime + 2,
    };
    await monitor.setLastContent(newerContent);
    releaseLookup();
    await lookupFinished;
    await debounce;
    await Promise.resolve();

    expect([...asyncStorageValues.values()]).toEqual([
      JSON.stringify({
        localClipboardHash: 'ASYNC_LOOKUP_WINNER',
        profileHash: 'ASYNC_LOOKUP_WINNER',
        type: 'Text',
      }),
    ]);
    await expect(monitor.checkAndUpdateLastContent(newerContent)).resolves.toBe(false);
    monitor.stop();
  });

  it('keeps an active history watermark terminal when its payload disappears', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    const bytes = Buffer.from('active history payload restored from the native provider');
    mockSaveFileToFileAsync.mockImplementation(async () => nativeClipboardFile(bytes));
    const manager = new ClipboardManager();
    const nativeContent = (await manager.getClipboardContent())!;
    const firstStored = await historyStorage.addItem(historyItemFromContent(nativeContent));

    jest.useFakeTimers({ doNotFake: ['Date'] });
    const monitor = new ClipboardMonitor(manager, {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    const callback = jest.fn();
    monitor.addCallback(callback);
    await monitor.start();
    const check = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await check;
    rmSync(fileURLToPath(firstStored.fileUri!));
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
    expect((await historyStorage.getItem(firstStored.profileHash))?.isDeleted).toBe(false);

    const retry = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await retry;
    await jest.advanceTimersByTimeAsync(300);

    expect(callback).not.toHaveBeenCalled();
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
    await expect(historyStorage.getItem(firstStored.profileHash)).resolves.toMatchObject({
      isDeleted: false,
    });
    expect(existsSync(fileURLToPath(firstStored.fileUri!))).toBe(false);
    monitor.stop();
  });

  it('keeps a tombstone terminal even when the dropped URI is a native temp file', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    const bytes = Buffer.from('temp copy whose matching history row was deleted');
    const hash = fileHash(bytes);
    const seeded = await historyStorage.addItem(createDefaultClipboardItem({
      type: 'File',
      text: 'deleted.log',
      profileHash: hash,
      localClipboardHash: hash,
      hasData: true,
      dataName: 'deleted.log',
      size: bytes.length,
      fileUri: sourceFile(hash, 'deleted.log', bytes),
    }));
    await historyStorage.softDeleteItem(seeded.profileHash);
    const copies: NativeClipboardFile[] = [];
    mockSaveFileToFileAsync.mockImplementation(async () => {
      const copy = nativeClipboardFile(bytes, 'deleted.log');
      copies.push(copy);
      return copy;
    });

    jest.useFakeTimers({ doNotFake: ['Date'] });
    const monitor = new ClipboardMonitor(new ClipboardManager(), {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    const callback = jest.fn();
    monitor.addCallback(callback);
    await monitor.start();
    const check = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await check;
    rmSync(fileURLToPath(copies[0].filePath));
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    const retry = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await retry;
    await jest.advanceTimersByTimeAsync(300);

    expect(callback).not.toHaveBeenCalled();
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
    await expect(historyStorage.getItem(hash)).resolves.toMatchObject({ isDeleted: true });
    monitor.stop();
  });

  it('does not revive a file deleted from history during the debounce window', async () => {
    const { ClipboardMonitor } = require('../features/clipboard/internal/clipboardMonitor') as
      typeof import('../features/clipboard/internal/clipboardMonitor');
    const bytes = Buffer.from('history payload deleted by the user');
    mockSaveFileToFileAsync.mockImplementation(async () => nativeClipboardFile(bytes));
    const manager = new ClipboardManager();
    const nativeContent = (await manager.getClipboardContent())!;
    const stored = await historyStorage.addItem(historyItemFromContent(nativeContent));
    expect(readFileSync(fileURLToPath(stored.fileUri!))).toEqual(bytes);

    jest.useFakeTimers({ doNotFake: ['Date'] });
    const monitor = new ClipboardMonitor(manager, {
      pollingInterval: 60_000,
      debounceDelay: 300,
      stopOnBackground: false,
    });
    const callback = jest.fn();
    monitor.addCallback(callback);
    await monitor.start();
    const check = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await check;
    await historyStorage.softDeleteItem(stored.profileHash);
    await jest.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
    const retry = monitor.triggerCheck();
    await jest.advanceTimersByTimeAsync(0);
    await retry;
    await jest.advanceTimersByTimeAsync(300);

    expect(callback).not.toHaveBeenCalled();
    await expect(historyStorage.getItem(stored.profileHash)).resolves.toMatchObject({
      isDeleted: true,
    });
    expect(existsSync(fileURLToPath(stored.fileUri!))).toBe(false);
    monitor.stop();
  });
});
