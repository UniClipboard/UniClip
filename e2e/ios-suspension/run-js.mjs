#!/usr/bin/env node
// Exercise the actual JS suspension subscriber and database owner with real host SQLite.
// The Expo bridge is adapted to node:sqlite. This is not an Expo/iOS native execution.
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = process.argv.includes('--baseline');
const pin = 'fcf68bfe917fc7a12a3c0696ac90b5463ae0b724';
const require = createRequire(import.meta.url);
const compiler = process.env.TYPESCRIPT_JS ?? require.resolve('typescript');
const ts = require(compiler);
const stamp = new Date().toISOString().replace(/[^0-9A-Z]/g, '') + '-js';
const outputIndex = process.argv.indexOf('--output-root');
const outputRoot = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(root, 'e2e/results/ios-suspension');
const output = path.join(outputRoot, stamp);
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-suspension-js-'));
const receipt = { baseline, baselineCommit: pin, scope: 'JS database owner and subscriber with real node:sqlite; controlled Expo bridge; iOS/real Engine NOT RUN', sourceHashes: {}, cases: [], compiler: { version: ts.version, sha256: createHash('sha256').update(fs.readFileSync(compiler)).digest('hex') } };
const databases = [];
let failed = false;
const transcript = [];
function check(ok, name) {
  receipt.cases.push({ name, passed: !!ok }); const line = `${ok ? 'PASS' : 'FAIL'}: ${name}`; transcript.push(line); console.log(line); failed ||= !ok;
}
function source(name) {
  const data = baseline ? execFileSync('git', ['show', `${pin}:${name}`], { cwd: root }) : fs.readFileSync(path.join(root, name));
  receipt.sourceHashes[name] = createHash('sha256').update(data).digest('hex'); return data.toString();
}
const databaseSource = source('src/platform/database/sqliteDatabase.ts');
const subscriberSource = source('src/platform/database/databaseSuspension.ios.ts');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(name) {
  const container = path.join(temp, name); fs.mkdirSync(container, { recursive: true });
  const state = { opens: 0, closeAttempts: 0, failClose: false, listener: null, acknowledgements: [], lookup: async () => pathToFileURL(container).href };
  class Directory {
    constructor(...parts) { this.uri = pathToFileURL(path.join(...parts.map(p => String(p).startsWith('file:') ? fileURLToPath(p) : String(p)))).href; }
    get exists() { return fs.existsSync(fileURLToPath(this.uri)); }
    create() { fs.mkdirSync(fileURLToPath(this.uri), { recursive: true }); }
  }
  class File {
    constructor(...parts) { this.uri = pathToFileURL(path.join(...parts.map(p => p instanceof Directory ? fileURLToPath(p.uri) : String(p).startsWith('file:') ? fileURLToPath(p) : String(p)))).href; }
    get exists() { return fs.existsSync(fileURLToPath(this.uri)); }
    move(target) { fs.renameSync(fileURLToPath(this.uri), fileURLToPath(target.uri)); }
  }
  const sqlite = {
    defaultDatabaseDirectory: path.join(container, 'sandbox'),
    async openDatabaseAsync(name, _options, directory) {
      const dir = directory ?? this.defaultDatabaseDirectory; fs.mkdirSync(dir, { recursive: true });
      const native = new DatabaseSync(path.join(dir, name)); state.opens++;
      const handle = { native, closed: false }; databases.push(handle);
      return {
        execAsync: async sql => native.exec(sql),
        getFirstAsync: async sql => native.prepare(sql).get(),
        getAllAsync: async sql => native.prepare(sql).all(),
        async closeAsync() {
          state.closeAttempts++;
          if (state.failClose) { state.failClose = false; throw new Error('injected close failure: connection still owned'); }
          native.close(); handle.closed = true;
        },
      };
    },
  };
  const deps = {
    'expo-file-system': { Directory, File }, 'expo-sqlite': sqlite, 'react-native': { Platform: { OS: 'ios' } },
    '@/support/observability': { createLogger: () => ({ info() {}, warn() {}, error() {} }) },
    'app-group-store': { getContainerUrl: () => state.lookup() },
    'uc-engine': { subscribeHostSuspension(listener) { state.listener = listener; return () => { state.listener = null; }; }, async completeHostSuspension(id, released) { state.acknowledgements.push({ id, released }); } },
  };
  function load(text) {
    const module = { exports: {} };
    const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({ module, exports: module.exports, require: name => { if (!(name in deps)) throw new Error(`unexpected dependency ${name}`); return deps[name]; } });
    vm.runInContext(code, context); return module.exports;
  }
  const db = load(databaseSource); deps['./sqliteDatabase'] = db;
  const subscriber = load(subscriberSource); subscriber.startDatabaseSuspension();
  return { state, db };
}
async function tick() { await new Promise(done => setImmediate(done)); }
try {
  const { state, db } = fixture('close-failure');
  await db.withDatabase(connection => connection.execAsync("INSERT INTO clipboard_history(profileHash,type,text) VALUES('fixture','Text','synthetic')"));
  state.failClose = true;
  state.listener({ phase: 'suspend', transitionId: 1 });
  for (let i = 0; i < 20 && !state.acknowledgements.length; i++) await tick();
  check(state.acknowledgements[0]?.released === false, 'actual JS subscriber reports a failed close as released=false');
  check(await db.suspendDatabase(), 'retry confirms suspension only after close returns');
  check(state.closeAttempts === 2 && databases.every(item => item.closed), 'failed SQLite close retains its owner for retry');
  let borrowed = false;
  const pending = db.withDatabase(async connection => { borrowed = true; return connection.getFirstAsync('SELECT text FROM clipboard_history'); });
  await tick(); check(!borrowed, 'new JS database lease waits for foreground resume');
  db.resumeDatabase(); const row = await pending;
  check(row.text === 'synthetic', 'foreground database reopen preserves real SQLite data');
  await db.suspendDatabase();

  const late = fixture('late-opening'); const lookup = deferred(); late.state.lookup = () => lookup.promise;
  const operation = late.db.withDatabase(async () => true).catch(() => false);
  const closing = late.db.suspendDatabase(); lookup.resolve(pathToFileURL(path.join(temp, 'late-opening')).href);
  await operation; await closing;
  check(late.state.opens === 0, 'suspension during directory lookup prevents a new SQLite open');

  const denied = fixture('lookup-denied'); denied.state.lookup = async () => { throw new Error('native storage admission closed'); };
  await denied.db.withDatabase(async () => true).catch(() => false);
  check(denied.state.opens === 0, 'native directory failure cannot open a different sandbox database');
  await denied.db.suspendDatabase();
} catch (error) { failed = true; receipt.error = String(error?.stack ?? error); console.error(receipt.error); }
finally {
  for (const item of databases) if (!item.closed) { try { item.native.close(); } catch {} }
  receipt.result = failed ? 'FAIL' : 'PASS'; receipt.exitCode = failed ? 1 : 0;
  fs.writeFileSync(path.join(output, 'stdout.txt'), transcript.join('\n') + '\n');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(output); console.log(receipt.result); process.exitCode = receipt.exitCode;
}
