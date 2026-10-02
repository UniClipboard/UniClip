import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = (name) => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const pr = workflow('build-pr');
const build = workflow('build');
const nativeNames = ['android-build', 'ios-build-check'];
// Evaluate the small boolean expressions used by these workflows against an
// event/result matrix. No builds, actions, credentials or live API calls run.
function evaluate(expression, { needs = {}, github = {}, inputs = {}, steps = {} } = {}) {
  if (typeof expression !== 'string' || !expression.startsWith('${{')) return expression;
  const source = expression.slice(3, -2).trim().replace(/needs\.([\w-]+)/g, (_, name) => `needs[${JSON.stringify(name)}]`);
  return new Function('needs', 'github', 'inputs', 'steps', 'always', `return (${source});`)(needs, github, inputs, steps, () => true);
}
const successful = (nativeRequired = 'false') => ({
  changes: { result: 'success', outputs: { native_required: nativeRequired, reason: 'fixture' } },
  prepare: { result: 'success' }, 'code-style': { result: 'success' }, 'unit-tests': { result: 'success' },
});
const callInputs = (job, context) => Object.fromEntries(Object.entries(job.with).map(([key, value]) => [key, evaluate(value, context)]));

test('only main pushes and PRs validate automatically; manual selections remain available', () => {
  assert.deepEqual(build.on.push, { branches: ['main'] });
  assert.ok(Object.hasOwn(pr.on, 'pull_request'));
  assert.equal(Object.hasOwn(pr.on, 'push'), false);
  assert.equal(Object.hasOwn(build.on, 'pull_request'), false);
  assert.deepEqual(build.on.workflow_dispatch.inputs.platforms.options, ['both', 'android', 'ios']);
  for (const key of ['publish_release', 'build_number', 'upload_testflight']) assert.ok(build.on.workflow_dispatch.inputs[key]);
  for (const parent of [build, pr]) {
    assert.equal(parent.on.push?.paths, undefined);
    assert.equal(parent.on.push?.['paths-ignore'], undefined);
    assert.equal(parent.on.pull_request?.paths, undefined);
    assert.equal(parent.on.pull_request?.['paths-ignore'], undefined);
  }
});

test('classification has full git history, read-only credentials, and named output wiring', () => {
  const changes = workflow('ci-changes');
  assert.deepEqual(changes.permissions, { contents: 'read' });
  assert.equal(changes.jobs.classify.steps[0].with['fetch-depth'], 0);
  assert.equal(changes.jobs.classify.steps[0].with['persist-credentials'], false);
  assert.equal(changes.jobs.classify.steps.at(-1).run, 'node scripts/ci-changes.mjs');
  assert.equal(changes.on.workflow_call.outputs.native_required.value, '${{ jobs.classify.outputs.native_required }}');
  assert.equal(changes.jobs.classify.outputs.native_required, '${{ steps.changes.outputs.native_required }}');
});

test('PR and main docs/native decisions keep both existing check contexts scheduled', () => {
  for (const [parent, eventName] of [[pr, 'pull_request'], [build, 'push']]) {
    for (const nativeRequired of ['false', 'true', '']) {
      const context = { needs: successful(nativeRequired), github: { event_name: eventName } };
      for (const name of nativeNames) {
        const job = parent.jobs[name];
        assert.ok(job.if.includes('always()'));
        assert.equal(evaluate(job.if, context), true);
        assert.ok(job.needs.includes('changes'));
        assert.ok(job.needs.includes('unit-tests'));
        assert.ok(job.needs.includes('code-style'));
        const inputs = callInputs(job, context);
        assert.equal(inputs.build_required, nativeRequired !== 'false');
        assert.equal(inputs.validation_passed, true);
      }
    }
  }
});

test('failed, cancelled or skipped classification/validation cannot silently succeed as a no-op', () => {
  for (const [parent, eventName] of [[pr, 'pull_request'], [build, 'push']]) {
    for (const dependency of ['changes', 'code-style', 'unit-tests', ...(parent === build ? ['prepare'] : [])]) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        const needs = successful(); needs[dependency].result = result;
        const context = { needs, github: { event_name: eventName } };
        for (const name of nativeNames) {
          assert.equal(evaluate(parent.jobs[name].if, context), true);
          assert.equal(callInputs(parent.jobs[name], context).validation_passed, false);
        }
      }
    }
  }
});

