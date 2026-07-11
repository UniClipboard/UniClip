import { execFileSync } from 'node:child_process';
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
const scriptNames = ['bump-build.mjs', 'bump-version.mjs'] as const;

function createFixture(scriptName: (typeof scriptNames)[number]): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'uniclip-release-script-'));
  const fixtureScripts = join(fixtureRoot, 'scripts');
  mkdirSync(fixtureScripts);
  copyFileSync(join(projectRoot, 'scripts', scriptName), join(fixtureScripts, scriptName));
  symlinkSync(join(projectRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');

  const app = {
    expo: {
      version: '1.3.0',
      ios: { buildNumber: '156' },
      android: {
        versionCode: 156,
        permissions: ['camera', 'files'],
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
  it('keeps app.json compatible with the repository format check', async () => {
    const fixtureRoot = createFixture(scriptName);

    try {
      execFileSync(process.execPath, [join(fixtureRoot, 'scripts', basename(scriptName)), ...args]);
      const result = readFileSync(join(fixtureRoot, 'app.json'), 'utf8');

      await expect(prettier.check(result, { filepath: 'app.json' })).resolves.toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
