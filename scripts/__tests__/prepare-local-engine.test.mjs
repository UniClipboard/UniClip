import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('local preparation builds outside the app tree with isolated Cargo configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-core-test-'));
  try {
    const mobile = join(root, 'mobile');
    const engine = join(root, 'Engine');
    const module = join(mobile, 'modules/uc-engine');
    mkdirSync(join(module, '.artifacts/local'), { recursive: true });
    mkdirSync(join(mobile, 'scripts'), { recursive: true });
    mkdirSync(join(engine, 'bindings/uc-engine-uniffi/scripts'), {
      recursive: true,
    });
    writeFileSync(join(engine, 'Cargo.toml'), '');
    writeFileSync(
      join(engine, 'bindings/uc-engine-uniffi/scripts/build-android-aar.sh'),
      `#!/bin/bash
set -eu
test ! -f "$CARGO_HOME/config.toml"
mkdir -p "$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/android"
for name in UniClipboardEngine.aar UniClipboardEngine.pom runtime-dependencies.txt uc_engine_uniffi.kt; do
  touch "$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/android/$name"
done
`,
      { mode: 0o755 }
    );
    execFileSync('git', ['init', '-q', engine]);
    execFileSync('git', ['-C', engine, 'add', '.']);
    execFileSync('git', [
      '-C',
      engine,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'fixture',
    ]);
    const commit = execFileSync('git', ['-C', engine, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    writeFileSync(
      join(module, 'core-source.json'),
      JSON.stringify({
        version: 'v1.1.0-rc.13',
        sourceCommit: commit,
        artifactSource: 'local-build',
      })
    );
    cpSync(
      resolve('scripts/update-unified-engine-core.sh'),
      join(mobile, 'scripts/update-unified-engine-core.sh')
    );
    writeFileSync(
      join(mobile, 'scripts/prepare-local-unified-engine-core.sh'),
      `#!/bin/bash
set -eu
printf '%s\\n%s\\n' "$1" "$CARGO_HOME" > "$TEST_CAPTURE"
test ! -f "$CARGO_HOME/config.toml"
mkdir -p "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios"
printf 'framework' > "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios/UniClipboardEngine.xcframework.zip"
printf 'swift' > "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios/uc_engine_uniffi.swift"
`
    );
    writeFileSync(join(mobile, 'scripts/verify-unified-engine-core.mjs'), '');
    const cargo = join(root, 'user-cargo');
    mkdirSync(cargo);
    writeFileSync(join(cargo, 'config.toml'), '[build]\n');
    const capture = join(root, 'capture');
    execFileSync('bash', [join(mobile, 'scripts/update-unified-engine-core.sh')], {
      env: {
        ...process.env,
        UC_ENGINE_REPOSITORY: engine,
        UC_ENGINE_LOCAL_TARGET_DIR: join(root, 'build'),
        CARGO_HOME: cargo,
        TEST_CAPTURE: capture,
      },
      stdio: 'pipe',
    });
    const [source, cargoHome] = readFileSync(capture, 'utf8').trim().split('\n');
    assert.ok(!source.startsWith(realpathSync(mobile) + '/'));
    assert.notEqual(cargoHome, cargo);
    assert.equal(readFileSync(join(module, '.artifacts/v1.1.0-rc.13/UniClipboardEngine.xcframework.zip'), 'utf8'), 'framework');
    assert.equal(readFileSync(join(module, '.artifacts/v1.1.0-rc.13/uc_engine_uniffi.swift'), 'utf8'), 'swift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
