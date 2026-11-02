// Regression replay of the real iOS Share sheet and controller.
// Failure modes: native dismissal disabled; close ignored while sending; later jobs
// dispatched after close; late results overwrite a reopened session; duplicate close;
// completed sends stopped; late results close a new session; stopped
// imports still dispatch; queue payloads removed before shutdown; stop rejection
// leaves the sheet open; unconfirmed sends keep running after dismissal; a new
// send fails after stop or restarts the adapter before shutdown finishes.
// Native views, storage and transport are controlled boundaries. This is not a device E2E.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const root = path.resolve(__dirname, '../..');
const resolve = Module._resolveFilename;
const load = Module._load;
global.IS_REACT_ACT_ENVIRONMENT = true;
Module._resolveFilename = function (name, parent, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args);
};
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, file);
}
const state = { devices: [{ deviceId: 'target', displayName: 'Test device', isLocal: false }], hasResolvedDeviceList: true, status: 'ready' };
const spaceStore = (select) => select(state);
spaceStore.getState = () => state;
const t = (key) => key;
const lan = { servers: [], refresh: async () => {}, isRefreshing: false };
const events = [];
let current;
let send;
let stop = async () => {};
let importFile;
let queued = [];
const adapter = {
  id: 'p2p',
  start: async () => { events.push('start'); },
  subscribe: () => () => {},
  sendImportedAsset: (...args) => { events.push('send'); return send(...args); },
  stop: async () => { events.push('stop'); await stop(); },
};
let sync;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const hostView = (name) => name;
Module._load = function (name, parent, ...args) {
  if (name === 'react-native') return { StyleSheet: { create: (s) => s }, Easing: { bezier: () => () => 0 }, Alert: { alert: () => events.push('alert') } };
  if (name === '@expo/ui/swift-ui') return new Proxy({}, { get: (_, key) => {
    if (key === 'Background') {
      const Background = (props) => React.createElement('Background', props);
      Background.Content = hostView('Background.Content');
      return Background;
    }
    return hostView(key);
  } });
  if (name === '@expo/ui/swift-ui/modifiers') return new Proxy({}, { get: (_, key) => key === 'shapes' ? { rectangle: () => ({}), roundedRectangle: () => ({}) } : (...args) => ({ name: key, args }) });
  if (name === '@/components/ui') return { IosSheetForm: 'Form', SheetHeader: 'Header' };
  if (name === '@/components/ReceiveResultsSheet') return { OutboundResultsSection: 'Results' };
  if (name === '@/components/ui/iosButtonStyles.ios') return { iosProminentButtonModifiers: () => [], iosSecondaryButtonModifiers: () => [], iosSaturatedButtonPalette: () => ({}) };
  if (name === '@/theme/iosDesignTokens') return { iosColors: {}, iosKindTints: {} };
  if (name === '@/hooks/useTheme') return { useTheme: () => ({ theme: { colors: { infoContainer: '#000', successContainer: '#000', warningContainer: '#000', success: '#000', warning: '#000' } } }) };
  if (name === 'expo-haptics') return { notificationAsync: async () => { events.push('haptic'); }, NotificationFeedbackType: { Success: 'success' } };
  if (name === 'expo-file-system') return { File: class {} };
  if (name === 'react-i18next') return { useTranslation: () => ({ t }) };
  if (name === 'app-group-store') return { recordShareDiagnosticStage: async () => {} };
  if (name === '@/platform/engine') return { getUnifiedEngineService: () => ({ refreshOutboundProgress: async () => {} }) };
  if (name === '@/features/space') return { useUnifiedSpaceStore: spaceStore, getUnifiedSpaceService: () => ({ refreshDevices: async () => {}, refresh: async () => {} }) };
  if (name === '@/features/settings') return { useSettingsStore: (select) => select({ config: { syncChannel: 'p2p' } }) };
  if (name === '@/features/sync') return { getUnifiedSyncRuntime: () => sync };
  if (name === '@/features/transfer') return { p2pDeliveryStateFromResend: () => 'pending', getOutboundShareHandoffManager: () => ({ completeJob: async () => events.push('complete'), claimPending: async () => queued }), createPendingShareStore: () => ({ cleanup: async () => {} }) };
  if (name === '@/app/runtime/composition') return { getAppRuntime: () => ({ ensureStarted: async () => {} }) };
  if (name === '@/support/observability') return { createLogger: () => ({ warn: () => {}, error: () => {} }) };
  if (name === '@/utils/uploadFile') return { importFileToHistory: (...args) => importFile(...args) };
  if (name === '../useLanMySpaceSheet') return { useLanMySpaceSheet: () => lan };
  const result = load.call(this, name, parent, ...args);
  if (name === './useShareSendController') return { ...result, useShareSendController: (...args) => { current = result.useShareSendController(...args); return current; } };
  return result;
};
const { ShareSendSheet } = require('../../src/components/ShareSendSheet/ShareSendSheet.ios.tsx');
const { UnifiedSyncRuntime } = require('../../src/features/sync/internal/unifiedSyncRuntime.ts');
sync = new UnifiedSyncRuntime([adapter], 'p2p');
const job = (id) => ({ id, kind: 'file', fileUri: 'controlled://file', displayName: id, byteCount: 1, historyProfileHash: 'test-profile', createdAtMs: Date.now() });
const checks = [];
async function mount(jobs) {
  let tree;
  const onClose = () => events.push('close');
  const render = (visible) => React.createElement(ShareSendSheet, { visible, onClose, jobs });
  await renderer.act(async () => { tree = renderer.create(render(true)); });
  return {
    tree,
    show: async (visible) => renderer.act(async () => tree.update(render(visible))),
    dismiss: () => tree.root.findByType('BottomSheet').props.onIsPresentedChange(false),
  };
}
(async () => {
  await sync.start({ appVersion: 'test', profileId: 'test', policy: { appState: 'active', backgroundSyncEnabled: false } });
  const pending = deferred();
  send = () => pending.promise;
  const first = await mount([job('first'), job('second')]);
  let sending;
  await renderer.act(async () => { sending = current.sendAll(); });
  assert.equal(current.isSending, true);
  const group = first.tree.root.findByType('Group');
  assert.equal(group.props.modifiers.some((m) => m.name === 'interactiveDismissDisabled' && m.args[0]), false, 'native drag dismissal is disabled during send');
  await renderer.act(async () => { first.dismiss(); first.dismiss(); });
  assert.equal(events.filter((e) => e === 'close').length, 1, 'dismiss must close immediately and only once');
  assert.equal(events.filter((e) => e === 'stop').length, 1, 'active transfer must stop the runtime exactly once');
  assert.equal(sync.getSnapshot().status, 'idle');
  checks.push('native dismissal enabled; active send closes immediately; duplicate callback ignored');
  await first.show(false);
  await first.show(true);
  pending.resolve({ entryId: 'old-entry', transport: 'p2p', success: true, state: 'delivered' });
  await renderer.act(async () => { await sending; });
  assert.equal(events.filter((e) => e === 'send').length, 1, 'closed session sent another file');
  assert.equal(current.phase.kind, 'ready', 'late completion overwrote reopened session');
  assert.equal(current.jobViews[0].sendState, 'idle');
  await renderer.act(async () => { await new Promise((done) => setTimeout(done, 650)); });
  assert.equal(events.filter((e) => e === 'close').length, 1, 'late result closed reopened sheet');
  checks.push('later jobs blocked; late completion cannot modify or close reopened session');
  await renderer.act(async () => first.tree.unmount());
  events.length = 0;
  send = async () => ({ entryId: 'done-entry', transport: 'p2p', success: true, state: 'delivered' });
  const completed = await mount([job('completed')]);
  await renderer.act(async () => { await current.sendAll(); });
  assert.equal(current.isDone, true);
  await renderer.act(async () => completed.dismiss());
  assert.equal(events.filter((e) => e === 'stop').length, 0, 'completed transfer was stopped');
  assert.equal(events.filter((e) => e === 'close').length, 1);
  checks.push('completed transfer remains open until explicit dismissal and is not stopped');
  await renderer.act(async () => completed.tree.unmount());
  events.length = 0;
  send = async () => ({ entryId: 'unconfirmed-entry', transport: 'p2p', success: false, state: 'pending' });
  const unconfirmed = await mount([job('unconfirmed')]);
  await renderer.act(async () => { await current.sendAll(); });
  assert.equal(current.isSending, false);
  await renderer.act(async () => unconfirmed.dismiss());
  assert.equal(events.filter((e) => e === 'stop').length, 1, 'pending remote delivery must stop even after the UI wait ends');
  await renderer.act(async () => unconfirmed.tree.unmount());
  checks.push('unconfirmed remote delivery stops after the UI wait ends');
  events.length = 0;
  const importing = deferred();
  importFile = () => importing.promise;
  const source = job('importing');
  delete source.historyProfileHash;
  const importingSheet = await mount([source]);
  await renderer.act(async () => { sending = current.sendAll(); });
  await renderer.act(async () => importingSheet.dismiss());
  importing.resolve({ fileUri: 'controlled://imported', fileName: 'imported', profileHash: 'imported-profile' });
  await renderer.act(async () => { await sending; });
  assert.equal(events.filter((e) => e === 'send').length, 0, 'import completion started a transfer after dismissal');
  assert.equal(events.filter((e) => e === 'stop').length, 1);
  await renderer.act(async () => importingSheet.tree.unmount());
  checks.push('dismiss during import stops the runtime and blocks dispatch');
  events.length = 0;
  const shutdown = deferred();
  const transfer = deferred();
  stop = () => shutdown.promise;
  send = () => transfer.promise;
  queued = [job('queued')];
  const queuedSheet = await mount(undefined);
  await renderer.act(async () => { sending = current.sendAll(); });
  await renderer.act(async () => queuedSheet.dismiss());
  assert.equal(events.filter((e) => e === 'close').length, 1, 'close waited for shutdown');
  assert.equal(events.filter((e) => e === 'complete').length, 0, 'payload removed before runtime shutdown');
  shutdown.resolve();
  await renderer.act(async () => { await shutdown.promise; });
  assert.equal(events.filter((e) => e === 'complete').length, 1);
  transfer.resolve({ entryId: 'queued-entry', transport: 'p2p', success: false, state: 'failed' });
  await renderer.act(async () => { await sending; });
  await renderer.act(async () => queuedSheet.tree.unmount());
  checks.push('sheet closes before shutdown; queue cleanup waits for successful shutdown');
  events.length = 0;
  stop = async () => { throw new Error('Controlled stop failure'); };
  const rejectedSheet = await mount(undefined);
  const rejectedTransfer = deferred();
  send = () => rejectedTransfer.promise;
  await renderer.act(async () => { sending = current.sendAll(); });
  await renderer.act(async () => rejectedSheet.dismiss());
  assert.equal(events.filter((e) => e === 'close').length, 1);
  assert.equal(events.filter((e) => e === 'complete').length, 0, 'failed shutdown removed an in-use payload');
  rejectedTransfer.resolve({ entryId: 'rejected-entry', transport: 'p2p', success: false, state: 'failed' });
  await renderer.act(async () => { await sending; });
  await renderer.act(async () => rejectedSheet.tree.unmount());
  checks.push('stop rejection is handled; sheet closes and in-use payload remains');
  events.length = 0;
  stop = async () => {};
  const stopping = deferred();
  adapter.stop = async () => { events.push('stop'); await stopping.promise; };
  const runtimeStop = sync.stop();
  const recovering = await mount([job('recovering')]);
  send = async () => ({ entryId: 'recovered-entry', success: true, state: 'delivered' });
  await renderer.act(async () => { sending = current.sendAll(); });
  assert.equal(events.includes('send'), false, 'new transfer started before shutdown finished');
  assert.equal(events.includes('start'), false, 'runtime restarted before shutdown finished');
  stopping.resolve();
  await renderer.act(async () => { await runtimeStop; await sending; });
  assert.equal(events.filter((e) => e === 'start').length, 1);
  assert.equal(events.filter((e) => e === 'send').length, 1);
  assert.equal(sync.getSnapshot().status, 'ready');
  assert.equal(current.isDone, true);
  await renderer.act(async () => recovering.dismiss());
  await renderer.act(async () => recovering.tree.unmount());
  checks.push('new send waits for shutdown and restarts the runtime with the existing context');
  const output = process.argv[2] || path.join(root, 'e2e/results/share-dismissal/replay.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const sourceHashes = Object.fromEntries([
    'src/components/ShareSendSheet/ShareSendSheet.ios.tsx',
    'src/components/ShareSendSheet/useShareSendController.ts',
    'src/features/sync/internal/unifiedSyncRuntime.ts',
    'e2e/share-dismissal/run.cjs',
  ].map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  fs.writeFileSync(output, JSON.stringify({ passed: true, command: 'node e2e/share-dismissal/run.cjs', sourceHashes, scope: 'Real iOS sheet, Share controller and UnifiedSyncRuntime; controlled native views and adapter. No native gesture or network acceptance.', checks }, null, 2) + '\n');
  console.log(`Share dismissal replay passed: ${output}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
