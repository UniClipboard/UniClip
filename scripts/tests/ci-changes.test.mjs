import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { classifyPaths, detectChanges, diffRange } from '../ci-changes.mjs';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const pr = (base, head) => ({ pull_request: { base: { sha: base }, head: { sha: head } } });
const push = (base, head) => ({ before: base, after: head, ref: 'refs/heads/main' });

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'uniclip-ci-diff-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=uniclipboard-bot', '-c', 'user.email=github-bot@uniclipboard.app', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  const commit = (path, contents) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), contents);
    git('add', '--all'); git('commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return { cwd, git, commit };
}

test('docs and explicit lifecycle/validation/publishing paths avoid native compilation', () => {
  const paths = ['docs/issue-lifecycle.md', 'docs/images/example.png', 'README.md', 'README.zh-CN.md', 'CHANGES.en.md', 'AGENTS.md', 'LICENSE', '.github/scripts/issue-lifecycle.cjs', '.github/workflows/issue-lifecycle.yml', 'scripts/tests/issue-lifecycle.test.mjs', 'scripts/ci-changes.mjs', 'scripts/ci-native-recipes.mjs', 'scripts/tests/ci-changes.test.mjs', 'scripts/tests/ci-workflows.test.mjs', 'scripts/tests/ci-native-recipes.test.mjs', 'src/__tests__/releaseWorkflow.test.ts', '.github/workflows/test.yml', '.github/workflows/code-style.yml', '.github/workflows/react-doctor.yml'];
  assert.equal(classifyPaths(paths).nativeRequired, false);
  assert.equal(classifyPaths([]).nativeRequired, false);
});

test('app, dependency, Engine, Expo, plugins and build-workflow paths without verified snapshots always build', () => {
  for (const path of ['src/App.tsx', 'src/view.ios.tsx', 'src/view.android.tsx', 'index.ts', 'app.json', 'app.config.ts', 'package.json', 'package-lock.json', '.nvmrc', 'metro.config.js', 'babel.config.js', 'android/build.gradle', 'ios/Podfile', 'modules/uc-engine/core-source.json', 'modules/android-util/package.json', 'plugins/withSettings.ts', 'assets/icon.png', 'scripts/update-unified-engine-core.sh', '.github/workflows/build.yml', '.github/workflows/build-pr.yml', '.github/workflows/build-ios.yml', '.github/workflows/release.yml', '.github/workflows/testflight-notes.yml', '.github/workflows/android-build.yml', '.github/workflows/ios-build-check.yml', '.github/workflows/ci-changes.yml']) {
    assert.equal(classifyPaths(['docs/readme.md', path]).nativeRequired, true, path);
  }
});

test('unknown paths and unsafe classification inputs conservatively build', () => {
  for (const paths of [['new-file'], ['.github/workflows/new.yml'], ['scripts/new-tool.mjs'], ['DOCS/readme.md'], ['docs/../app.json'], [null], null]) assert.equal(classifyPaths(paths).nativeRequired, true);
});

test('PR uses a merge-base diff; main push includes its entire before/after range', () => {
  assert.equal(diffRange('pull_request', pr(before, after)), `${before}...${after}`);
  assert.equal(diffRange('push', push(before, after)), `${before}..${after}`);
  for (const event of [push('0'.repeat(40), after), push('--bad-option', after), { ...push(before, after), ref: 'refs/heads/topic' }]) assert.throws(() => diffRange('push', event));
});

test('manual events force native builds without reading any git diff', () => {
  let calls = 0;
  for (const platforms of ['both', 'android', 'ios']) assert.equal(detectChanges({ eventName: 'workflow_dispatch', event: { inputs: { platforms } }, git() { calls++; throw new Error('must not inspect git'); } }).nativeRequired, true);
  assert.equal(calls, 0);
});

test('unsupported events, invalid SHAs, missing history and diff failures build safely', () => {
  for (const [eventName, event] of [['pull_request', {}], ['push', push('0'.repeat(40), after)], ['push', push('$(echo unsafe)', after)], ['unknown', {}]]) {
    let calls = 0;
    assert.equal(detectChanges({ eventName, event, git() { calls++; throw new Error('invalid event'); } }).nativeRequired, true);
    assert.equal(calls, 0);
  }
  const result = detectChanges({ eventName: 'push', event: push(before, after), git() { throw new Error('history missing'); } });
  assert.equal(result.nativeRequired, true);
});

