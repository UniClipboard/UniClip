import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const script = (name) => resolve(repositoryRoot, 'scripts', name);

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const engine = mkdtempSync(join(tmpdir(), 'uc-engine-source-'));
  git(engine, 'init', '-q', '-b', 'main');
  git(engine, 'config', 'user.email', 'test@example.com');
  git(engine, 'config', 'user.name', 'Test');
  write(engine, 'Cargo.toml', '[workspace]\n\n[workspace.package]\nversion = "2.3.4-rc.5"\nedition = "2024"\n');
  git(engine, 'add', '.');
  git(engine, 'commit', '-qm', 'one');
  const commit = git(engine, 'rev-parse', 'HEAD');
  git(engine, 'update-ref', 'refs/remotes/origin/main', commit);

  const root = mkdtempSync(join(tmpdir(), 'uc-engine-mobile-'));
  write(root, 'modules/uc-engine/package.json', `${JSON.stringify({ version: '1.0.0' })}\n`);
  write(root, 'package-lock.json', `${JSON.stringify({ packages: { 'modules/uc-engine': { version: '1.0.0' } } })}\n`);
  return { engine, root, commit };
}

function pin({ engine, root }, ref, ...extra) {
  return spawnSync(
    process.execPath,
    [script('pin-unified-engine-commit.mjs'), ref, '--root', root, '--engine-dir', engine, '--no-fetch', ...extra],
    { encoding: 'utf8' }
  );
}

test('pins an abbreviated commit without a release tag and syncs the module version', () => {
  const f = fixture();
  const result = pin(f, f.commit.slice(0, 8));
  assert.equal(result.status, 0, result.stderr);
  const source = JSON.parse(readFileSync(join(f.root, 'modules/uc-engine/core-source.json'), 'utf8'));
  assert.deepEqual(source, {
    schemaVersion: 1,
    repository: 'UniClipboard/Engine',
    version: 'v2.3.4-rc.5',
    sourceCommit: f.commit,
    artifactSource: 'commit',
  });
  assert.equal(JSON.parse(readFileSync(join(f.root, 'modules/uc-engine/package.json'), 'utf8')).version, '2.3.4-rc.5');
  assert.equal(
    JSON.parse(readFileSync(join(f.root, 'package-lock.json'), 'utf8')).packages['modules/uc-engine'].version,
    '2.3.4-rc.5'
  );
});

test('rejects a commit that is not on Engine main unless explicitly allowed', () => {
  const f = fixture();
  git(f.engine, 'checkout', '-qb', 'side');
  write(f.engine, 'extra.txt', 'x');
  git(f.engine, 'add', '.');
  git(f.engine, 'commit', '-qm', 'two');
  const sideCommit = git(f.engine, 'rev-parse', 'HEAD');
  const rejected = pin(f, sideCommit);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /not on Engine main/);
  assert.equal(pin(f, sideCommit, '--allow-unmerged').status, 0);
});

test('release validation accepts a commit pin without checksums and rejects stray ones', () => {
  const f = fixture();
  assert.equal(pin(f, f.commit).status, 0);
  const validate = () =>
    spawnSync(process.execPath, [script('validate-unified-engine-core-source.mjs'), '--root', f.root, '--skip-remote'], {
      encoding: 'utf8',
    });
  assert.equal(validate().status, 0, validate().stderr);
  const path = join(f.root, 'modules/uc-engine/core-source.json');
  const source = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...source, artifacts: {} }));
  assert.match(validate().stderr, /must not carry release checksums/);
});

test('verifies a commit build per platform and notices tampering', () => {
  const f = fixture();
  assert.equal(pin(f, f.commit).status, 0);
  const verify = (...args) =>
    spawnSync(process.execPath, [script('verify-unified-engine-core.mjs'), '--root', f.root, ...args], {
      encoding: 'utf8',
    });
  const maven = 'modules/uc-engine/android/release-maven/app/uniclipboard/uniclipboard-engine/2.3.4-rc.5';
  write(f.root, `${maven}/uniclipboard-engine-2.3.4-rc.5.aar`, 'aar');
  write(f.root, `${maven}/uniclipboard-engine-2.3.4-rc.5.pom`, 'pom');
  write(f.root, 'modules/uc-engine/android/release-metadata/runtime-dependencies.txt', 'deps');
  write(f.root, 'modules/uc-engine/android/release-metadata/uc_engine_uniffi.kt', 'kt');

  assert.match(verify('--prepared', '--platform', 'android').stderr, /prepared marker is missing/);
  assert.notEqual(verify('--record-prepared', '--platform', 'android', '--build-profile', 'dev').status, 0);
  assert.equal(verify('--record-prepared', '--platform', 'android', '--build-profile', 'release').status, 0);
  assert.equal(verify('--prepared', '--platform', 'android').status, 0);
  assert.match(verify('--prepared', '--platform', 'ios').stderr, /ios Engine artifacts have not been prepared/);

  write(f.root, `${maven}/uniclipboard-engine-2.3.4-rc.5.aar`, 'swapped');
  assert.match(verify('--prepared', '--platform', 'android').stderr, /was modified/);
});
