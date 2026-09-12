import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '../..');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const files = ['Info.plist', 'ios-arm64/Headers/module.modulemap', 'ios-arm64/Headers/uc_engine_uniffiFFI.h', 'ios-arm64/libuc_engine_uniffi.a', 'ios-arm64_x86_64-simulator/Headers/module.modulemap', 'ios-arm64_x86_64-simulator/Headers/uc_engine_uniffiFFI.h', 'ios-arm64_x86_64-simulator/libuc_engine_uniffi.a'];
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ios-engine-reuse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mobile = join(root, 'mobile');
  const engine = join(root, 'Engine');
  const module = join(mobile, 'modules/uc-engine');
  write(join(engine, 'Cargo.toml'), '');
  write(join(engine, '.cargo/config.toml'), '');
  const git = (...args) => execFileSync('git', ['-C', engine, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
  git('remote', 'add', 'origin', engine);
  const commit = git('rev-parse', 'HEAD');
  write(join(module, 'core-source.json'), JSON.stringify({ version: 'v1.0.0', sourceCommit: commit, artifacts: {} }));
  write(join(module, 'ios/Bindings/uc_engine_uniffi.swift'), 'binding');
  for (const file of files) write(join(module, 'ios/UniClipboardEngine.xcframework', file), file);
  mkdirSync(join(mobile, 'scripts'), { recursive: true });
  for (const name of ['verify-unified-engine-core.mjs', 'engine-build-storage.sh']) cpSync(join(repo, 'scripts', name), join(mobile, 'scripts', name));
  const record = (sourceCommit = commit) => execFileSync(process.execPath, [join(mobile, 'scripts/verify-unified-engine-core.mjs'), '--record-local', '--source-commit', sourceCommit, '--source-state-sha256', sha('')]);
  record();
  // Exercise the actual preparation entry point, without a phone or application build.
  const script = readFileSync(join(repo, 'scripts/install-dev-device.sh'), 'utf8').split('platform="${1:-all}"')[0];
  write(join(mobile, 'scripts/run-preparation.sh'), `${script}\nLOCAL_ENGINE_BUILD_ROOT="$(uc_engine_build_target "$ENGINE_ROOT")"\nexport LOCAL_ENGINE_BUILD_ROOT\nprepare_install_engine ios\n`);
  write(join(mobile, 'scripts/prepare-local-unified-engine-core.sh'), 'echo UNEXPECTED_ENGINE_BUILD >&2\nexit 99\n');
  let attempt = 0;
  const run = () => {
    const staging = join(root, `empty-staging-${++attempt}`);
    mkdirSync(staging);
    return spawnSync('bash', [join(mobile, 'scripts/run-preparation.sh')], {
      encoding: 'utf8',
      env: { ...process.env, UC_ENGINE_LOCAL_TARGET_DIR: staging, UC_ENGINE_STORAGE_BUILD_DIR: join(root, 'build'), UC_ENGINE_UNIFFI_SLICE: 'universal', PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` },
    });
  };
  return { run, record, module, commit, mobile, engine, git };
}

test('reuses verified iOS output across two empty staging directories', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) {
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_ENGINE_BUILD/);
  }
});

test('restores verified persistent output after the installed framework is replaced', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  write(join(f.module, 'ios/UniClipboardEngine.xcframework/Info.plist'), 'replaced by pinned release');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.module, 'ios/UniClipboardEngine.xcframework/Info.plist'), 'utf8'), 'Info.plist');
});

for (const invalid of ['different commit', 'corrupt framework', 'missing framework', 'missing marker', 'corrupt marker']) {
  test(`requires a build for ${invalid} without a valid persistent copy`, (t) => {
    const f = fixture(t);
    if (invalid === 'different commit') f.record('a'.repeat(40));
    if (invalid === 'corrupt framework') write(join(f.module, 'ios/UniClipboardEngine.xcframework/Info.plist'), 'bad');
    if (invalid === 'missing framework') rmSync(join(f.module, 'ios/UniClipboardEngine.xcframework'), { recursive: true });
    if (invalid === 'missing marker') rmSync(join(f.module, '.artifacts/local/local-prepared.json'));
    if (invalid === 'corrupt marker') write(join(f.module, '.artifacts/local/local-prepared.json'), '{');
    const result = f.run();
    assert.equal(result.status, 99, result.stdout + result.stderr);
    assert.match(result.stderr, /UNEXPECTED_ENGINE_BUILD/);
  });
}

for (const invalid of ['binding', 'framework', 'commit']) {
  test(`rejects a persistent cache with invalid ${invalid}`, (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    const cache = join(f.module, '.artifacts/local/ios-cache');
    rmSync(join(f.module, 'ios/UniClipboardEngine.xcframework'), { recursive: true });
    if (invalid === 'binding') write(join(cache, 'uc_engine_uniffi.swift'), 'bad');
    if (invalid === 'framework') write(join(cache, 'UniClipboardEngine.xcframework/Info.plist'), 'bad');
    if (invalid === 'commit') {
      const marker = JSON.parse(readFileSync(join(cache, 'local-prepared.json'), 'utf8'));
      marker.sourceCommit = 'a'.repeat(40);
      write(join(cache, 'local-prepared.json'), JSON.stringify(marker));
    }
    const result = f.run();
    assert.equal(result.status, 99, result.stdout + result.stderr);
    assert.match(result.stderr, /UNEXPECTED_ENGINE_BUILD/);
  });
}

test('a successful build is retained for the next empty staging directory', (t) => {
  const f = fixture(t);
  f.record('a'.repeat(40));
  write(join(f.mobile, 'scripts/prepare-local-unified-engine-core.sh'), `
set -eu
echo built >> "$PROJECT_ROOT/build-count"
node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --record-local --source-commit "$(git -C "$1" rev-parse HEAD)" --source-state-sha256 "${sha('')}"
`);
  const first = f.run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = f.run();
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(readFileSync(join(f.mobile, 'build-count'), 'utf8'), 'built\n');
});

test('installation follows the mobile pin when required Engine APIs are not on origin/main', (t) => {
  const f = fixture(t);
  f.git('checkout', '-b', 'diagnostics');
  write(join(f.engine, 'diagnostics-api'), 'new mobile API');
  f.git('add', '.');
  f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'add diagnostic API');
  const pinned = f.git('rev-parse', 'HEAD');
  f.git('checkout', 'main');
  const pinPath = join(f.module, 'core-source.json');
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  pin.sourceCommit = pinned;
  write(pinPath, JSON.stringify(pin));
  f.record(pinned);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_ENGINE_BUILD/);
});
