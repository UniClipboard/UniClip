/// <reference types="node" />
/// <reference types="jest" />

import { existsSync, readFileSync } from 'node:fs';
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
const androidBuildWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'android-build.yml'),
  'utf8'
);
const iosBuildCheckPath = join(root, '.github', 'workflows', 'ios-build-check.yml');
const iosBuildCheckWorkflow = existsSync(iosBuildCheckPath)
  ? readFileSync(iosBuildCheckPath, 'utf8')
  : '';
const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const engineAdoptionWorkflowPath = join(root, '.github', 'workflows', 'adopt-engine-release.yml');
const engineAdoptionWorkflow = existsSync(engineAdoptionWorkflowPath)
  ? readFileSync(engineAdoptionWorkflowPath, 'utf8')
  : '';
const androidManifestScript = readFileSync(
  join(root, 'scripts', 'assemble-android-manifest.mjs'),
  'utf8'
);
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

  it('does not rebuild the retired mobile core during iOS releases', () => {
    expect(packageScripts['release:validate']).not.toContain('validate-uc-core-ref.mjs');
    expect(buildWorkflow).toContain('npm run release:validate');
    expect(iosBuildWorkflow).not.toContain('rust-core/source-ref');
    expect(iosBuildWorkflow).not.toContain('modules/uc-core');
    expect(iosBuildCheckWorkflow).not.toContain('modules/uc-core');
  });

  it('prepares and verifies the pinned unified engine before both platform builds', () => {
    expect(packageScripts['release:validate']).toContain('validate-unified-engine-core-source.mjs');
    expect(androidBuildWorkflow).toContain('npm run core:prepare');
    expect(androidBuildWorkflow).toContain('npm run core:verify');
    expect(iosBuildWorkflow).toContain('npm run core:prepare');
    expect(iosBuildWorkflow).toContain('npm run core:verify');
  });

  it('generates only the platform being built', () => {
    expect(androidBuildWorkflow).toContain('npx expo prebuild -p android --no-install');
    expect(iosBuildWorkflow).toContain('npx expo prebuild -p ios --clean --no-install');
    expect(iosBuildCheckWorkflow).toContain('npx expo prebuild -p ios --clean --no-install');
  });

  it('compiles the iOS app and extensions without signing on pushes and pull requests', () => {
    expect(buildWorkflow).toContain('uses: ./.github/workflows/ios-build-check.yml');
    expect(pullRequestWorkflow).toContain('uses: ./.github/workflows/ios-build-check.yml');
    expect(iosBuildCheckWorkflow).toContain('npm run core:prepare');
    expect(iosBuildCheckWorkflow).toContain('npm run core:verify');
    expect(iosBuildCheckWorkflow).toContain('generic/platform=iOS Simulator');
    expect(iosBuildCheckWorkflow).toContain('CODE_SIGNING_ALLOWED=NO');
  });

  it('publishes only the Android ABI supported by the unified engine release', () => {
    for (const releaseSurface of [androidBuildWorkflow, releaseWorkflow, androidManifestScript]) {
      expect(releaseSurface).toContain('arm64-v8a');
      expect(releaseSurface).not.toContain('armeabi-v7a');
      expect(releaseSurface).not.toContain('universal');
    }
    expect(androidBuildWorkflow).toContain('if-no-files-found: error');
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

  it('validates both platform packages before creating one Engine adoption pull request', () => {
    expect(existsSync(engineAdoptionWorkflowPath)).toBe(true);
    expect(engineAdoptionWorkflow).toContain('types: [engine_release_published]');
    expect(engineAdoptionWorkflow).toContain(
      'automation/adopt-engine-${{ github.event.client_payload.version }}'
    );
    expect(engineAdoptionWorkflow).toMatch(/android:[\s\S]*npm run core:verify/);
    expect(engineAdoptionWorkflow).toMatch(/ios:[\s\S]*npm run core:verify/);
    expect(engineAdoptionWorkflow).toMatch(
      /create-pull-request:[\s\S]*needs:\s*\[prepare, quality, android, ios\]/
    );
    expect(engineAdoptionWorkflow).toContain('changed: ${{ steps.change.outputs.changed }}');
    expect(engineAdoptionWorkflow).toContain("if: ${{ needs.prepare.outputs.changed == 'true' }}");
    expect(engineAdoptionWorkflow).toContain('--state all');
    expect(engineAdoptionWorkflow).toContain('gh pr reopen');
    expect(engineAdoptionWorkflow).toContain('actions/create-github-app-token@v3');
    expect(engineAdoptionWorkflow).toContain('permission-pull-requests: write');
    expect(engineAdoptionWorkflow).toContain('repositories: UniClip');
    expect(engineAdoptionWorkflow).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
    expect(engineAdoptionWorkflow).not.toContain('GH_TOKEN: ${{ github.token }}');
  });
});
