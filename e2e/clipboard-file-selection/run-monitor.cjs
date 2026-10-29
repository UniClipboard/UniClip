#!/usr/bin/env node
// Controlled JS chain. ClipboardManager, OS events, storage, and Engine are doubles.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv[2]);
const ts = require(require.resolve('typescript', { paths: [process.env.UC_REPLAY_NODE_MODULES || root] }));
fs.mkdirSync(output, { recursive: true });
const results = [];
const hashes = {};
function load(relative, mocks) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  hashes[relative] = crypto.createHash('sha256').update(source).digest('hex');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (!(name in mocks)) throw Error(`Unspecified boundary: ${name}`);
    return mocks[name];
  }, console }, { filename: file });
  return module.exports;
}
async function scenario(platform, mode, appState) {
  const timers = new Map();
  let count = 10;
  let content = null;
  let event;
  const observations = [];
  const settings = { config: { autoPushLocal: true }, isTempDisabledBackgroundTasks: false };
  const logger = { info() {}, debug() {}, warn() {}, error() {} };
  const rn = { Platform: { OS: platform }, AppState: { currentState: appState, addEventListener: () => ({ remove() {} }) } };
  const shared = {
    'react-native': rn,
    '@/features/settings': { useSettingsStore: { getState: () => settings } },
    '@/utils/syncDirectionPolicy': { canAutoPushInBackground: () => true },
    '@/platform/network': { getCurrentNetworkContext: () => ({}) },
    '@/support/observability': { createLogger: () => logger },
  };
  const observer = load('src/features/transfer/internal/clipboardObserver.ts', shared);
  observer.configureClipboardObserver(async (value, dispatch) => { observations.push({ text: value.text, dispatch }); return null; });
  const manager = { getClipboardContent: async () => content, buildTextContent: async text => ({ type: 'Text', text }), resetLastProfileHash() {} };
  const adapter = { startMonitoring: async callback => { event = callback; return { remove() {} }; } };
  const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const monitorModule = load('src/features/clipboard/internal/clipboardMonitor.ts', {
    ...shared,
    '@react-native-async-storage/async-storage': storage,
    './clipboardManager': { clipboardManager: manager },
    'native-timer': { setTimer: (callback, delay, tag) => { timers.set(tag, callback); return tag; }, clearTimer: tag => timers.delete(tag) },
    'app-group-store': { getPasteboardChangeCount: () => count },
    'expo-file-system': { File: class { constructor() { this.exists = true; } } },
    '@/utils/clipboardProxy': { hasStringAsync: async () => false, hasImageAsync: async () => false },
    '@/utils/androidBackgroundClipboardAccess': { getBackgroundClipboardAdapter: () => mode === 'event' ? adapter : null },
    '@/features/history': { historyStorage: {} },
    '@/platform/files': { CLIPBOARD_TEMP_DIR: 'file:///isolated' },
  });
  const monitor = new monitorModule.ClipboardMonitor(manager);
  monitor.addCallback(value => void observer.notifyDeviceClipboardChanged(value));
  await monitor.start();
  // Deliver synthetic clipboard generations through real monitor/observer methods.
  async function deliver(text) {
    count++;
    content = { type: 'Text', text };
    if (mode === 'event') {
      event({ type: 'text', content: text });
      await new Promise(setImmediate);
    } else await monitor.checkClipboard();
    const debounce = timers.get('clipboard_monitor_debounce');
    if (debounce) debounce();
    await new Promise(setImmediate);
  }
  await deliver('/sender/private/path.txt');
  await deliver('genuine subsequent user copy');
  assert.equal(observations.length, 2);
  assert.equal(observations[0].text, '/sender/private/path.txt');
  assert.equal(observations[1].text, 'genuine subsequent user copy');
  assert.ok(observations.every(value => value.dispatch));
  await deliver('genuine subsequent user copy');
  assert.equal(observations.length, 3, 'a new user copy must not be discarded solely because its content is unchanged');
  results.push({ platform, mode, appState, jsMonitorForwardsNativeWriteWhenReadable: true, nextDifferentUserCopyForwarded: true, engineAttribution: 'not simulated here', observations });
  monitor.stop();
}
(async () => {
  for (const [platform, mode] of [['ios', 'poll'], ['android', 'poll'], ['android', 'event']]) {
    for (const state of ['active', 'background']) await scenario(platform, mode, state);
  }
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ scope: 'Controlled JS monitor -> observer; synthetic OS reads/events; Engine excluded. Does not prove echo suppression.', results, sha256: hashes }, null, 2) + '\n');
  console.log(`JS_CHAIN_PASS scenarios=${results.length}; native-write receipt gap reproduced; next different user text forwarded`);
})().catch(error => { console.error(error); process.exitCode = 1; });
