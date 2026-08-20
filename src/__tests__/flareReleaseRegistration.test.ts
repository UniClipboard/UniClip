/// <reference types="node" />
/// <reference types="jest" />

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

describe('FlareRelease Android registration', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('builds a registration without selecting a channel', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flare-android-registration-'));
    tempDirs.push(workDir);
    const apkDir = join(workDir, 'apk');
    mkdirSync(apkDir);
    writeFileSync(join(apkDir, 'UniClip-1.3.0-arm64-v8a.apk'), 'apk-data');
    const manifestPath = join(workDir, 'beta.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: '1.3.0.166-beta1',
        tagName: 'v1.3.0.166-beta1',
        prerelease: true,
        pub_date: '2026-08-21T00:00:00.000Z',
        notes: { en: 'English notes', zh: '中文说明' },
        assets: [{ name: 'UniClip-1.3.0-arm64-v8a.apk', sha256: 'abc123' }],
      })
    );
    const outputPath = join(workDir, 'registration.json');

    execFileSync(
      'node',
      [
        'scripts/build-flare-release-registration.mjs',
        '--manifest',
        manifestPath,
        '--apk-dir',
        apkDir,
        '--source',
        'github-actions:run-123',
        '--output',
        outputPath,
      ],
      { cwd: root }
    );

    const registration = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(registration).toMatchObject({
      product: 'android',
      version: '1.3.0.166-beta1',
      prerelease: true,
      artifacts: [
        {
          platform: 'android',
          architecture: 'arm64-v8a',
          filename: 'UniClip-1.3.0-arm64-v8a.apk',
          r2Key: 'android/artifacts/v1.3.0.166-beta1/UniClip-1.3.0-arm64-v8a.apk',
          size: 8,
          sha256: 'abc123',
        },
      ],
    });
    expect(registration).not.toHaveProperty('channel');
  });

  it('rejects a missing APK', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'flare-android-registration-'));
    tempDirs.push(workDir);
    const manifestPath = join(workDir, 'beta.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        assets: [{ name: 'missing.apk', sha256: 'abc123' }],
      })
    );

    expect(() =>
      execFileSync(
        'node',
        [
          'scripts/build-flare-release-registration.mjs',
          '--manifest',
          manifestPath,
          '--apk-dir',
          workDir,
          '--output',
          join(workDir, 'registration.json'),
        ],
        { cwd: root, stdio: 'pipe' }
      )
    ).toThrow();
  });
});