test('manual builds bypass classification and preserve Android/iOS platform selection', () => {
  for (const platforms of ['android', 'ios', 'both']) {
    const needs = successful(); needs.changes = { result: 'skipped', outputs: {} };
    const context = { needs, github: { event_name: 'workflow_dispatch' }, inputs: { platforms } };
    assert.equal(evaluate(build.jobs.changes.if, context), false);
    assert.equal(evaluate(build.jobs['android-build'].if, context), platforms !== 'ios');
    assert.equal(evaluate(build.jobs['ios-build-check'].if, context), false);
    assert.equal(evaluate(build.jobs['ios-build'].if, context), platforms !== 'android');
    const inputs = callInputs(build.jobs['android-build'], context);
    assert.equal(inputs.build_required, true);
    assert.equal(inputs.validation_passed, true);
    needs['unit-tests'].result = 'failure';
    assert.equal(callInputs(build.jobs['android-build'], context).validation_passed, false);
  }
});

test('stable native job names complete cheaply on Ubuntu, retaining native work for real builds', () => {
  for (const name of nativeNames) {
    const definition = workflow(name); const job = definition.jobs.build;
    assert.equal(job.name, name === 'android-build' ? 'Build Release APK' : 'Build iOS app and extensions');
    assert.equal(job.if, undefined);
    assert.equal(definition.on.workflow_call.inputs.build_required.default, true);
    assert.equal(definition.on.workflow_call.inputs.validation_passed.default, true);
    for (const build_required of [false, true]) {
      for (const validation_passed of [false, true]) {
        const context = { inputs: { build_required, validation_passed }, steps: { engine: { outputs: { source: 'commit' } } } };
        assert.equal(evaluate(job['runs-on'], context), name === 'ios-build-check' && build_required && validation_passed ? 'macos-26' : 'ubuntu-latest');
        assert.equal(job.steps[0].name, 'Validate build decision');
        assert.equal(job.steps[0].if, undefined);
        for (const step of job.steps.slice(1)) assert.equal(evaluate(step.if, context), build_required && validation_passed, step.name);
      }
    }
    const cache = job.steps.find((step) => step.name === 'Restore Engine build cache');
    assert.equal(evaluate(cache.if, { inputs: { build_required: true, validation_passed: true }, steps: { engine: { outputs: { source: 'release' } } } }), false);
  }
});

test('actual completion scripts report no-build success and fail upstream errors, without executing reason text', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'uniclip-ci-checks-')); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const name of nativeNames) {
    const step = workflow(name).jobs.build.steps[0];
    const summary = join(cwd, `${name}.md`);
    for (const VALIDATION_PASSED of ['true', 'false']) {
      for (const BUILD_REQUIRED of ['true', 'false']) {
        const result = spawnSync('bash', ['-e', '-c', step.run], { cwd, env: { ...process.env, VALIDATION_PASSED, BUILD_REQUIRED, BUILD_REASON: 'docs only; $(exit 99)', GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
        assert.equal(result.status, VALIDATION_PASSED === 'true' ? 0 : 1);
      }
    }
    assert.match(readFileSync(summary, 'utf8'), /Native compilation not required: docs only; \$\(exit 99\)/);
  }
});

test('new tests run alongside existing lifecycle/app tests; no release or signing path is removed', () => {
  const commands = workflow('test').jobs['unit-tests'].steps.map((step) => step.run).filter(Boolean);
  assert.ok(commands.includes('node --test scripts/tests/ci-changes.test.mjs scripts/tests/ci-workflows.test.mjs scripts/tests/ci-native-recipes.test.mjs'));
  assert.ok(commands.includes('node --test scripts/tests/issue-lifecycle.test.mjs'));
  assert.ok(commands.includes('npm run test:ci'));
  assert.ok(commands.includes('npm run test:e2e:environment'));
  assert.equal(build.jobs['ios-build'].uses, './.github/workflows/build-ios.yml');
  assert.equal(build.jobs['ios-build'].secrets, 'inherit');
  assert.equal(build.jobs.release.uses, './.github/workflows/release.yml');
  assert.ok(build.jobs['create-release-tag'].if.includes("needs.android-build.result == 'success'"));
  assert.ok(build.jobs['create-release-tag'].if.includes("needs.ios-build.result == 'success'"));
});
