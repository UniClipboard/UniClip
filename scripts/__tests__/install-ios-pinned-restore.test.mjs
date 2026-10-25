import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '../..');
const commit = '2f9afc9956b0cda82e65c912f0c0f6dc6aa51256';
/** Write a fixture input, creating its parent directories when needed. */
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
/** Create an isolated module with real pinned artifacts and stub only device/build commands. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ios-pin-restore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const module = join(root, 'modules/uc-engine');
  const cache = join(module, '.artifacts', `commit-${commit}`);
  write(join(module, 'core-source.json'), JSON.stringify({ schemaVersion: 1, version: 'v1.1.0-rc.22', sourceCommit: commit, artifactSource: 'commit' }));
  write(join(module, 'package.json'), JSON.stringify({ version: '1.1.0-rc.22' }));
  write(join(module, 'ios/Bindings/uc_engine_uniffi.swift'), 'release binding');
  for (const file of ['Info.plist', 'ios-arm64/Headers/module.modulemap', 'ios-arm64/Headers/uc_engine_uniffiFFI.h', 'ios-arm64/libuc_engine_uniffi.a', 'ios-arm64_x86_64-simulator/Headers/module.modulemap', 'ios-arm64_x86_64-simulator/Headers/uc_engine_uniffiFFI.h', 'ios-arm64_x86_64-simulator/libuc_engine_uniffi.a']) {
    write(join(module, 'ios/UniClipboardEngine.xcframework', file), file);
  }
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const name of ['engine-build-storage.sh', 'engine-source-checkout.sh', 'verify-unified-engine-core.mjs']) cpSync(join(repo, 'scripts', name), join(root, 'scripts', name));
  execFileSync(process.execPath, [join(root, 'scripts/verify-unified-engine-core.mjs'), '--record-prepared', '--platform', 'ios'], { stdio: 'pipe' });
  cpSync(join(module, 'ios/Bindings/uc_engine_uniffi.swift'), join(cache, 'uc_engine_uniffi.swift'));
  execFileSync('zip', ['-qr', join(cache, 'UniClipboardEngine.xcframework.zip'), 'UniClipboardEngine.xcframework'], { cwd: join(module, 'ios') });
  write(join(root, 'scripts/prepare-ios-development-project.sh'), 'echo PROJECT_PREPARED\n');
  const functions = readFileSync(join(repo, 'scripts/install-dev-device.sh'), 'utf8').split('platform="${1:-all}"')[0];
  write(join(root, 'scripts/run.sh'), `${functions}\nLOCAL_ENGINE_BUILD_ROOT="$PROJECT_ROOT/build"\nxcrun() { echo test-phone; }\nassert_development_project() { :; }\nprepare_install_engine() { echo dev > "$PROJECT_ROOT/modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift"; }\nnpx() { echo INSTALL_ATTEMPTED; return 70; }\ninstall_ios test-phone\n`);
  /** Run the installer flow in a child shell and return its status and diagnostics. */
  const run = () => spawnSync('bash', [join(root, 'scripts/run.sh')], { encoding: 'utf8', env: { ...process.env, UC_IOS_INSTALL_VARIANT: 'development', UC_ENGINE_UNIFFI_SLICE: 'universal', PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` } });
  return { root, module, cache, run };
}

test('failed iOS install restores exact commit cache without Android and preserves exit 70', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 70, result.stdout + result.stderr);
  assert.match(result.stdout, /INSTALL_ATTEMPTED/);
  assert.doesNotMatch(result.stderr, /cache is incomplete|verification failed/);
  assert.equal(readFileSync(join(f.module, 'ios/Bindings/uc_engine_uniffi.swift'), 'utf8'), 'release binding');
});

test('missing pinned iOS cache fails before preparing or installing the application', (t) => {
  const f = fixture(t);
  rmSync(join(f.cache, 'UniClipboardEngine.xcframework.zip'));
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /PROJECT_PREPARED|INSTALL_ATTEMPTED/);
  assert.match(result.stderr, /commit-2f9afc9956/);
  assert.match(result.stderr, /npm run core:prepare -- --platform ios/);
});

test('release pins continue to look in the version cache', (t) => {
  const f = fixture(t);
  write(join(f.module, 'core-source.json'), JSON.stringify({ version: 'v1.1.0-rc.22', sourceCommit: commit, artifactSource: 'release' }));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.artifacts\/v1\.1\.0-rc\.22/);
  assert.doesNotMatch(result.stdout, /INSTALL_ATTEMPTED/);
});

test('local Engine override installs without pinned cache and keeps its local output', (t) => {
  const f = fixture(t);
  write(join(f.module, '.artifacts/local/source.json'), JSON.stringify({ repository: join(f.root, 'Engine') }));
  rmSync(f.cache, { recursive: true });
  const result = f.run();
  assert.equal(result.status, 70, result.stdout + result.stderr);
  assert.match(result.stdout, /INSTALL_ATTEMPTED/);
  assert.doesNotMatch(result.stderr, /cache is incomplete|verification failed/);
  assert.equal(readFileSync(join(f.module, 'ios/Bindings/uc_engine_uniffi.swift'), 'utf8'), 'dev\n');
});
