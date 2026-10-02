import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { classifyPaths } from '../ci-changes.mjs';
import { classifierWorkflowOnly, sameNativeRecipe } from '../ci-native-recipes.mjs';

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const path = (name) => `.github/workflows/${name}.yml`;
const change = (source, modify) => { const value = parse(source); modify(value); return stringify(value); };

for (const name of ['android-build', 'ios-build-check']) {
  test(`${name}: scheduling wrappers do not alter the native recipe`, () => {
    const current = read(name);
    const unwrapped = change(current, (value) => {
      delete value.on.workflow_call.inputs;
      if (Object.keys(value.on.workflow_call).length === 0) value.on.workflow_call = null;
      const job = value.jobs.build;
      job['runs-on'] = name === 'android-build' ? 'ubuntu-latest' : 'macos-26';
      job.steps.shift();
      for (const step of job.steps) {
        if (step.name === 'Restore Engine build cache') step.if = "steps.engine.outputs.source == 'commit'";
        else delete step.if;
      }
    });
    assert.equal(sameNativeRecipe(path(name), unwrapped, current), true);
    assert.equal(classifyPaths([path(name)], { before: () => unwrapped, after: () => current }).nativeRequired, false);
  });
  test(`${name}: changes to every build step, actions, env, artifacts or conditions require compilation`, () => {
    const current = read(name);
    for (const [index, step] of parse(current).jobs.build.steps.entries()) {
      const modified = change(current, (value) => {
        const target = value.jobs.build.steps[index];
        if (target.run) target.run += '\necho changed build command\n';
        else target.uses += '-changed';
      });
      assert.equal(sameNativeRecipe(path(name), current, modified), false, step.name);
    }
    const modifiers = [
      (v) => { v.jobs.build.env = { APP_VARIANT: 'test' }; },
      (v) => { v.jobs.build['runs-on'] = 'different-native-runner'; },
      (v) => { v.jobs.build.outputs = { version: 'different' }; },
      (v) => { v.jobs.build.steps[1].with = { ref: 'other-commit' }; },
      (v) => { v.jobs.build.steps.at(-1).if = '${{ false }}'; },
      (v) => { v.jobs.build.steps.at(-1).env = { SIGNING_MODE: 'different' }; },
      (v) => { v.jobs.build.steps.at(-1).with = { name: 'different-artifact' }; },
      (v) => { v.jobs.build.steps.push({ run: 'echo unknown new build step' }); },
    ];
    for (const modify of modifiers) assert.equal(sameNativeRecipe(path(name), current, change(current, modify)), false);
  });
}

test('orchestration changes are lightweight while recipe references and manual/release jobs stay compared', () => {
  for (const name of ['build', 'build-pr']) {
    const current = read(name);
    const scheduling = change(current, (v) => {
      v.on.push = { branches: ['**'] };
      delete v.jobs.changes;
      for (const key of ['android-build', 'ios-build-check']) {
        delete v.jobs[key].if; delete v.jobs[key].with;
        v.jobs[key].needs = ['code-style', 'unit-tests'];
      }
    });
    assert.equal(sameNativeRecipe(path(name), current, scheduling), true);
    assert.equal(sameNativeRecipe(path(name), current, change(current, (v) => { v.jobs['android-build'].uses = './.github/workflows/other.yml'; })), false);
    assert.equal(sameNativeRecipe(path(name), current, change(current, (v) => { v.jobs['android-build'].with.native_flag = 'new-build-mode'; })), false);
  }
  const current = read('build');
  for (const name of ['prepare', 'ios-build', 'create-release-tag', 'release']) {
    const modified = change(current, (v) => {
      if (v.jobs[name].steps) v.jobs[name].steps[0].run += '\necho changed\n';
      else v.jobs[name].with.new_input = 'changed';
    });
    assert.equal(sameNativeRecipe(path('build'), current, modified), false, name);
  }
  assert.equal(sameNativeRecipe(path('build'), current, change(current, (v) => { v.on.workflow_dispatch.inputs.platforms.default = 'ios'; })), false);
});

test('classifier helper cannot conceal additional jobs, compilers or dependency install scripts', () => {
  const current = read('ci-changes');
  assert.equal(classifierWorkflowOnly(current), true);
  for (const modify of [
    (v) => { v.jobs.native = { 'runs-on': 'macos-26', steps: [{ run: 'xcodebuild' }] }; },
    (v) => { v.jobs.classify.steps.push({ run: './gradlew assembleRelease' }); },
    (v) => { v.jobs.classify.steps[2].run = 'npm ci'; },
    (v) => { v.jobs.classify.env = { NODE_OPTIONS: '--require other.js' }; },
    (v) => { v.jobs.classify.steps[2].shell = 'custom-shell'; },
  ]) assert.equal(classifierWorkflowOnly(change(current, modify)), false);
});

test('unknown or invalid workflow snapshots conservatively request native builds', () => {
  for (const value of [undefined, '', 'jobs: [', 'jobs: {}\njobs: {}']) {
    assert.equal(sameNativeRecipe(path('build'), read('build'), value), false);
    assert.equal(classifierWorkflowOnly(value), false);
  }
  assert.equal(sameNativeRecipe('.github/workflows/unknown.yml', read('build'), read('build')), false);
  assert.equal(classifyPaths([path('build')]).nativeRequired, true);
  assert.equal(classifyPaths([path('build')], { before() { throw new Error('unavailable'); }, after: () => read('build') }).nativeRequired, true);
});

test('Engine pins and native bindings still require compilation alongside scheduling changes', () => {
  for (const native of ['modules/uc-engine/core-source.json', 'modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt', 'modules/uc-engine/ios/UcEngineModule.swift', 'modules/uc-engine/src/index.ts', 'src/features/relayOverview.ts']) {
    assert.equal(classifyPaths([path('build'), native], { before: () => read('build'), after: () => read('build') }).nativeRequired, true);
  }
});


test('release notifications can change without ignoring packaging, artifacts, signing or publisher commands', () => {
  const current = read('release');
  const withoutNotice = change(current, (v) => { v.jobs['github-release'].steps = v.jobs['github-release'].steps.filter((s) => s.name !== 'Request issue release verification'); });
  assert.equal(sameNativeRecipe(path('release'), withoutNotice, current), true);
  for (const modify of [
    (v) => { v.jobs['github-release'].steps.find((s) => s.name === 'Publish Release').with.artifacts = 'other/*.apk'; },
    (v) => { v.jobs.testflight.steps.at(-1).run += '\necho signing change\n'; },
    (v) => { v.jobs['android-release'].steps.at(-1).run += '\necho publishing change\n'; },
    (v) => { v.jobs['github-release'].steps.at(-1).run += '\necho additional command\n'; },
  ]) assert.equal(sameNativeRecipe(path('release'), current, change(current, modify)), false);
});