test('real PR diff excludes native changes added only to the target branch', (t) => {
  const r = repository(t); r.commit('README.md', 'base');
  r.git('checkout', '-b', 'topic'); const head = r.commit('docs/guide.md', 'docs');
  r.git('checkout', 'main'); const base = r.commit('app.json', '{}');
  assert.equal(detectChanges({ eventName: 'pull_request', event: pr(base, head), cwd: r.cwd }).nativeRequired, false);
});

test('real multi-commit main push includes native changes before the final docs commit', (t) => {
  const r = repository(t); const base = r.commit('README.md', 'base');
  r.commit('app.json', '{}'); const head = r.commit('docs/guide.md', 'docs');
  assert.equal(detectChanges({ eventName: 'push', event: push(base, head), cwd: r.cwd }).nativeRequired, true);
});

test('real docs-only main push and empty diff do not compile', (t) => {
  const r = repository(t); const base = r.commit('README.md', 'base'); const head = r.commit('docs/a space\nand newline.md', 'docs');
  assert.equal(detectChanges({ eventName: 'push', event: push(base, head), cwd: r.cwd }).nativeRequired, false);
  assert.equal(detectChanges({ eventName: 'push', event: push(head, head), cwd: r.cwd }).nativeRequired, false);
});

test('native deletions and renames into docs cannot hide native changes', (t) => {
  const r = repository(t); const base = r.commit('src/example.ts', 'same contents');
  r.git('checkout', '-b', 'rename'); mkdirSync(join(r.cwd, 'docs')); r.git('mv', 'src/example.ts', 'docs/example.md');
  r.git('commit', '-m', 'rename fixture');
  assert.equal(detectChanges({ eventName: 'pull_request', event: pr(base, r.git('rev-parse', 'HEAD')), cwd: r.cwd }).nativeRequired, true);
  r.git('checkout', 'main'); r.git('rm', 'src/example.ts'); r.git('commit', '-m', 'delete fixture');
  assert.equal(detectChanges({ eventName: 'push', event: push(base, r.git('rev-parse', 'HEAD')), cwd: r.cwd }).nativeRequired, true);
});

test('missing commits in the real repository fall back to native builds', (t) => {
  const r = repository(t); const head = r.commit('README.md', 'base');
  assert.equal(detectChanges({ eventName: 'push', event: push(before, head), cwd: r.cwd }).nativeRequired, true);
});

test('CLI writes a conservative decision for malformed events and fails if outputs cannot be written', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniclip-ci-cli-')); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = join(cwd, 'event.json'); const output = join(cwd, 'output'); writeFileSync(event, 'invalid JSON');
  const script = fileURLToPath(new URL('../ci-changes.mjs', import.meta.url));
  const env = { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output };
  assert.equal(spawnSync(process.execPath, [script], { cwd, env }).status, 0);
  assert.match(readFileSync(output, 'utf8'), /^native_required=true\nreason=/);
  assert.notEqual(spawnSync(process.execPath, [script], { cwd, env: { ...env, GITHUB_OUTPUT: join(cwd, 'absent', 'output') } }).status, 0);
});

test('workflow snapshot comparison uses the PR merge base, not unrelated target-branch recipes', (t) => {
  const r = repository(t);
  const file = '.github/workflows/build-pr.yml';
  const original = readFileSync(new URL('../../.github/workflows/build-pr.yml', import.meta.url), 'utf8');
  r.commit(file, original); r.git('checkout', '-b', 'topic');
  const head = r.commit(file, original.replaceAll('needs: [changes, code-style, unit-tests]', 'needs: [changes, unit-tests, code-style]'));
  r.git('checkout', 'main');
  const base = r.commit(file, original.replace('uses: ./.github/workflows/android-build.yml', 'uses: ./.github/workflows/other-native-build.yml'));
  assert.equal(detectChanges({ eventName: 'pull_request', event: pr(base, head), cwd: r.cwd }).nativeRequired, false);
});

test('real main workflow diffs distinguish scheduling from native implementation changes', (t) => {
  const r = repository(t); const file = '.github/workflows/build-pr.yml';
  const original = readFileSync(new URL('../../.github/workflows/build-pr.yml', import.meta.url), 'utf8');
  const base = r.commit(file, original);
  const scheduling = original.replaceAll('needs: [changes, code-style, unit-tests]', 'needs: [changes, unit-tests, code-style]');
  const head = r.commit(file, scheduling);
  assert.equal(detectChanges({ eventName: 'push', event: push(base, head), cwd: r.cwd }).nativeRequired, false);
  const native = r.commit(file, scheduling.replace('uses: ./.github/workflows/android-build.yml', 'uses: ./.github/workflows/other-native-build.yml'));
  assert.equal(detectChanges({ eventName: 'push', event: push(head, native), cwd: r.cwd }).nativeRequired, true);
});
