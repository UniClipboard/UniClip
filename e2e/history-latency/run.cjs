// Product flow replay with real files, JS SHA-256, SQLite, store, and React hooks.
// Expo/native clipboard, startup, and screen presentation remain controlled boundaries.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv[2] || path.join(root, 'e2e/results/history-latency'));
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'verdict.json'), { force: true });
const work = fs.mkdtempSync(path.join(output, 'run-'));
const uri = value => pathToFileURL(value).href;
const diskPath = value => value.startsWith('file:') ? fileURLToPath(value) : value;
let clipboardUri, historyStorage, failCopy = false, failCommit = false, failImport = false, focused = true;
let logFails = false;
const traceLines = [], checks = [], timers = new Map(), frames = new Map(), appListeners = new Set();
let nextFrame = 0;
global.__DEV__ = false;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
global.cancelAnimationFrame = id => frames.delete(id);
const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); };
const appState = { currentState: 'active', addEventListener: (_, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } };
class File {
  constructor(...parts) { this.uri = uri(path.join(...parts.map(value => diskPath(typeof value === 'string' ? value : value.uri)))); }
  get exists() { return fs.existsSync(diskPath(this.uri)); }
  get name() { return path.basename(diskPath(this.uri)); }
  get size() { return fs.statSync(diskPath(this.uri)).size; }
  get type() { return 'application/octet-stream'; }
  info() { return { exists: this.exists, size: this.size }; }
  copy(target) { if (failCopy) throw new Error('controlled-copy-failure'); fs.copyFileSync(diskPath(this.uri), diskPath(target.uri)); }
  move(target) { fs.renameSync(diskPath(this.uri), diskPath(target.uri)); this.uri = target.uri; }
  delete() { fs.rmSync(diskPath(this.uri), { force: true }); }
  async text() { return fs.readFileSync(diskPath(this.uri), 'utf8'); }
  write(bytes) { fs.writeFileSync(diskPath(this.uri), bytes); }
  open() { const descriptor = fs.openSync(diskPath(this.uri), 'r'); let offset = 0; return {
    readBytes(count) { const bytes = Buffer.alloc(count); const n = fs.readSync(descriptor, bytes, 0, count, offset); offset += n; return bytes.subarray(0, n); },
    close() { fs.closeSync(descriptor); },
  }; }
}
class Directory {
  constructor(...parts) { this.uri = uri(path.join(...parts.map(value => diskPath(typeof value === 'string' ? value : value.uri)))); }
  get exists() { return fs.existsSync(diskPath(this.uri)); }
  create() { fs.mkdirSync(diskPath(this.uri), { recursive: true }); }
}
const temp = new Directory(work, 'temp'); temp.create();
const payload = new Directory(work, 'shared-payload'); payload.create();
const database = new DatabaseSync(path.join(work, 'history.sqlite'));
const params = args => (Array.isArray(args[0]) ? args[0] : args);
const db = {
  async getFirstAsync(sql, ...args) { return database.prepare(sql).get(...params(args)) ?? null; },
  async getAllAsync(sql, ...args) { return database.prepare(sql).all(...params(args)); },
  async runAsync(sql, ...args) { if (failCommit && sql.startsWith('INSERT')) throw new Error('controlled-commit-failure'); return database.prepare(sql).run(...params(args)); },
};
const log = { info(...args) { if (logFails) throw new Error('controlled-log-failure'); if (String(args[0]).startsWith('history_latency ')) traceLines.push(String(args[0])); }, debug() {}, warn() {}, error() {} };
const asyncStore = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(name, parent, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args); };
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, file);
Module._load = function(name, parent, ...args) {
  if (name === 'react-native') return { View: 'View', Text: 'Text', ScrollView: 'ScrollView', StyleSheet: { create: styles => styles }, Platform: { OS: 'ios', Version: 'controlled' }, AppState: appState };
  if (name === '@shopify/flash-list') return { FlashList: 'FlashList' };
  if (name === 'react-native-reanimated') return { __esModule: true, default: { ScrollView: 'AnimatedScrollView' }, useSharedValue: value => ({ value }), useAnimatedScrollHandler: handlers => handlers };
  if (name === 'react-native-worklets') return { scheduleOnRN: (fn, ...args) => fn(...args) };
  if (name === './GridCell' && parent.filename.endsWith('AnimatedCardGrid.tsx')) return { GridCell: 'GridCell' };
  if (name === './HistoryListRow' && parent.filename.endsWith('HistoryList.tsx')) return { HistoryListRow: 'HistoryListRow', HistoryOpenRowProvider: 'Provider' };
  if (name === '@/hooks/useTheme') return { useTheme: () => ({ theme: { colors: { textPrimary: 'black', accent: 'blue' } } }) };
  if (name === '@react-navigation/native') return { useIsFocused: () => focused };
  if (name === 'expo-file-system') return { File, Directory, FileMode: { ReadOnly: 1 }, Paths: { cache: uri(work) } };
  if (name === 'expo-clipboard') return { getUrlAsync: async () => clipboardUri };
  if (name === 'expo-image-picker') return {};
  if (name === 'expo-application') return { nativeApplicationVersion: 'controlled-e2e', nativeBuildVersion: '1', applicationId: 'app.controlled.test' };
  if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
  if (name === 'android-util') return { isNativeHashModuleAvailable: false };
  if (name === 'uc-engine') return { prepareEngineDiagnosticExport: async () => { throw new Error('controlled-native-unavailable'); }, flushEngineLogs: async () => true, getEngineLogStatus: async () => ({}), coreVersion: () => 'controlled', getNativeDiagnostics: async () => null };
  if (name === '@/support/power/powerMetrics') return {};
  if (name === './networkLogCollection' && parent.filename.endsWith('diagnosticPackage.ts')) return { collectNetworkLogs: async () => ({ entries: {}, incomplete: false, manifest: { status: 'unsupported' } }) };
  if (name === '@/support/observability') return { createLogger: () => log, redactLogText: require('../../src/support/observability/internal/logRedaction.ts').redactLogText,
    flushAppLogs: async () => true, getAppLogCaptureStatus: () => ({ enabled: true, effectiveLevel: 'info' }), getAppLogFileUris: () => [uri(path.join(work, 'app.txt'))], getEngineLogFileUris: () => [] };
  if (name === '@/platform/database') return { TABLE_HISTORY: 'clipboard_history', withDatabase: operation => operation(db) };
  if (name === '@/platform/files') return { CLIPBOARD_TEMP_DIR: temp, prepareTempFilePath: name => uri(path.join(work, 'temp', name)), getHistoryFileDir: () => payload };
  if (name === '@/features/history') return { historyStorage };
  if (name === './appGroupHistoryImport') return {};
  if (name === '@react-native-async-storage/async-storage') return asyncStore;
  if (name === 'native-timer') return { setTimer: (callback, delay, tag) => { timers.set(tag, callback); return tag; }, clearTimer: tag => timers.delete(tag) };
  if (name === 'app-group-store') return { getPasteboardChangeCount: () => null, getAppGroupId: () => 'controlled', getShareDiagnostics: async () => null,
    importPayloadFile: async (id, source) => { if (failImport) throw new Error('controlled-import-failure'); const target = new File(payload, id); new File(source).copy(target); return target.uri; } };
  if (name === '@/utils/androidBackgroundClipboardAccess') return { getBackgroundClipboardAdapter: () => null };
  if (name === '@/platform/network') return {};
  if (name === '@/features/settings') return {};
  if (name === '@/utils/index') return require('../../src/utils/textUtils.ts');
  if (name === '@/i18n') return { t: key => key, language: 'en' };
  return load.call(this, name, parent, ...args);
};
const records = () => traceLines.map(line => JSON.parse(line.slice('history_latency '.length)));
async function check(name, operation) { await operation(); checks.push({ name, result: 'PASS' }); }
(async () => {
  const { HISTORY_COLUMNS } = require('../../src/features/history/internal/rowMapper.ts');
  database.exec(`CREATE TABLE clipboard_history (${HISTORY_COLUMNS.map(column => `"${column}" ${column === 'profileHash' ? 'TEXT PRIMARY KEY COLLATE NOCASE' : ''}`).join(', ')})`);
  ({ historyStorage } = require('../../src/features/history/internal/historyStorage.ts'));
  historyStorage.initialized = true; // Startup and migrations are outside this replay's native boundary.
  const { ClipboardManager } = require('../../src/features/clipboard/internal/clipboardManager.ts');
  const { ClipboardMonitor } = require('../../src/features/clipboard/internal/clipboardMonitor.ts');
  const { useHistoryStore } = require('../../src/features/history/store.ts');
  const { useHistoryViewability } = require('../../src/support/diagnostics/useHistoryViewability.ts');
  const latency = require('../../src/support/diagnostics/historyLatency.ts');
  const sourceId = 'b26446d6-69e6-4955-8d2a-14f1f73863fc';
  const source = new File(work, 'p2p/cache/iroh-blobs', sourceId, 'private-fixture.bin');
  fs.mkdirSync(path.dirname(diskPath(source.uri)), { recursive: true });
  const bytes = Buffer.alloc(80 * 1024 * 1024, 0x5a);
  fs.writeFileSync(diskPath(source.uri), bytes);
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  clipboardUri = source.uri;
  let reportVisible, tree, callbackCompletion;
  function Screen() { reportVisible = useHistoryViewability(); return null; }
  await act(async () => { tree = renderer.create(React.createElement(Screen)); });
  const manager = new ClipboardManager();
  const monitor = new ClipboardMonitor(manager);
  monitor.addCallback(content => { callbackCompletion = useHistoryStore.getState().addItem(require('../../src/types/clipboard.ts').createDefaultClipboardItem({ type: content.type, diagnosticReadId: content.diagnosticReadId, text: content.text, profileHash: content.profileHash, localClipboardHash: content.localClipboardHash, fileUri: content.fileUri, dataName: content.fileName, size: content.fileSize, timestamp: content.timestamp, hasData: true })); });
  await check('80 MiB clipboard -> real copy/hash -> debounce -> payload import -> SQLite -> store -> visible frame candidate -> archive', async () => {
    await monitor.checkClipboard();
    assert.equal(timers.size, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM clipboard_history').get().n, 0);
    [...timers.values()][0]();
    await callbackCompletion;
    const rows = database.prepare('SELECT * FROM clipboard_history').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].localClipboardHash, expectedHash);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(diskPath(rows[0].fileUri))).digest('hex').toUpperCase(), expectedHash);
    const items = useHistoryStore.getState().items;
    assert.equal(items.length, 1);
    await act(async () => { reportVisible(items); frame(); });
    const events = records();
    const stages = events.map(event => event.stage);
    for (const stage of ['source_copy', 'sha256', 'history_lookup', 'monitor_callback', 'payload_import', 'sqlite_commit', 'history_published', 'history_viewable', 'history_frame_candidate']) assert.ok(stages.includes(stage), stage);
    assert.ok(events.some(event => event.stage === 'file_identity' && event.sourceEntryId === sourceId));
    assert.ok(events.filter(event => event.sourceEntryId).every(event => event.sourceEntryId === sourceId));
    assert.equal(new Set(events.filter(event => event.readId).map(event => event.readId)).size, 1);
  });
  await check('background and unfocused screens cannot create frame candidates; pending frames cancel', async () => {
    const trace = latency.beginFileRead(); latency.bindFileRead(trace, 'OTHER');
    const item = { profileHash: 'OTHER', type: 'File' };
    await act(async () => { focused = false; tree.update(React.createElement(Screen)); });
    reportVisible([item]); frame(); assert.equal(trace.visible, undefined);
    await act(async () => { focused = true; tree.update(React.createElement(Screen)); });
    assert.ok(frames.size > 0);
    await act(async () => { appState.currentState = 'background'; appListeners.forEach(fn => fn('background')); });
    assert.equal(frames.size, 0); assert.equal(trace.visible, false);
    await act(async () => { appState.currentState = 'active'; appListeners.forEach(fn => fn('active')); });
    reportVisible([]); assert.equal(frames.size, 0);
  });
  await check('copy and import/commit failures retain a failed stage and do not claim a commit', async () => {
    failCopy = true;
    assert.equal(await new ClipboardManager().getClipboardContent(), null);
    failCopy = false;
    for (const stage of ['payload_import', 'sqlite_commit']) {
      const hash = crypto.randomBytes(32).toString('hex');
      const trace = latency.beginFileRead(); latency.bindFileRead(trace, hash);
      failImport = stage === 'payload_import'; failCommit = stage === 'sqlite_commit';
      await assert.rejects(historyStorage.addItem(require('../../src/types/clipboard.ts').createDefaultClipboardItem({ type: 'File', text: '', profileHash: hash, localClipboardHash: hash, hasData: true, fileUri: source.uri, dataName: 'fixture.bin', timestamp: Date.now() })));
      assert.equal(trace.committed, undefined);
      assert.ok(records().some(event => event.readId === trace.readId && event.stage === stage && event.outcome === 'failed'));
      failImport = failCommit = false;
    }
    assert.ok(records().some(event => event.stage === 'source_copy' && event.outcome === 'failed'));
  });
  await check('unmatched paths stay unmatched; diagnostics failures preserve product results', async () => {
    assert.equal(latency.beginFileRead('file:///private/user-file.bin').sourceEntryId, null);
    const trace = latency.beginFileRead(); logFails = true;
    assert.equal(await latency.measureHistoryStage('sha256', trace, async () => 42), 42);
    logFails = false;
  });
  await check('identical content keeps separate read IDs and an ambiguous reloaded row stays unmatched', async () => {
    const one = latency.beginFileRead(), two = latency.beginFileRead();
    latency.bindFileRead(one, 'SAME'); latency.bindFileRead(two, 'SAME');
    assert.equal(latency.fileReadTrace('SAME', one.readId), one);
    assert.equal(latency.fileReadTrace('SAME', two.readId), two);
    assert.equal(latency.fileReadTrace('SAME'), undefined);
  });
  await check('actual grid excludes overscan and both platform lists report only viewable data rows', async () => {
    const { AnimatedCardGrid } = require('../../src/components/AnimatedCardGrid.tsx');
    const items = Array.from({ length: 12 }, (_, index) => ({ profileHash: `grid-${index}`, timestamp: Date.now() }));
    let visibleItems, collection;
    await act(async () => { collection = renderer.create(React.createElement(AnimatedCardGrid, { items, numColumns: 1, cardSize: 100, spacing: 0, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, keyExtractor: item => item.profileHash, renderItem: () => null, onVisibleItemsChanged: value => { visibleItems = value; } })); });
    assert.deepEqual(visibleItems, []);
    await act(async () => collection.root.findByType('AnimatedScrollView').props.onLayout({ nativeEvent: { layout: { height: 100 } } }));
    assert.deepEqual(visibleItems.map(item => item.profileHash), ['grid-0']);
    assert.ok(collection.root.findAllByType('GridCell').length > visibleItems.length);
    await act(async () => collection.root.findByType('AnimatedScrollView').props.onScroll.onScroll({ contentOffset: { y: 500 } }));
    assert.deepEqual(visibleItems.map(item => item.profileHash), ['grid-5']);
    await act(async () => collection.unmount());
    for (const platform of ['ios', 'android']) {
      const { HistoryList } = require(`../../src/components/${platform}/HistoryList.tsx`);
      await act(async () => { collection = renderer.create(React.createElement(HistoryList, { items, keyExtractor: item => item.profileHash, selectedIds: new Set(), paddingTop: 0, paddingBottom: 0, density: 'compact', onVisibleItemsChanged: value => { visibleItems = value; } })); });
      const list = collection.root.findByType('FlashList');
      list.props.onViewableItemsChanged({ viewableItems: [{ item: { type: 'header' }, isViewable: true }, { item: { type: 'item', item: items[0] }, isViewable: true }, { item: { type: 'item', item: items[1] }, isViewable: false }] });
      assert.deepEqual(visibleItems, [items[0]]);
      await act(async () => collection.unmount());
    }
  });
  await check('sender report and settled snapshots stay separate and retain the Engine entry ID', async () => {
    const { OutboundDeliveryCoordinator } = require('../../src/features/transfer/internal/outboundDeliveryCoordinator.ts');
    const coordinator = new OutboundDeliveryCoordinator({ listDevices: async () => [{ deviceId: 'peer', isLocal: false }], subscribeEvents: () => () => {}, listOutboundProgress: async () => [{ entryId: 'sender-entry', targetDeviceId: 'peer', state: 'completed', itemsRunning: 0, itemsWaiting: 0, itemsUnconfirmed: 0, items: [] }] }, 1000);
    const result = await coordinator.run(async () => ({ entryId: 'sender-entry', totalAccepted: 1, totalDuplicate: 0, totalPending: 0 }));
    assert.equal(result.completed, 1);
    for (const stage of ['sender_report', 'sender_settled']) assert.ok(records().some(event => event.stage === stage && event.entryId === 'sender-entry'));
  });
  await check('archive keeps parseable stage records and analyzer reports missing evidence', async () => {
    fs.writeFileSync(path.join(work, 'app.txt'), traceLines.join('\n') + '\n');
    const { createDiagnosticArchive } = require('../../src/support/diagnostics/internal/diagnosticPackage.ts');
    const archive = await createDiagnosticArchive({ settings: { autoApplyRemote: true, autoPushLocal: true, attachmentAutoDownload: 'always', logLevel: 'info' }, sync: { status: 'stopped', peerConnectionStatus: 'offline', hasSpace: true, deviceCount: 0, lastErrorReason: null } });
    const zipPath = path.join(output, 'diagnostics.zip'); fs.copyFileSync(diskPath(archive.uri), zipPath);
    execFileSync(process.execPath, [path.join(root, 'scripts/analyze-history-latency.mjs'), zipPath, '--out', path.join(output, 'analysis')]);
    const summary = JSON.parse(fs.readFileSync(path.join(output, 'analysis/summary.json')));
    assert.equal(summary.recordCount, traceLines.length);
    assert.equal(summary.senderEvidencePresent, false);
    assert.ok(summary.reads.some(read => read.sourceEntryId === sourceId && read.missingEvidence.length === 0));
    const text = fs.readFileSync(path.join(output, 'analysis/timeline.jsonl'), 'utf8');
    for (const secret of [source.uri, 'private-fixture.bin', expectedHash]) assert.ok(!text.includes(secret));
  });
  await act(async () => tree.unmount());
  const changedFiles = execFileSync('git', ['ls-files', '-m', '-o', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const sourceFiles = Object.fromEntries(changedFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const workingDiffSha256 = crypto.createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex');
  const evidence = { schemaVersion: 1, workingDiffSha256, sourceFiles, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scope: 'controlled native boundaries; actual product TypeScript, real file copy, JS SHA-256, SQLite SQL, Zustand, React hook, diagnostic archive and analyzer', fixture: { bytes: bytes.length, sha256: expectedHash }, checks, nativeDevice: 'NOT RUN', displayPixels: 'NOT RUN' };
  fs.writeFileSync(path.join(output, 'verdict.json'), JSON.stringify(evidence, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'trace.jsonl'), records().map(record => JSON.stringify(record)).join('\n') + '\n');
  database.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, output }));
})().catch(error => { fs.writeFileSync(path.join(output, 'verdict.json'), JSON.stringify({ result: 'FAIL', checks, error: error.message }, null, 2) + '\n'); fs.writeFileSync(path.join(output, 'failure.txt'), error.stack + '\n'); console.error(error); process.exitCode = 1; });
