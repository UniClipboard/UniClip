// Replay actual Share controller, platform renderers, P2P content service, and delivery waiter.
// Native rendering and transport are controlled. This does not certify native hit testing.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.argv[2] || path.join(root, 'e2e/results/share-device-progress'));
const resolve = Module._resolveFilename, load = Module._load;
global.IS_REACT_ACT_ENVIRONMENT = true;
Module._resolveFilename = function(name, parent, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, file);
const strings = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/zh/share.json')));
const t = key => key.split('.').reduce((value, part) => value?.[part], strings) ?? key;
const deviceState = { devices: [{ deviceId: 'one', displayName: 'First device', isLocal: false }, { deviceId: 'two', displayName: 'Second device', isLocal: false }], hasResolvedDeviceList: true, status: 'ready' };
const spaceStore = selector => selector(deviceState); spaceStore.getState = () => deviceState;
let channel = 'p2p', sync, engine, current, tree, sheet, closed = 0, sends = 0, sequence = 0;
const listeners = new Set(), reconciliations = [], completedJobs = [];
let snapshots = [];
const modifiers = new Proxy({ shapes: new Proxy({}, { get: (_, name) => value => ({ name, value }) }) }, { get: (target, name) => target[name] || (value => ({ name, value })) });
const swift = new Proxy({}, { get: (_, name) => {
  if (name === 'Background') { const component = props => React.createElement('Background', props, props.children); component.Content = 'BackgroundContent'; return component; }
  return String(name);
} });
const colors = new Proxy({}, { get: (_, name) => String(name) });
const lan = { servers: [{ id: 'one', name: 'First server', status: 'online' }, { id: 'two', name: 'Second server', status: 'online' }], isRefreshing: false, refresh: async () => {} };
class LanUnknown extends Error {}
class LanUnavailable extends Error {}
let realDelivery;
Module._load = function(name, parent, ...args) {
  if (name === 'react-native') return { View: 'View', Text: 'Text', Image: 'RNImage', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', Alert: { alert() {} }, StyleSheet: { create: x => x } };
  if (name === 'react-i18next') return { useTranslation: () => ({ t }) };
  if (name === 'expo-haptics') return { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } };
  if (name === 'native-timer') return { setTimer: setInterval, clearTimer: clearInterval };
  if (name === '@/platform/files') return { prepareTempFilePath: name => `controlled://${name}` };
  if (name === './lanHttpClient' && parent.filename.endsWith('lanSyncAdapter.ts')) return { LanHttpClient: class {}, LanUnavailableError: LanUnavailable, LanDeliveryUnknownError: LanUnknown };
  if (name === 'expo-file-system') return { File: class { size = 100; async text() { return 'controlled text'; } } };
  if (name === 'app-group-store') return { recordShareDiagnosticStage: async () => {} };
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
  if (name === '@expo/vector-icons/Ionicons') return 'Icon';
  if (name === '@expo/ui/swift-ui') return swift;
  if (name === '@expo/ui/swift-ui/modifiers') return modifiers;
  if (name === '@/components/ui') return { IosSheetForm: 'Form', SheetHeader: 'SheetHeader' };
  if (name === '@/components/ui/iosButtonStyles.ios') return { iosProminentButtonModifiers: () => [], iosSecondaryButtonModifiers: () => [], iosSaturatedButtonPalette: () => ({}) };
  if (name === '@/components/android/M3IconButton') return { M3IconButton: 'IconButton' };
  if (name === '@/theme/iosDesignTokens') return { iosColors: {}, iosKindTints: { text: 'blue', image: 'green' } };
  if (name === '@/hooks/useTheme') return { useTheme: () => ({ theme: { colors } }) };
  if (name === '@/platform/engine') return { getUnifiedEngineService: () => engine };
  if (name === '@/features/space') return { useUnifiedSpaceStore: spaceStore, getUnifiedSpaceService: () => ({ refresh: async () => {}, refreshDevices: async () => {}, resendEntry: async (entry, targets, confirmed = false) => { reconciliations.push({ entry, targets, confirmed }); return { kind: 'completed', reconciled: targets.map(targetDeviceId => ({ targetDeviceId, state: 'running', current: snapshots.find(p => p.entryId === entry && p.targetDeviceId === targetDeviceId), newTransferRequested: false })) }; } }) };
  if (name === '@/features/settings') return { useSettingsStore: selector => selector({ config: { syncChannel: channel } }) };
  if (name === '@/features/sync') return { getUnifiedSyncRuntime: () => sync };
  if (name === '@/features/transfer') return { ...realDelivery, createPendingShareStore: () => ({}), getOutboundShareHandoffManager: () => ({ completeJob: async id => completedJobs.push(id) }) };
  if (name === '@/features/history') return { updateHistoryItem: async () => {} };
  if (name === '@/app/runtime/composition') return { getAppRuntime: () => ({ ensureStarted: async () => {} }) };
  if (name === '@/support/observability') return { createLogger: () => ({ warn() {}, error() {}, info() {} }) };
  if (name === '@/utils/uploadFile') return {};
  if (name === '../useLanMySpaceSheet') return { useLanMySpaceSheet: () => lan };
  return load.call(this, name, parent, ...args);
};
const { useUnifiedEngineStore } = require('../../src/stores/unifiedEngineStore.ts');
const { useShareSendController } = require('../../src/components/ShareSendSheet/useShareSendController.ts');
const { OutboundDeliveryCoordinator } = require('../../src/features/transfer/internal/outboundDeliveryCoordinator.ts');
realDelivery = require('../../src/features/transfer/internal/deliveryState.ts');
const { UnifiedContentService } = require('../../src/features/transfer/internal/contentTransfer.ts');
const { P2pSyncAdapter } = require('../../src/features/sync/internal/p2pSyncAdapter.ts');
engine = {
  async refreshOutboundProgress() { useUnifiedEngineStore.setState({ outbound: { progress: snapshots, available: true, failure: null } }); },
  async listOutboundProgress() { return snapshots; },
  async listDevices() { return deviceState.devices; },
  subscribeEvents(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
const coordinator = new OutboundDeliveryCoordinator(engine, 3000);
const content = new UnifiedContentService({
  readClipboard: async () => null, readFileBytes: async () => new Uint8Array(100000),
  p2p: { registerInputFile: uri => uri, releaseFileHandle() {}, async sendFiles() { sends++; return { entryId: `entry-${++sequence}`, totalAccepted: 2, totalDuplicate: 0, totalOffline: 0, totalErrored: 0, totalPending: 0 }; } },
  completeOutboundDelivery: (send, targets) => coordinator.run(send, targets), persistDelivery: async () => {},
});
const adapter = new P2pSyncAdapter({ content });
sync = adapter;
const { ShareSendSheet: AndroidSheet } = require('../../src/components/ShareSendSheet/ShareSendSheet.android.tsx');
const { ShareSendSheet: IosSheet } = require('../../src/components/ShareSendSheet/ShareSendSheet.ios.tsx');
const jobs = [0, 1].map(i => ({ id: `job-${i}`, kind: 'file', fileUri: `controlled://file-${i}`, displayName: `File ${i}`, byteCount: 100, historyProfileHash: `hash-${i}`, createdAtMs: Date.now() }));
const onClose = () => { closed++; };
let visible = true;
function Host() { current = useShareSendController(onClose, visible, jobs); return React.createElement(sheet, { visible, onClose, jobs }); }
const receipts = [];
const reviewEnabled = name => !process.env.SHARE_REVIEW_CASE || process.env.SHARE_REVIEW_CASE === name;
function check(name, fn) { fn(); receipts.push({ name, passed: true }); }
async function publish(values, available = true) {
  snapshots = values;
  await renderer.act(async () => { useUnifiedEngineStore.setState({ outbound: { progress: snapshots, available, failure: null } }); for (const listener of listeners) listener({ type: 'outboundProgressChanged' }); });
}
function snapshot(entryId, targetDeviceId, bytes, state = 'in_progress', total = '100') {
  const success = state === 'completed', failed = state === 'failed';
  return { entryId, targetDeviceId, attemptId: 'attempt', revision: '1', freshness: success || failed ? 'settled' : 'live', freshnessAvailable: true, state, itemsTotal: 1, itemsRunning: success || failed ? 0 : 1, itemsWaiting: 0, itemsCompleted: success ? 1 : 0, itemsFailed: failed ? 1 : 0, itemsCancelled: 0, itemsUnconfirmed: 0, items: [{ kind: 'file', index: 0, state: success ? 'completed' : failed ? 'failed' : 'transferring', completedBytes: bytes, totalBytes: total }] };
}
async function until(predicate) { const deadline = Date.now() + 4000; while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for product state'); await renderer.act(async () => { await new Promise(r => setTimeout(r, 10)); }); } }
(async () => {
  for (const [platform, component] of [['android', AndroidSheet], ['ios', IosSheet]]) {
    sheet = component; snapshots = []; visible = true;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); });
    const rows = () => platform === 'android' ? tree.root.findAllByType('Pressable').filter(node => node.props.testID?.startsWith('share-target-')) : tree.root.findAllByType('Button').filter(node => node.findAllByType('Background').length > 0);
    await renderer.act(async () => { current.toggleTarget('one'); current.toggleTarget('two'); rows().forEach(row => row.props.onPress()); });
    check(`${platform}: full-row press owns selection`, () => {
      if (platform === 'android') assert(rows().every(row => row.props.accessibilityRole === 'button'));
      else assert(rows().every(row => row.findAllByType('HStack').some(node => node.props.modifiers?.some(m => m.name === 'contentShape'))));
    });
    // Select the same targets for the standalone controller and the real sheet controller.
    await renderer.act(async () => { rows().forEach(row => row.props.onPress()); });
    let sending;
    await renderer.act(async () => { sending = current.sendAll(); });
    await until(() => !!current.jobViews[0].entryId);
    const first = current.jobViews[0].entryId;
    const before = sends;
    await renderer.act(async () => { current.toggleTarget('one'); await current.sendAll(); });
    check(`${platform}: early entry identity and duplicate send guard`, () => { assert.equal(current.selectedTargetIds.size, 2); assert.equal(sends, before); });
    const savedDevices = deviceState.devices;
    deviceState.devices = [];
    await renderer.act(async () => { tree.update(React.createElement(Host)); });
    check(`${platform}: device refresh cannot remove in-flight targets`, () => { assert.equal(current.targets.length, 2); assert.equal(current.selectedTargetIds.size, 2); });
    deviceState.devices = savedDevices;
    await publish([snapshot(first, 'one', '46'), snapshot(first, 'two', '20'), snapshot('historical', 'one', '100', 'completed')]);
    check(`${platform}: weighted current-session progress before send resolves`, () => { assert.equal(current.targetProgress.get('one').fraction, .23); assert.equal(current.targetProgress.get('two').fraction, .10); assert(current.isSending); });
    await publish([snapshot(first, 'one', '100'), snapshot(first, 'two', '100')]);
    check(`${platform}: full bytes do not establish success`, () => assert.notEqual(current.targetProgress.get('one').state, 'success'));
    await publish([snapshot(first, 'one', '100', 'completed'), snapshot(first, 'two', '100', 'completed')]);
    await until(() => !!current.jobViews[1].entryId);
    const second = current.jobViews[1].entryId;
    await publish([snapshot(first, 'one', '100', 'completed'), snapshot(first, 'two', '100', 'completed'), snapshot(second, 'one', null), snapshot(second, 'two', '10')]);
    check(`${platform}: unknown bytes remain indeterminate`, () => assert.equal(current.targetProgress.get('one').fraction, null));
    await publish([snapshot(first, 'one', '100', 'completed'), snapshot(first, 'two', '100', 'completed'), snapshot(second, 'one', '100'), snapshot(second, 'two', '100')]);
    check(`${platform}: 100 percent shows confirmation, not success`, () => { assert.equal(current.targetProgress.get('one').fraction, 1); assert.equal(current.targetProgress.get('one').state, 'confirming'); });
    const huge = '18446744073709551615';
    await publish([snapshot(first, 'one', '100', 'completed'), snapshot(first, 'two', '100', 'completed'), snapshot(second, 'one', '9223372036854775807', 'in_progress', huge), snapshot(second, 'two', '10')]);
    check(`${platform}: u64 ratio uses exact arithmetic`, () => assert.equal(current.targetProgress.get('one').fraction, .5));
    await publish(snapshots, false);
    check(`${platform}: unavailable snapshot cannot establish success`, () => assert.notEqual(current.targetProgress.get('one').state, 'success'));
    await publish([snapshot(first, 'one', '100', 'completed'), snapshot(first, 'two', '100', 'completed'), snapshot(second, 'one', '100', 'completed'), snapshot(second, 'two', '25', 'failed')]);
    await renderer.act(async () => { await sending; });
    check(`${platform}: destinations settle independently`, () => { assert.equal(current.targetProgress.get('one').state, 'success'); assert.equal(current.targetProgress.get('two').state, 'failed'); });
    await renderer.act(async () => { await current.sendAll(); });
    check(`${platform}: retry reconciles the remembered entry only`, () => { assert.equal(sends, before + 1); assert(reconciliations.every(call => !call.confirmed)); });
    // Render the same controller facts through each real platform row.
    let resolveSend;
    const facts = current;
    sync = { async sendImportedAsset(_asset, _hash, options) { options.onEntryCreated('visible-entry'); return new Promise(resolve => { resolveSend = resolve; }); } };
    await renderer.act(async () => { rows().forEach(row => row.props.onPress()); });
    const footer = platform === 'android' ? tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '发送') : tree.root.findAllByType('Button').find(node => node.findAllByType('Text').some(text => text.props.children === '发送'));
    await renderer.act(async () => { footer.props.onPress(); });
    await publish([snapshot('visible-entry', 'one', '46'), snapshot('visible-entry', 'two', '20')]);
    const rendered = JSON.stringify(tree.toJSON(), (key, value) => key === '_owner' || key === '_store' ? undefined : value);
    check(`${platform}: production rows render status without results section`, () => { assert(!rendered.includes('发送结果')); assert(rendered.includes('正在发送')); assert(rows().every(row => platform === 'android' ? row.props.disabled : row.props.modifiers.some(m => m.name === 'disabled' && m.value))); });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${platform}-tree.json`), JSON.stringify(tree.toJSON(), (key, value) => key === '_owner' || key === '_store' ? undefined : value, 2));
    // End this controlled send and verify that success stays visible.
    await renderer.act(async () => { resolveSend({ success: true, state: 'delivered', entryId: 'visible-entry' }); });
    await until(() => jobs.length === 1 || !!resolveSend);
    // Two jobs dispatch serially; resolve the second promise too.
    await renderer.act(async () => { resolveSend({ success: true, state: 'delivered', entryId: 'visible-entry' }); });
    const previousClosed = closed;
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    check(`${platform}: completion stays visible for Done`, () => { assert.equal(closed, previousClosed); assert(JSON.stringify(tree.toJSON(), (key, value) => key === '_owner' || key === '_store' ? undefined : value).includes('完成')); });
    assert(facts.isDone);
    visible = false;
    await renderer.act(async () => { tree.update(React.createElement(Host)); });
    visible = true;
    await renderer.act(async () => { tree.update(React.createElement(Host)); });
    check(`${platform}: reopened session clears historical progress`, () => { assert.equal(current.targetProgress.size, 0); assert(current.jobViews.every(view => !view.entryId)); });
    const previousDevices = deviceState.devices;
    deviceState.devices = [{ deviceId: 'two', displayName: 'Replacement device', isLocal: false }];
    await renderer.act(async () => { tree.update(React.createElement(Host)); });
    if (!current.selectedTargetIds.has('two')) await renderer.act(async () => { current.toggleTarget('two'); });
    let reopenedSend;
    await renderer.act(async () => { reopenedSend = current.sendAll(); });
    check(`${platform}: next send replaces the previous target snapshot`, () => {
      assert.deepEqual(current.targets.map(target => target.displayName), ['Replacement device']);
    });
    await renderer.act(async () => { resolveSend({ success: true, state: 'delivered', entryId: 'visible-entry' }); });
    await renderer.act(async () => { resolveSend({ success: true, state: 'delivered', entryId: 'visible-entry' }); await reopenedSend; });
    deviceState.devices = previousDevices;
    await renderer.act(async () => { tree.unmount(); });
    sync = adapter;
  }
  // Actual LAN adapter -> per-server callbacks -> actual Share controller.
  const { LanSyncAdapter } = require('../../src/features/lan-sync/internal/lanSyncAdapter.ts');
  const requests = [];
  sync = new LanSyncAdapter({
    getServer: async id => ({ id, name: id, urls: ['https://controlled.invalid'], username: '', password: '' }),
    client: { putClipboard: server => new Promise((resolve, reject) => requests.push({ id: server.id, resolve, reject })) },
  });
  channel = 'lan'; sheet = AndroidSheet; visible = true;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); });
  await renderer.act(async () => { current.toggleTarget('one'); current.toggleTarget('two'); });
  let lanSending;
  await renderer.act(async () => { lanSending = current.sendAll(); });
  await until(() => requests.length === 2);
  check('LAN: missing byte callbacks stay indeterminate', () => assert.equal(current.targetProgress.get('one').fraction, null));
  await renderer.act(async () => { requests[0].resolve({ url: 'https://controlled.invalid' }); });
  check('LAN: one acknowledgement updates only its own destination', () => { assert.equal(current.jobViews[0].targetResults.one, 'delivered'); assert.equal(current.jobViews[0].targetResults.two, undefined); });
  await renderer.act(async () => { requests[1].reject(new LanUnknown()); });
  await until(() => requests.length === 4);
  await renderer.act(async () => { requests[2].resolve({ url: 'https://controlled.invalid' }); requests[3].reject(new LanUnknown()); await lanSending; });
  check('LAN: acknowledged target succeeds and missing acknowledgement stays unconfirmed', () => { assert.equal(current.targetProgress.get('one').state, 'success'); assert.equal(current.targetProgress.get('two').state, 'unconfirmed'); });
  if (reviewEnabled('retry')) {
    for (const finalAttempt of [false, true]) {
      const start = requests.length;
      let retry;
      await renderer.act(async () => { retry = current.sendAll(); });
      await until(() => requests.length === start + 2);
      check(`LAN: retry clears ${finalAttempt ? 'failed' : 'unconfirmed'} attempt facts before callbacks`, () => {
        assert.equal(current.jobViews[0].targetResults, undefined, 'retry retained previous target results');
        assert.equal(current.jobViews[0].deliveryState, undefined, 'retry retained previous delivery state');
        for (const target of ['one', 'two']) {
          assert.equal(current.targetProgress.get(target).state, 'sending');
          assert.equal(current.targetProgress.get(target).fraction, null);
        }
      });
      await renderer.act(async () => {
        requests[start].resolve({ url: 'https://controlled.invalid' });
        if (finalAttempt) requests[start + 1].resolve({ url: 'https://controlled.invalid' });
        else requests[start + 1].reject(new Error('controlled failure'));
      });
      await until(() => requests.length === start + 4);
      check('LAN: each queued job clears its own stale attempt results', () => {
        assert.equal(current.jobViews[1].targetResults, undefined);
        assert.equal(current.jobViews[1].deliveryState, undefined);
      });
      await renderer.act(async () => {
        requests[start + 2].resolve({ url: 'https://controlled.invalid' });
        if (finalAttempt) requests[start + 3].resolve({ url: 'https://controlled.invalid' });
        else requests[start + 3].reject(new Error('controlled failure'));
        await retry;
      });
    }
  }
  await renderer.act(async () => { tree.unmount(); });
  // Render one actual share job to verify the visible percentage on each platform.
  channel = 'p2p';
  for (const [platform, component] of [['android', AndroidSheet], ['ios', IosSheet]]) {
    let finishReviewSend;
    sync = { async sendImportedAsset(_asset, _hash, options) {
      options.onEntryCreated('review-entry');
      return new Promise(resolve => { finishReviewSend = resolve; });
    } };
    await renderer.act(async () => { tree = renderer.create(React.createElement(component, { visible: true, onClose, jobs: [jobs[0]] })); });
    const rows = () => platform === 'android'
      ? tree.root.findAllByType('Pressable').filter(node => node.props.testID?.startsWith('share-target-'))
      : tree.root.findAllByType('Button').filter(node => node.findAllByType('Background').length > 0);
    if (platform === 'ios' && reviewEnabled('hit-shape')) {
      check('ios: row hit shape includes padding and geometry measures the padded row', () => {
        const row = rows()[0].findAllByType('HStack').find(node => node.props.modifiers?.some(m => m.name === 'contentShape'));
        const index = name => row.props.modifiers.findIndex(m => m.name === name);
        assert(index('contentShape') > index('padding'), 'contentShape precedes padding');
        assert(index('onGeometryChange') > index('padding'));
      });
    }
    await renderer.act(async () => { rows().forEach(row => row.props.onPress()); });
    const footer = platform === 'android'
      ? tree.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '发送')
      : tree.root.findAllByType('Button').find(node => node.findAllByType('Text').some(text => text.props.children === '发送'));
    await renderer.act(async () => { footer.props.onPress(); });
    if (reviewEnabled('rounding')) {
      for (const [bytes, total, expected] of [['29', '100', '29%'], ['57', '100', '57%'], ['2899', '10000', '28%'], ['9999', '10000', '99%']]) {
        await publish([snapshot('review-entry', 'one', bytes, 'in_progress', total), snapshot('review-entry', 'two', bytes, 'in_progress', total)]);
        check(`${platform}: ${bytes}/${total} displays ${expected} without floating-point drift`, () => {
          for (const row of rows()) {
            assert(row.findAllByType('Text').some(text => text.props.children === expected), `visible percentage must be ${expected}`);
          }
        });
      }
    }
    await renderer.act(async () => { finishReviewSend({ success: true, state: 'delivered', entryId: 'review-entry' }); });
    await renderer.act(async () => { tree.unmount(); });
  }
  const crypto = require('node:crypto');
  const sourceFiles = ['src/components/ShareSendSheet/ShareSendSheet.android.tsx', 'src/components/ShareSendSheet/ShareSendSheet.ios.tsx', 'src/components/ShareSendSheet/useShareSendController.ts', 'src/components/ShareSendSheet/shareTargetProgress.ts', 'src/features/transfer/internal/contentTransfer.ts', 'src/features/sync/internal/p2pSyncAdapter.ts', 'src/features/lan-sync/internal/lanSyncAdapter.ts'];
  const sourceSha256 = Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ sourceSha256, scope: 'Actual controller, P2P content service, adapter, delivery coordinator and platform React trees. Controlled native/transport boundary. Native layout, hit testing and real devices NOT RUN.', receipts }, null, 2) + '\n');
  console.log(`${receipts.length} checks passed. ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (tree) renderer.act(() => tree.unmount()); });
