import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as prettier from 'prettier';

const projectRoot = join(__dirname, '..', '..');
type ScriptName = 'bump-build.mjs' | 'bump-version.mjs';

function createFixture(scriptName: ScriptName): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'uniclip-release-script-'));
  const fixtureScripts = join(fixtureRoot, 'scripts');
  mkdirSync(fixtureScripts);
  copyFileSync(join(projectRoot, 'scripts', scriptName), join(fixtureScripts, scriptName));
  copyFileSync(join(projectRoot, '.prettierrc'), join(fixtureRoot, '.prettierrc'));
  symlinkSync(join(projectRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');

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
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('could not read app.json');
      expect(result.stderr).not.toContain('\n    at ');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('keeps app.json compatible with the repository format check', async () => {
    const fixtureRoot = createFixture(scriptName);

    try {
      execFileSync(process.execPath, [join(fixtureRoot, 'scripts', basename(scriptName)), ...args]);
      const appJsonPath = join(fixtureRoot, 'app.json');
      const result = readFileSync(appJsonPath, 'utf8');
      const config = await prettier.resolveConfig(appJsonPath);

      await expect(prettier.check(result, { ...config, filepath: appJsonPath })).resolves.toBe(
        true
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
