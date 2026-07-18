/// <reference types="node" />
/// <reference types="jest" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

function readPackageScripts(): Record<string, string> {
  try {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    return packageJson.scripts;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read release scripts from package.json: ${detail}`);
  }
}

const packageScripts = readPackageScripts();
const buildWorkflow = readFileSync(join(root, '.github', 'workflows', 'build.yml'), 'utf8');
const pullRequestWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'build-pr.yml'),
  'utf8'
);
const codeStyleWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'code-style.yml'),
  'utf8'
);
const iosBuildWorkflow = readFileSync(join(root, '.github', 'workflows', 'build-ios.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const testWorkflow = readFileSync(join(root, '.github', 'workflows', 'test.yml'), 'utf8');
const eslintConfig = readFileSync(join(root, 'eslint.config.mjs'), 'utf8');
const prettierIgnore = readFileSync(join(root, '.prettierignore'), 'utf8');
const prePushHook = readFileSync(join(root, '.husky', 'pre-push'), 'utf8');

describe('validated release workflow', () => {
  it('does not publish in response to a manually pushed tag', () => {
    expect(buildWorkflow).not.toMatch(/tags:\s*\n\s*- ['"]v\*['"]/);
    expect(buildWorkflow).not.toContain("startsWith(github.ref, 'refs/tags/')");
  });

  it('offers a full release mode while preserving manual iOS builds', () => {
    expect(buildWorkflow).toContain('publish_release:');
    expect(buildWorkflow).toContain('upload_testflight:');
    expect(buildWorkflow).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('uses the same quality gate locally, before push, and in CI', () => {
    expect(packageScripts['check:quality']).toBe(
      'npm run lint && npm run format:check && npm run type-check'
    );
    expect(packageScripts['test:ci']).toBe(
      'npm test -- --runInBand && ruby scripts/asc_whats_to_test_test.rb && npm run test:coverage -- --runInBand'
    );
    expect(packageScripts['check:ci']).toBe('npm run check:quality && npm run test:ci');
    expect(packageScripts['release:check']).toBe('npm run release:validate && npm run check:ci');
    expect(codeStyleWorkflow).toContain('npm run check:quality');
    expect(testWorkflow).toContain('npm run test:ci');
    expect(prePushHook.trim()).toBe('npm run release:check');
  });

  it('uses Prettier CLI as the only formatter and ignores generated artifacts', () => {
    expect(packageScripts['format:check']).toBe('prettier --check .');
    expect(eslintConfig).not.toContain('eslint-plugin-prettier');
    expect(eslintConfig).not.toContain('prettier/prettier');
    expect(prettierIgnore).toContain('.pi-subagents/');
    expect(prettierIgnore).toContain('android/');
    expect(prettierIgnore).toContain('ios/');
    expect(prettierIgnore).toContain('**/build/');
  });

  it('gates both platform builds on code style and unit tests', () => {
    expect(buildWorkflow).toMatch(
      /android-build:\s*\n\s*needs:\s*\[prepare, code-style, unit-tests\]/
    );
    expect(buildWorkflow).toMatch(/ios-build:[\s\S]*?needs:\s*\[prepare, code-style, unit-tests\]/);
    expect(pullRequestWorkflow).toMatch(
      /android-build:\s*\n\s*needs:\s*\[code-style, unit-tests\]/
    );
  });

  it('creates the derived tag only after validation, checks, and both builds', () => {
    expect(buildWorkflow).toContain('npm run release:validate');
    expect(packageScripts['release:validate']).toContain('release-notes.mjs --check');
    expect(buildWorkflow).toContain('bash scripts/create-release-tag.sh --check');
    expect(buildWorkflow).toMatch(
      /create-release-tag:[\s\S]*needs:\s*\[prepare, code-style, unit-tests, android-build, ios-build\]/
    );
    expect(buildWorkflow).toContain('bash scripts/create-release-tag.sh');
  });

  it('validates the pinned uc-mobile source before starting release builds', () => {
    expect(packageScripts['release:validate']).toContain('validate-uc-core-ref.mjs');
    expect(buildWorkflow).toContain('npm run release:validate');
    expect(iosBuildWorkflow).toContain('rust-core/source-ref');
    expect(iosBuildWorkflow).not.toMatch(/UC_CORE_REF:\s*[0-9a-f]{40}/);
  });

  it('serializes full releases without cancelling one already in progress', () => {
    expect(buildWorkflow).toContain('uniclip-release');
    expect(buildWorkflow).toContain('cancel-in-progress: false');
  });

  it('publishes with an explicit tag instead of the triggering ref', () => {
    expect(releaseWorkflow).toContain('tag_name:');
    expect(releaseWorkflow).toContain('tag: ${{ inputs.tag_name }}');
    expect(releaseWorkflow).not.toContain('github.ref_name');
  });

  it('publishes localized TestFlight notes', () => {
    expect(releaseWorkflow).toContain('release-notes-testflight.txt');
    expect(releaseWorkflow).toContain('release-notes-testflight.en.txt');
    expect(packageScripts['test:ci']).toContain('ruby scripts/asc_whats_to_test_test.rb');
  });

  it('does not delete unrelated previous releases before publishing', () => {
    expect(releaseWorkflow).not.toContain('Delete existing releases in same channel');
    expect(releaseWorkflow).toContain('Reusing Gitee release');
  });
});
