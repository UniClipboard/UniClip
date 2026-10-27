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
import { TABLE_HISTORY, withDatabase } from '../platform/database';
import { LanRemoteContentApplier } from '../features/lan-sync/internal/lanRemoteContentApplier';
import { historyStorage, useHistoryStore } from '../features/history';
import {
  type ClipboardContent,
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
  const copyGates = new Map<string, ReturnType<typeof makeGate>>();
  const copyFailures = new Set<string>();
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

    async copy(target: FakeFile): Promise<void> {
      const gate = copyGates.get(this.uri);
      gate?.enter();
      await gate?.wait;
      fs.copyFileSync(this.path, target.path);
      if (copyFailures.has(this.uri)) throw new Error('Synthetic copy failure');
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
    blockCopy(uri: string) { const gate = makeGate(); copyGates.set(uri, gate); return gate; },
    failCopy(uri: string) { copyFailures.add(uri); },
    reset() {
      copyGates.clear();
      copyFailures.clear();
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

jest.mock('@/platform/files', () => jest.requireActual('@/platform/files/fileStorage.android'));
let mockLimit = 10;
const mockSettingsState = { config: { clipboardAccessMethod: 'overlay-polling', syncChannel: 'lan' }, isTempDisabledBackgroundTasks: false };
jest.mock('../features/settings', () => ({
  configStorage: { getConfig: async () => ({ maxHistoryItems: mockLimit }) },
  useSettingsStore: Object.assign((selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState), { getState: () => mockSettingsState }),
}));

type FsControls = {
  fixtureRoot: string;
  blockCopy(uri: string): FsGate;
  failCopy(uri: string): void;
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
const originalPlatform = Platform.OS;
const clipboardSourceId = 'content://clipboard/current-file';
const asyncStorageValues = new Map<string, string>();
const asyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/** Hash real payload bytes for the persisted evidence. */
function fileHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
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

/** Stage synthetic receive bytes in the isolated cache. */
function sourceFile(profileHash: string, dataName: string, bytes: Buffer): string {
  const filePath = join(controls.fixtureRoot, 'cache', `${profileHash}-${dataName}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
  return pathToFileURL(filePath).href;
}

/** Build LAN input that uses the staged file and synthetic remote identity. */
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

/** Connect the production LAN receiver to the production history store. */
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

/** Bound a controlled file operation so a missing gate fails promptly. */
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

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});

beforeEach(async () => {
  controls.reset();
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
  await (await withDatabase(async (db) => db)).execAsync(`DELETE FROM ${TABLE_HISTORY}`);
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


import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useUndoableHistoryDelete } from '../screens/useUndoableHistoryDelete';
import { useShareSendController } from '../components/ShareSendSheet/useShareSendController';
import type { HistoryRow } from '../features/history/internal/rowMapper';
import type { ShowMessageOptions } from '../stores/messageStore';
import type { LanServerDraft } from '../features/lan-servers';
import type { LanClipboardDocument } from '../features/lan-sync/internal/lanHttpClient';
import { createHistorySendJob, createHistorySendJobs, releaseHistorySendJob } from '../utils/historySendJob';
import { UnifiedSyncRuntime } from '../features/sync/internal/unifiedSyncRuntime';
import { LanSyncAdapter } from '../features/lan-sync/internal/lanSyncAdapter';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30000);
let mockRuntime: UnifiedSyncRuntime;
jest.mock('@/features/sync', () => ({ getUnifiedSyncRuntime: () => mockRuntime }));
const mockT = (key: string) => key;
jest.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init() {} }, useTranslation: () => ({ t: mockT }) }));
const mockSpace = { devices: [], hasResolvedDeviceList: true, status: 'empty' };
jest.mock('@/features/space', () => ({ useUnifiedSpaceStore: Object.assign((s: (state: typeof mockSpace) => unknown) => s(mockSpace), { getState: () => mockSpace }) }));
jest.mock('@/components/useLanMySpaceSheet', () => ({ useLanMySpaceSheet: () => ({ servers: [{ id: 'peer', name: 'Synthetic peer', status: 'online', address: 'loopback' }], isRefreshing: false }) }));
jest.mock('@/app/runtime/composition', () => ({ getAppRuntime: () => ({ ensureStarted: async () => {} }) }));
jest.mock('@/utils/uploadFile', () => ({ importFileToHistory: () => { throw new Error('Unexpected import'); } }));
jest.mock('app-group-store', () => ({
  getContainerUrl: async () => null,
  recordShareDiagnosticStage: async () => {},
}));
jest.mock('expo-haptics', () => ({ NotificationFeedbackType: { Success: 'success' }, notificationAsync: async () => {} }));

const artifactRoot = join(process.cwd(), 'e2e/results/history-receipt-lifetime');
mkdirSync(artifactRoot, { recursive: true });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const bytesA = Buffer.from('Synthetic file A: identical bytes on each receipt.\n');
let receiveSequence = 0;
/** Receive synthetic content through the production LAN and persistence paths. */
async function receive(bytes: Buffer, name = 'A.log') {
  const hash = fileHash(bytes);
  await applier().value.apply({ ...remoteInput(hash, `${++receiveSequence}-${name}`, bytes), dataName: name, size: bytes.length });
  return (await historyStorage.getItem(hash))!;
}
/** Capture the current SQLite row and payload checksum. */
async function snapshot(label: string, hash: string) {
  const db = await withDatabase(async (db) => db);
  const row = await db.getFirstAsync<HistoryRow & { rowid: number }>(`SELECT rowid, * FROM ${TABLE_HISTORY} WHERE profileHash = ? COLLATE NOCASE`, hash);
  const item = await historyStorage.getItem(hash);
  const uri = item?.fileUri;
  return { label, at: Date.now(), row, fileExists: !!uri && existsSync(fileURLToPath(uri)), fileSha256: uri && existsSync(fileURLToPath(uri)) ? fileHash(readFileSync(fileURLToPath(uri))) : null };
}
/** Persist the observed timeline and a SQLite copy for repeatable inspection. */
async function saveEvidence(name: string, timeline: unknown[]) {
  writeFileSync(join(artifactRoot, `${name}.json`), JSON.stringify(timeline, null, 2));
  const path = join(artifactRoot, `${name}.sqlite`);
  rmSync(path, { force: true });
  await (await withDatabase(async (db) => db)).execAsync(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
}

for (let repetition = 1; repetition <= 3; repetition++) {
  for (const variant of ['eviction', 'no-eviction', 'undo'] as const) {
    it(`Undo ${variant} repeat ${repetition}`, async () => {
      mockLimit = 10;
      (historyStorage as unknown as { maxHistorySize: number }).maxHistorySize = 10;
      const timeline: unknown[] = [];
      const first = await receive(bytesA);
      timeline.push(await snapshot('initial receipt', first.profileHash));
      // Fill the UI-supported minimum limit before the user presses Delete.
      for (let i = 0; i < 9; i++) { await sleep(3); await receive(Buffer.from(`distinct filler ${i}`), `filler-${i}.log`); }
      let undo!: ReturnType<typeof useUndoableHistoryDelete>;
      let timeout: ReturnType<typeof setTimeout>;
      let options: ShowMessageOptions | undefined;
      let completed: Promise<void> = Promise.resolve();
      function UndoHarness() {
        undo = useUndoableHistoryDelete({
          mode: 'undo',
          deleteItems: (ids, versions) => {
            completed = useHistoryStore.getState().deleteItems(ids, versions);
            return completed;
          },
          showMessage: (_text, _type, opts) => {
            options = opts;
            timeout = setTimeout(() => opts?.onTimeout?.(), 6000);
          },
          messages: { deleted: 'Deleted', deletedCount: n => `${n} deleted`, undo: 'Undo' },
        });
        return null;
      }
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => { renderer = TestRenderer.create(<UndoHarness />); });
      const started = Date.now();
      await act(async () => { await undo.requestDelete([first], { announce: true }); });
      timeline.push({ label: 'UI requests deferred delete', at: Date.now(), pendingVersion: undo.pendingVersions.get(first.profileHash.toLowerCase()) });
      await act(async () => {
        await sleep(750);
        if (variant !== 'no-eviction') await receive(Buffer.from('distinct trigger B'), 'B.log');
        timeline.push(await snapshot('after B / before new A', first.profileHash));
        if (variant !== 'no-eviction') expect(await historyStorage.getItem(first.profileHash)).toBeNull();
        await sleep(750);
        const replacement = await receive(bytesA);
        timeline.push(await snapshot('new A before timeout', first.profileHash));
        expect(readFileSync(fileURLToPath(replacement.fileUri!))).toEqual(bytesA);
        if (variant !== 'no-eviction') expect(replacement.incarnationId).not.toBe(first.incarnationId);
        timeline.push({ label: 'new receipt filter', at: Date.now(), hiddenByPendingVersion: undo.pendingVersions.get(replacement.profileHash.toLowerCase())?.version === replacement.version && undo.pendingVersions.get(replacement.profileHash.toLowerCase())?.incarnationId === replacement.incarnationId });
        const pending = undo.pendingVersions.get(replacement.profileHash.toLowerCase());
        expect(pending?.version === replacement.version && pending?.incarnationId === replacement.incarnationId).toBe(false);
        if (variant === 'undo') { options?.action?.onPress(); clearTimeout(timeout); }
        await sleep(Math.max(0, 6250 - (Date.now() - started)));
        await completed;
      });
      const final = await snapshot('after original timeout', first.profileHash);
      timeline.push(final);
      await saveEvidence(`undo-${variant}-${repetition}`, timeline);
      expect(final.row?.isDeleted).toBe(0);
      expect(final.fileSha256).toBe(fileHash(bytesA));
      clearTimeout(timeout!);
      await act(async () => renderer.unmount());
      await saveEvidence(`undo-${variant}-${repetition}`, timeline);
    });
  }
  for (const replace of [false, true]) {
    it(`Send replacement=${replace} repeat ${repetition}`, async () => {
      const first = await receive(bytesA);
      const timeline: unknown[] = [await snapshot('initial receipt', first.profileHash)];
      const job = (await createHistorySendJob(first, 'file'))!;
      const reads: { at: number; uri?: string; document: LanClipboardDocument; sha256?: string; error?: string }[] = [];
      const server: LanServerDraft = { name: 'Synthetic peer', urls: ['http://127.0.0.1'], username: 'synthetic', password: 'synthetic', allowInsecureTls: false };
      const adapter = new LanSyncAdapter({
        getServer: async () => server, getServers: async () => [server],
        readClipboard: async () => null, applyRemoteContent: async () => {}, preparePayloadTempUri: () => '',
        client: {
          getClipboard: async () => null, downloadPayload: async () => '',
          putClipboard: async (_s, document, payload) => {
            const record: (typeof reads)[number] = { at: Date.now(), uri: payload?.uri, document };
            reads.push(record);
            try { const bytes = readFileSync(fileURLToPath(payload!.uri)); record.sha256 = fileHash(bytes); }
            catch (error) { record.error = (error as NodeJS.ErrnoException).code; throw error; }
            return { url: server.urls[0], contentId: 'synthetic-delivery' };
          },
        },
      });
      mockRuntime = new UnifiedSyncRuntime([adapter], 'lan');
      await mockRuntime.start({ appVersion: 'reproduction', profileId: 'synthetic', policy: { appState: 'inactive', backgroundSyncEnabled: false } });
      let controller!: ReturnType<typeof useShareSendController>;
      const jobs = [job];
      function SendHarness() { controller = useShareSendController(() => {}, true, jobs); return null; }
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => { renderer = TestRenderer.create(<SendHarness />); });
      expect(controller.canSend).toBe(true);
      timeline.push({ label: 'sheet ready', at: Date.now(), job, runtime: mockRuntime.getSnapshot() });
      if (replace) { await sleep(100); await receive(bytesA); }
      timeline.push(await snapshot('before press Send', first.profileHash));
      await act(async () => { await controller.sendAll(); });
      timeline.push({ label: 'Send result', at: Date.now(), phase: controller.phase, reads: [...reads] });
      if (controller.phase.kind !== 'done') throw new Error('Send did not finish');
      const result = controller.phase.results[0];
      expect(result.success).toBe(true);
      expect(reads[0].sha256).toBe(fileHash(bytesA));
      expect((await snapshot('live replacement', first.profileHash)).fileSha256).toBe(fileHash(bytesA));
      await act(async () => renderer.unmount());
      await mockRuntime.stop();
      releaseHistorySendJob(job);
      expect(existsSync(fileURLToPath(job.fileUri))).toBe(false);
      expect((await snapshot('history after job release', first.profileHash)).fileSha256).toBe(fileHash(bytesA));
      await saveEvidence(`send-${replace ? 'replacement' : 'control'}-${repetition}`, timeline);
    });
  }
}


it('keeps a snapshot valid while replacement waits for its copy', async () => {
  const first = await receive(bytesA);
  const gate = controls.blockCopy(first.fileUri!);
  const preparing = createHistorySendJob(first, 'file');
  await waitForGate(gate);
  let received = false;
  const replacing = receive(bytesA).then(item => { received = true; return item; });
  await sleep(50);
  expect(received).toBe(false);
  gate.release();
  const job = (await preparing)!;
  const replacement = await replacing;
  expect(job.fileUri).not.toBe(first.fileUri);
  expect(readFileSync(fileURLToPath(job.fileUri))).toEqual(bytesA);
  expect(readFileSync(fileURLToPath(replacement.fileUri!))).toEqual(bytesA);
  releaseHistorySendJob(job);
  await saveEvidence('snapshot-replacement-lock', [{ job, replacement }]);
});

it('gives each open Send job independent bytes and releases only its own file', async () => {
  const first = await receive(bytesA);
  const one = (await createHistorySendJob(first, 'file'))!;
  const two = (await createHistorySendJob(first, 'file'))!;
  expect(one.fileUri).not.toBe(two.fileUri);
  await historyStorage.physicalDeleteItem(first.profileHash);
  expect(readFileSync(fileURLToPath(one.fileUri))).toEqual(bytesA);
  expect(readFileSync(fileURLToPath(two.fileUri))).toEqual(bytesA);
  releaseHistorySendJob(one);
  expect(existsSync(fileURLToPath(one.fileUri))).toBe(false);
  expect(readFileSync(fileURLToPath(two.fileUri))).toEqual(bytesA);
  releaseHistorySendJob(two);
  releaseHistorySendJob(two);
  await saveEvidence('independent-snapshot-release', [{ one, two }]);
});

it('removes a partial snapshot after a failed copy without touching history', async () => {
  const first = await receive(bytesA);
  controls.failCopy(first.fileUri!);
  await expect(createHistorySendJob(first, 'file')).rejects.toThrow('Synthetic copy failure');
  const directory = join(controls.fixtureRoot, 'cache/temp_files/send_to');
  expect(readdirSync(directory)).toEqual([]);
  expect(readFileSync(fileURLToPath(first.fileUri!))).toEqual(bytesA);
  await saveEvidence('copy-failure-cleanup', [await snapshot('history survives copy failure', first.profileHash)]);
});

it('resolves the current row before snapshotting a stale card', async () => {
  const old = await receive(bytesA);
  const replacement = await receive(bytesA);
  expect(existsSync(fileURLToPath(old.fileUri!))).toBe(false);
  const job = (await createHistorySendJob(old, 'file'))!;
  expect(readFileSync(fileURLToPath(job.fileUri))).toEqual(bytesA);
  releaseHistorySendJob(job);
  expect(readFileSync(fileURLToPath(replacement.fileUri!))).toEqual(bytesA);
  await saveEvidence('stale-card-snapshot', [{ old, replacement, job }]);
});

it('upgrades v4 history without changing content and resumes an interrupted identity migration', async () => {
  const first = await receive(bytesA);
  const db = await withDatabase(async (db) => db);
  const before = await snapshot('before v4 migration', first.profileHash);
  await db.execAsync(`ALTER TABLE ${TABLE_HISTORY} DROP COLUMN incarnationId; PRAGMA user_version = 4;`);
  const sqlite = require('expo-sqlite');
  jest.doMock('expo-sqlite', () => ({ ...sqlite, openDatabaseAsync: async () => db }));
  let migrated!: HistoryRow & { rowid: number };
  await jest.isolateModulesAsync(async () => {
    const database = require('../platform/database/sqliteDatabase');
    const opened = await database.withDatabase(async (db: unknown) => db);
    migrated = await opened.getFirstAsync(`SELECT rowid, * FROM ${TABLE_HISTORY} WHERE profileHash = ?`, first.profileHash);
  });
  const previous = { ...before.row };
  delete previous.incarnationId;
  const { incarnationId: identity, ...remaining } = migrated;
  expect(remaining).toEqual(previous);
  expect(identity).toMatch(/^[a-f0-9]{32}$/);
  await db.execAsync('PRAGMA user_version = 4');
  await jest.isolateModulesAsync(async () => {
    const database = require('../platform/database/sqliteDatabase');
    const opened = await database.withDatabase(async (db: unknown) => db);
    expect((await opened.getFirstAsync(`SELECT incarnationId FROM ${TABLE_HISTORY} WHERE profileHash = ?`, first.profileHash)).incarnationId).toBe(identity);
    expect(await opened.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 5 });
  });
  await saveEvidence('v4-identity-migration', [before, migrated]);
});

// Failure modes: one copy fails while a sibling completes later; an expiry
// snapshot becomes stale after a receive revives the same history row.
it('releases every batch snapshot after one copy fails, including a late success', async () => {
  const first = await receive(bytesA);
  const second = await receive(Buffer.from('batch B'), 'B.log');
  const gate = controls.blockCopy(first.fileUri!);
  controls.failCopy(second.fileUri!);
  const copy = historyStorage.copyItemPayload.bind(historyStorage);
  let failed!: () => void;
  const failureObserved = new Promise<void>(resolve => { failed = resolve; });
  jest.spyOn(historyStorage, 'copyItemPayload').mockImplementation(async (hash, destination) => {
    try { return await copy(hash, destination); }
    catch (error) { failed(); throw error; }
  });
  const preparing = createHistorySendJobs([first, second]);
  const result = preparing.then(() => null, error => error);
  await waitForGate(gate);
  await failureObserved;
  gate.release();
  const error = await result;
  // Drain the successful sibling even when the old Promise.all rejects early.
  await historyStorage.copyItemPayload(first.profileHash, sourceFile('probe', 'copy', bytesA));
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('Synthetic copy failure');
  const remaining = readdirSync(join(controls.fixtureRoot, 'cache/temp_files/send_to'));
  await saveEvidence('batch-failure-cleanup', [{ remaining }, await snapshot('A survives', first.profileHash), await snapshot('B survives', second.profileHash)]);
  expect(remaining).toEqual([]);
  expect(readFileSync(fileURLToPath(first.fileUri!))).toEqual(bytesA);
});

it('skips an expired deletion after a receive revives the selected row', async () => {
  const first = await receive(bytesA);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 31 * 86400000);
  await historyStorage.softDeleteItem(first.profileHash);
  clock.mockRestore();
  const { historyRepository } = require('../features/history/internal/historyRepository');
  const original = historyRepository.getAll.bind(historyRepository);
  let selected!: () => void;
  let release!: () => void;
  const selectedPromise = new Promise<void>(resolve => { selected = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(historyRepository, 'getAll').mockImplementationOnce(async (...args: unknown[]) => {
    const rows = await original(...args);
    selected();
    await released;
    return rows;
  });
  const cleaning = historyStorage.cleanupExpiredSoftDeletes();
  await selectedPromise;
  const replacement = await receive(bytesA);
  release();
  const removed = await cleaning;
  const final = await snapshot('revived row after expiry cleanup', first.profileHash);
  await saveEvidence('expiry-revival-race', [{ removed, replacement }, final]);
  expect(removed).toBe(0);
  expect(final.row?.isDeleted).toBe(0);
  expect(final.fileSha256).toBe(fileHash(bytesA));
});

it('physically removes a still-expired tombstone', async () => {
  const first = await receive(bytesA);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 31 * 86400000);
  await historyStorage.softDeleteItem(first.profileHash);
  clock.mockRestore();
  expect(await historyStorage.cleanupExpiredSoftDeletes()).toBe(1);
  expect(await historyStorage.getItem(first.profileHash)).toBeNull();
  await saveEvidence('expiry-cleanup-control', [await snapshot('expired tombstone removed', first.profileHash)]);
});
