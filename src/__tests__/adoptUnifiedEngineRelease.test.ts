import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const projectRoot = join(__dirname, '..', '..');
const adopter = join(projectRoot, 'scripts', 'adopt-unified-engine-release.mjs');
const roots: string[] = [];
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
  'version.txt',
];

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mobile-engine-adoption-'));
  roots.push(root);
  const version = 'v1.2.3-rc.4';
  const sourceCommit = 'b'.repeat(40);
  const artifacts = requiredArtifacts.map((name, index) => ({
    name,
    sha256: (index + 1).toString(16).repeat(64),
    size: index + 1,
  }));
  const manifestText = `${JSON.stringify(
    { schemaVersion: 1, release: { version, commit: sourceCommit }, artifacts },
    null,
    2
  )}\n`;
  const manifestPath = join(root, 'release-manifest.json');
  write(manifestPath, manifestText);
  write(join(root, 'modules/uc-engine/core-source.json'), '{}\n');
  write(join(root, 'modules/uc-engine/package.json'), '{"name":"uc-engine","version":"0.0.0"}\n');
  write(
    join(root, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: 'uniclip',
        lockfileVersion: 3,
        packages: {
          '': { name: 'uniclip', workspaces: ['modules/*'] },
          'modules/uc-engine': { name: 'uc-engine', version: '0.0.0' },
        },
      },
      null,
      2
    )}\n`
  );
  return { root, version, sourceCommit, manifestPath, manifestText, artifacts };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('mobile Engine release adoption', () => {
  it('generates the complete pin and synchronizes module and lockfile versions', () => {
    const { root, version, sourceCommit, manifestPath, manifestText, artifacts } = fixture();

    execFileSync(
      process.execPath,
      [
        adopter,
        '--root',
        root,
        '--version',
        version,
        '--source-commit',
        sourceCommit,
        '--manifest',
        manifestPath,
      ],
      { encoding: 'utf8' }
    );

    const pin = JSON.parse(readFileSync(join(root, 'modules/uc-engine/core-source.json'), 'utf8'));
    const modulePackage = JSON.parse(
      readFileSync(join(root, 'modules/uc-engine/package.json'), 'utf8')
    );
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect(pin).toEqual({
      schemaVersion: 1,
      repository: 'UniClipboard/Engine',
      version,
      sourceCommit,
      releaseManifestSha256: createHash('sha256').update(manifestText).digest('hex'),
      swiftPackageChecksum: artifacts.find(
        (artifact) => artifact.name === 'UniClipboardEngine.xcframework.zip'
      )?.sha256,
      artifacts: Object.fromEntries(artifacts.map((artifact) => [artifact.name, artifact.sha256])),
    });
    expect(modulePackage.version).toBe('1.2.3-rc.4');
    expect(lock.packages['modules/uc-engine'].version).toBe('1.2.3-rc.4');
  });

  it('rejects a notification that disagrees with the public release manifest', () => {
    const { root, version, manifestPath } = fixture();
    const result = spawnSync(
      process.execPath,
      [
        adopter,
        '--root',
        root,
        '--version',
        version,
        '--source-commit',
        'c'.repeat(40),
        '--manifest',
        manifestPath,
      ],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('release source commit does not match the notification');
  });
});
