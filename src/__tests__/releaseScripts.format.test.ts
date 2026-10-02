import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const projectRoot = join(__dirname, '..', '..');
type ScriptName = 'bump-build.mjs' | 'bump-version.mjs';

// Git hooks export GIT_DIR and friends. A fixture script that inherits them reads the real
// repository's release tags instead of the fixture's, so run fixtures without any GIT_* variable.
const isolatedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

function createFixture(scriptName: ScriptName): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'uniclip-release-script-'));
  const fixtureScripts = join(fixtureRoot, 'scripts');
  mkdirSync(fixtureScripts);
  copyFileSync(join(projectRoot, 'scripts', scriptName), join(fixtureScripts, scriptName));
  copyFileSync(
    join(projectRoot, 'scripts', 'build-counter.mjs'),
    join(fixtureScripts, 'build-counter.mjs')
  );

  const app = {
    expo: {
      version: '1.3.0',
      ios: { buildNumber: '156' },
      android: {
        versionCode: 156,
        permissions: ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.CAMERA'],
      },
    },
  };
  writeFileSync(join(fixtureRoot, 'app.json'), `${JSON.stringify(app, null, 2)}\n`);
  return fixtureRoot;
}

describe.each([
  ['bump-build.mjs', []],
  ['bump-version.mjs', ['1.4.0']],
] as const)('%s', (scriptName, args) => {
  it('rejects malformed app.json without an uncaught exception', () => {
    const fixtureRoot = createFixture(scriptName);

    try {
      writeFileSync(join(fixtureRoot, 'app.json'), '{ invalid json');
      const result = spawnSync(
        process.execPath,
        [join(fixtureRoot, 'scripts', basename(scriptName)), ...args],
        { encoding: 'utf8', env: isolatedEnv }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('could not read app.json');
      expect(result.stderr).not.toContain('\n    at ');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('updates app.json without installed dependencies and preserves unrelated settings', () => {
    const fixtureRoot = createFixture(scriptName);

    try {
      execFileSync(process.execPath, [join(fixtureRoot, 'scripts', basename(scriptName)), ...args], {
        env: isolatedEnv,
      });
      const appJsonPath = join(fixtureRoot, 'app.json');
      const result = readFileSync(appJsonPath, 'utf8');
      const app = JSON.parse(result);
      expect(app.expo.version).toBe(scriptName === 'bump-version.mjs' ? '1.4.0' : '1.3.0');
      expect(app.expo.ios.buildNumber).toBe('157');
      expect(app.expo.android.versionCode).toBe(157);
      expect(app.expo.android.permissions).toEqual([
        'android.permission.REQUEST_INSTALL_PACKAGES',
        'android.permission.CAMERA',
      ]);
      expect(result).toBe(`${JSON.stringify(app, null, 2)}\n`);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
