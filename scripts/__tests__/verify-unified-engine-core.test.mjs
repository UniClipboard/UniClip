import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const verifier = resolve(repositoryRoot, 'scripts/verify-unified-engine-core.mjs');
const sourceCommit = 'f856c2e283851c2874ee37cf4a44966799704a20';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

test('verifies a prepared local engine bundle without a published release manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'uc-engine-verify-'));
  const moduleRoot = join(root, 'modules/uc-engine');
  const version = 'v0.20.0-rc.16';
  const moduleVersion = '0.20.0-rc.16';
  const artifacts = {
    'UniClipboardEngine.aar': 'aar',
    'UniClipboardEngine.pom': 'pom',
    'runtime-dependencies.txt': 'runtime',
    'uc_engine_uniffi.kt': 'kotlin',
    'uc_engine_uniffi.swift': 'swift',
    'version.txt': `${version}\n`,
  };
  const frameworkFiles = [
    'Info.plist',
    'ios-arm64/Headers/module.modulemap',
    'ios-arm64/Headers/uc_engine_uniffiFFI.h',
    'ios-arm64/libuc_engine_uniffi.a',
    'ios-arm64_x86_64-simulator/Headers/module.modulemap',
    'ios-arm64_x86_64-simulator/Headers/uc_engine_uniffiFFI.h',
    'ios-arm64_x86_64-simulator/libuc_engine_uniffi.a',
  ];
  const artifactHashes = Object.fromEntries(
    Object.entries(artifacts).map(([name, content]) => [name, sha256(content)])
  );
  const frameworkHashes = Object.fromEntries(
    frameworkFiles.map((file) => [file, sha256(`framework:${file}`)])
  );

  write(
    root,
    'modules/uc-engine/core-source.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        repository: 'UniClipboard/Engine',
        version,
        sourceCommit,
        artifactSource: 'local-build',
        sourceStateSha256: sha256('clean source'),
        artifacts: artifactHashes,
      },
      null,
      2
    )}\n`
  );
  write(root, 'modules/uc-engine/package.json', `${JSON.stringify({ version: moduleVersion })}\n`);
  write(
    root,
    `modules/uc-engine/android/release-maven/app/uniclipboard/uniclipboard-engine/${moduleVersion}/uniclipboard-engine-${moduleVersion}.aar`,
    artifacts['UniClipboardEngine.aar']
  );
  write(
    root,
    `modules/uc-engine/android/release-maven/app/uniclipboard/uniclipboard-engine/${moduleVersion}/uniclipboard-engine-${moduleVersion}.pom`,
    artifacts['UniClipboardEngine.pom']
  );
  write(
    root,
    'modules/uc-engine/android/release-metadata/runtime-dependencies.txt',
    artifacts['runtime-dependencies.txt']
  );
  write(
    root,
    'modules/uc-engine/android/release-metadata/uc_engine_uniffi.kt',
    artifacts['uc_engine_uniffi.kt']
  );
  write(
    root,
    'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift',
    artifacts['uc_engine_uniffi.swift']
  );
  for (const file of frameworkFiles) {
    write(
      root,
      `modules/uc-engine/ios/UniClipboardEngine.xcframework/${file}`,
      `framework:${file}`
    );
  }
  write(
    root,
    `modules/uc-engine/.artifacts/${version}/prepared.json`,
    `${JSON.stringify({
      version,
      sourceCommit,
      sourceStateSha256: sha256('clean source'),
      artifacts: artifactHashes,
      frameworkFiles: frameworkHashes,
    })}\n`
  );

  const output = execFileSync(process.execPath, [verifier, '--prepared', '--root', root], {
    encoding: 'utf8',
  });
  assert.match(output, new RegExp(`${version} from ${sourceCommit}`));
});
