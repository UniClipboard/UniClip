import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tagScript = join(__dirname, '..', '..', 'scripts', 'create-release-tag.sh');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'uniclip-release-tag-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');

  git(root, 'init', '--bare', remote);
  git(root, 'init', seed);
  git(seed, 'config', 'user.name', 'Release Test');
  git(seed, 'config', 'user.email', 'release-test@example.com');
  writeFileSync(join(seed, 'release.txt'), 'first\n');
  git(seed, 'add', 'release.txt');
  git(seed, 'commit', '-m', 'first');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-u', 'origin', 'main');
  const first = git(seed, 'rev-parse', 'HEAD');

  git(root, 'clone', '--branch', 'main', remote, work);
  return { root, remote, seed, work, first };
}

function runTagScript(work: string, tag: string, commit: string) {
  return spawnSync('bash', [tagScript], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, TAG: tag, GITHUB_SHA: commit },
  });
}

describe('release tag creation', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates a missing tag on the validated latest main commit', () => {
    const repo = createRepository();
    roots.push(repo.root);

    const result = runTagScript(repo.work, 'v1.3.0.156', repo.first);

    expect(result.status).toBe(0);
    expect(git(repo.root, '--git-dir', repo.remote, 'rev-parse', 'refs/tags/v1.3.0.156')).toBe(
      repo.first
    );
  });

  it('can preflight a missing tag without creating it', () => {
    const repo = createRepository();
    roots.push(repo.root);

    const result = spawnSync('bash', [tagScript, '--check'], {
      cwd: repo.work,
      encoding: 'utf8',
      env: { ...process.env, TAG: 'v1.3.0.156', GITHUB_SHA: repo.first },
    });

    expect(result.status).toBe(0);
    const missingTag = spawnSync(
      'git',
      ['--git-dir', repo.remote, 'rev-parse', 'refs/tags/v1.3.0.156'],
      { cwd: repo.root, encoding: 'utf8' }
    );
    expect(missingTag.status).not.toBe(0);
  });

  it('accepts a retry when the existing tag points to the same commit', () => {
    const repo = createRepository();
    roots.push(repo.root);
    const firstRun = runTagScript(repo.work, 'v1.3.0.156', repo.first);
    expect(firstRun.status).toBe(0);

    const retry = runTagScript(repo.work, 'v1.3.0.156', repo.first);

    expect(retry.status).toBe(0);
    expect(retry.stdout).toContain('already points to this commit');
  });

  it('rejects an existing tag that points to another commit', () => {
    const repo = createRepository();
    roots.push(repo.root);
    git(repo.seed, 'tag', 'v1.3.0.156', repo.first);
    git(repo.seed, 'push', 'origin', 'refs/tags/v1.3.0.156');
    writeFileSync(join(repo.seed, 'release.txt'), 'second\n');
    git(repo.seed, 'add', 'release.txt');
    git(repo.seed, 'commit', '-m', 'second');
    git(repo.seed, 'push', 'origin', 'main');
    const second = git(repo.seed, 'rev-parse', 'HEAD');

    const result = runTagScript(repo.work, 'v1.3.0.156', second);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('different commit');
  });

  it('rejects tag creation when main changed during the build', () => {
    const repo = createRepository();
    roots.push(repo.root);
    writeFileSync(join(repo.seed, 'release.txt'), 'second\n');
    git(repo.seed, 'add', 'release.txt');
    git(repo.seed, 'commit', '-m', 'second');
    git(repo.seed, 'push', 'origin', 'main');

    const result = runTagScript(repo.work, 'v1.3.0.156', repo.first);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('main changed');
    const missingTag = spawnSync(
      'git',
      ['--git-dir', repo.remote, 'rev-parse', 'refs/tags/v1.3.0.156'],
      { cwd: repo.root, encoding: 'utf8' }
    );
    expect(missingTag.status).not.toBe(0);
  });
});
