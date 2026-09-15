import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '../..');

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ios-native-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['prepare-ios-development-project.sh', 'ios-native-input-fingerprint.mjs']) {
    copyFileSync(join(repo, 'scripts', name), join(root, 'scripts', name));
  }
  write(join(root, 'scripts/prepare-ios-debug-frameworks.mjs'), 'process.exit(0);\n');
  for (const name of ['app.json', 'app.config.ts', 'package.json', 'package-lock.json']) {
    write(join(root, name), name);
  }
  write(join(root, 'modules/uc-engine/package.json'), '{}');
  write(join(root, 'modules/uc-engine/ios/UcEngine.swift'), 'wrapper');
  write(join(root, 'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift'), 'generated binding');
  write(join(root, 'modules/uc-engine/ios/UniClipboardEngine.xcframework/library'), 'generated library');
  write(join(root, 'src/App.tsx'), 'ordinary app source');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  write(join(bin, 'npx'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$PREPARATION_LOG"
if [[ "$*" == "expo prebuild --platform ios --no-install" ]]; then
  mkdir -p "$PREPARATION_ROOT/ios/UniClipDev.xcodeproj"
  touch "$PREPARATION_ROOT/ios/UniClipDev.xcodeproj/project.pbxproj"
  mkdir -p "$PREPARATION_ROOT/plugins/build"
  printf 'generated plugin' > "$PREPARATION_ROOT/plugins/build/generated.js"
  printf 'lock' > "$PREPARATION_ROOT/ios/Podfile.lock"
else
  mkdir -p "$PREPARATION_ROOT/ios/Pods"
  cp "$PREPARATION_ROOT/ios/Podfile.lock" "$PREPARATION_ROOT/ios/Pods/Manifest.lock"
fi
`);
  chmodSync(join(bin, 'npx'), 0o755);
  const run = () => spawnSync('bash', [join(root, 'scripts/prepare-ios-development-project.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PREPARATION_LOG: join(root, 'preparation.log'),
      PREPARATION_ROOT: root,
    },
  });
  return { root, run };
}

test('reuses native preparation until a native input changes', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(join(f.root, 'preparation.log'), 'utf8').trim().split('\n').length, 2);
  write(join(f.root, 'modules/uc-engine/ios/UcEngine.swift'), 'changed wrapper');
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(join(f.root, 'preparation.log'), 'utf8').trim().split('\n').length, 4);
});

test('Engine output and ordinary app source do not invalidate native preparation', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  write(join(f.root, 'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift'), 'new generated binding');
  write(join(f.root, 'modules/uc-engine/ios/UniClipboardEngine.xcframework/library'), 'new library');
  write(join(f.root, 'src/App.tsx'), 'changed ordinary app source');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /skipping Expo prebuild and pod install/);
  assert.equal(readFileSync(join(f.root, 'preparation.log'), 'utf8').trim().split('\n').length, 2);
});
