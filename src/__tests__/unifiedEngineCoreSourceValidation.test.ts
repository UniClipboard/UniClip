import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = join(__dirname, '..', '..');
const scriptPath = join(projectRoot, 'scripts', 'validate-unified-engine-core-source.mjs');
const requiredArtifacts = [
  'UniClipboardEngine.aar',
  'UniClipboardEngine.aar.checksum.txt',
  'UniClipboardEngine.pom',
  'UniClipboardEngine.xcframework.checksum.txt',
  'UniClipboardEngine.xcframework.zip',
  'runtime-dependencies.txt',
  'source-commit.txt',
  'uc_engine_uniffi.kt',
  'uc_engine_uniffi.swift',
];

describe('unified engine core source validation', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uniclip-engine-source-'));
    mkdirSync(join(root, 'modules', 'uc-engine'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeFixture(
    options: {
      mismatchedArtifact?: string;
      repository?: string;
      version?: string;
      versionArtifact?: 'version.txt' | 'core-version.txt';
    } = {}
  ) {
    const repository = options.repository ?? 'UniClipboard/core';
    const version = options.version ?? 'core-v1.2.3-rc.4';
    const versionArtifact = options.versionArtifact ?? 'core-version.txt';
    const sourceCommit = 'a'.repeat(40);
    const artifacts = [...requiredArtifacts, versionArtifact];
    const artifactHashes = Object.fromEntries(
      artifacts.map((name, index) => [name, (index + 1).toString(16).repeat(64)])
    );
    const manifest = {
      schemaVersion: 1,
      release: { version, commit: sourceCommit },
      artifacts: artifacts.map((name) => ({
        name,
        sha256: name === options.mismatchedArtifact ? 'f'.repeat(64) : artifactHashes[name],
        size: 1,
      })),
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = join(root, 'release-manifest.json');
    writeFileSync(manifestPath, manifestText);

    writeFileSync(
      join(root, 'modules', 'uc-engine', 'core-source.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          repository,
          version,
          sourceCommit,
          releaseManifestSha256: createHash('sha256').update(manifestText).digest('hex'),
          swiftPackageChecksum: artifactHashes['UniClipboardEngine.xcframework.zip'],
          artifacts: artifactHashes,
        },
        null,
        2
      )}\n`
    );

    return manifestPath;
  }

  function validate(manifestPath: string) {
    return spawnSync(process.execPath, [scriptPath, '--root', root, '--manifest', manifestPath], {
      encoding: 'utf8',
    });
  }

  it('accepts a release manifest that matches the pinned engine source', () => {
    const result = validate(writeFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unified engine source is available: core-v1.2.3-rc.4');
  });

  it('accepts the standalone Engine release format', () => {
    const result = validate(
      writeFixture({
        repository: 'UniClipboard/Engine',
        version: 'v1.2.3-rc.4',
        versionArtifact: 'version.txt',
      })
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unified engine source is available: v1.2.3-rc.4');
  });

  it('rejects a release manifest whose artifact checksum differs from the pin', () => {
    const result = validate(writeFixture({ mismatchedArtifact: 'UniClipboardEngine.aar' }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'release manifest checksum for UniClipboardEngine.aar does not match pin'
    );
  });
});
