import { execFileSync } from 'node:child_process';

export const FULL_SHA = /^[0-9a-f]{40}$/;

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

// The workspace version names the Maven coordinate and the module package version.
export function workspaceVersion(cargoToml) {
  const section = cargoToml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/);
  const version = section?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('Engine workspace Cargo.toml does not declare a package version');
  return `v${version}`;
}

// Resolve a branch, tag or abbreviated hash in a local Engine clone and read what the pin needs.
export function inspectCommit(engineDirectory, ref) {
  const sourceCommit = git(engineDirectory, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!FULL_SHA.test(sourceCommit)) throw new Error(`cannot resolve ${ref} to a commit`);
  const version = workspaceVersion(git(engineDirectory, ['show', `${sourceCommit}:Cargo.toml`]));
  let onMain = true;
  try {
    git(engineDirectory, ['merge-base', '--is-ancestor', sourceCommit, 'origin/main']);
  } catch {
    onMain = false;
  }
  return { sourceCommit, version, onMain };
}

// Ancestry against the default branch through the GitHub API, so CI needs no Engine clone.
export function isOnMainRemote(repository, sourceCommit) {
  const status = execFileSync(
    'gh',
    ['api', `repos/${repository}/compare/${sourceCommit}...main`, '--jq', '.status'],
    { encoding: 'utf8', stdio: 'pipe' }
  ).trim();
  return status === 'ahead' || status === 'identical';
}
