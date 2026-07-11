import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const validatorPath = join(__dirname, '..', '..', 'scripts', 'validate-release.mjs');

function createReleaseFixture(options?: {
  androidBuild?: number;
  iosBuild?: string;
  changelogTag?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'uniclip-release-metadata-'));
  const androidBuild = options?.androidBuild ?? 156;
  const iosBuild = options?.iosBuild ?? '156';
  const changelogTag = options?.changelogTag ?? 'v1.3.0.156';

  writeFileSync(
    join(root, 'app.json'),
    JSON.stringify({
      expo: {
        version: '1.3.0',
        android: { versionCode: androidBuild },
        ios: { buildNumber: iosBuild },
      },
    })
  );
  writeFileSync(join(root, 'CHANGES.md'), `${changelogTag}\n- release note\n`);
  return root;
}

function validate(root: string) {
  return spawnSync(process.execPath, [validatorPath, '--root', root], {
    encoding: 'utf8',
  });
}

describe('release metadata validation', () => {
  const fixtureRoots: string[] = [];

  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['stable', 'v1.3.0.156', 'prerelease=false'],
    ['beta', 'v1.3.0.156-beta2', 'prerelease=true'],
  ])('derives a valid %s tag from committed metadata', (_name, tag, prereleaseLine) => {
    const root = createReleaseFixture({ changelogTag: tag });
    fixtureRoots.push(root);

    const result = validate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`tag=${tag}`);
    expect(result.stdout).toContain(prereleaseLine);
  });

  it('rejects Android and iOS build counters that drift apart', () => {
    const root = createReleaseFixture({ iosBuild: '155' });
    fixtureRoots.push(root);

    const result = validate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must match');
  });

  it.each(['v1.3.0.155', 'v1.3.0.156-preview1', 'release-1.3.0.156'])(
    'rejects a changelog tag that does not describe the app build: %s',
    (changelogTag) => {
      const root = createReleaseFixture({ changelogTag });
      fixtureRoots.push(root);

      const result = validate(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('CHANGES.md');
    }
  );
});
