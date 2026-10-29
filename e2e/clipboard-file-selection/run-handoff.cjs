#!/usr/bin/env node
// Controlled adapter-to-native boundary replay. No system clipboard or device.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const sourcePath = path.join(root, 'src/features/sync/internal/p2pSyncAdapter.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const logger = { info() {}, error() {} };
const mocks = {
  '@/features/transfer': {},
  '@/utils/historyItemText': { readExternalText: async () => null },
  '@/support/observability': { createLogger: () => logger },
};
const moduleObject = { exports: {} };
vm.runInNewContext(code, { module: moduleObject, exports: moduleObject.exports, require(name) {
  if (!(name in mocks)) throw Error(`Unspecified boundary: ${name}`);
  return mocks[name];
}, setTimeout, clearTimeout }, { filename: sourcePath });
const bytes = Buffer.from('synthetic clipboard fixture');
const file = path.join(out, 'fixture.bin');
fs.writeFileSync(file, bytes);
let captured;
const adapter = new moduleObject.exports.P2pSyncAdapter({
  platform: 'android', engine: {}, space: {}, content: {},
  clipboard: { async observeClipboardChange(_dispatch, value) { captured = value; return null; } },
});
(async () => {
  let error = null;
  try {
    await adapter.observeClipboardChange({ type: 'File', fileUri: `file://${file}`, fileName: 'fixture.bin', hasData: true }, false);
    assert.ok(captured, 'native boundary must receive the file captured for this observation');
    assert.equal(captured.fileUri, `file://${file}`);
    assert.deepEqual(fs.readFileSync(new URL(captured.fileUri)), bytes);
  } catch (failure) { error = String(failure); }
  const hash = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({
    scope: 'Controlled production P2P adapter to native boundary; synthetic file; no system clipboard or Engine.',
    command: process.argv, exitCode: error ? 1 : 0, error,
    sha256: { source: hash(sourcePath), harness: hash(__filename), executable: hash(process.execPath), fixture: hash(file) },
  }, null, 2) + '\n');
  if (error) { console.error(error); process.exitCode = 1; }
  else console.log('Captured file passed to native boundary');
})();
