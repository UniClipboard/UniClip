/// <reference types="node" />
/// <reference types="jest" />

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse } from 'yaml';

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
const gitcodeMirrorWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'mirror-android-gitcode.yml'),
  'utf8'
);
const androidManifestScript = readFileSync(
  join(root, 'scripts', 'assemble-android-manifest.mjs'),
  'utf8'
);
const flareReleaseRegistrationScript = readFileSync(
  join(root, 'scripts', 'build-flare-release-registration.mjs'),
  'utf8'
);
const testWorkflow = readFileSync(join(root, '.github', 'workflows', 'test.yml'), 'utf8');
const eslintConfig = readFileSync(join(root, 'eslint.config.mjs'), 'utf8');
const prePushHook = readFileSync(join(root, '.husky', 'pre-push'), 'utf8');

describe('validated release workflow', () => {
  it('keeps dependency installation separate from release credentials', () => {
    execFileSync(process.execPath, ['--test', 'scripts/__tests__/build-secret-boundary.test.cjs'], {
      cwd: root,
      stdio: 'pipe',
    });
  });

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
      'npm run lint && npm run type-check'
    );
    expect(packageScripts['test:ci']).toBe(
      'npm test -- --runInBand && ruby scripts/asc_whats_to_test_test.rb && ruby scripts/asc_latest_build_test.rb && npm run test:coverage -- --runInBand'
    );
    expect(packageScripts['check:ci']).toBe('npm run check:quality && npm run test:ci');
    expect(packageScripts['release:check']).toBe('npm run release:validate && npm run check:ci');
    expect(codeStyleWorkflow).toContain('npm run check:quality');
    expect(testWorkflow).toContain('npm run test:ci');
    expect(prePushHook.trim()).toBe('npm run release:check');
  });

  it('does not require Prettier for development or release checks', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(JSON.stringify(packageJson.scripts)).not.toContain('prettier');
    expect(packageJson['lint-staged']).toEqual({ '*.{ts,tsx,js,jsx}': 'eslint' });
    expect(packageJson.devDependencies).not.toHaveProperty('prettier');
    expect(packageJson.devDependencies).not.toHaveProperty('eslint-config-prettier');
    expect(eslintConfig).not.toContain('prettier');
  });

  it('gates both platform builds on code style and unit tests', () => {
    const mainJobs = parse(buildWorkflow).jobs;
    const prJobs = parse(pullRequestWorkflow).jobs;
    expect(mainJobs['android-build'].needs).toEqual(
      expect.arrayContaining(['prepare', 'changes', 'code-style', 'unit-tests'])
    );
    expect(mainJobs['ios-build'].needs).toEqual(['prepare', 'code-style', 'unit-tests']);
    expect(prJobs['android-build'].needs).toEqual(
      expect.arrayContaining(['changes', 'code-style', 'unit-tests'])
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

  it('publishes Android-only, iOS-only, or both from one release mode', () => {
    expect(buildWorkflow).toMatch(
      /platforms:[\s\S]*?type: choice[\s\S]*?- both\s*\n\s*- android\s*\n\s*- ios/
    );
    expect(parse(buildWorkflow).jobs['android-build'].if).toBe(
      "${{ always() && (github.event_name != 'workflow_dispatch' || inputs.platforms != 'ios') }}"
    );
    expect(buildWorkflow).toContain(
      "if: ${{ github.event_name == 'workflow_dispatch' && inputs.platforms != 'android' }}"
    );
    // A deselected platform is skipped, never a reason to tag a failed build.
    expect(buildWorkflow).toContain(
      "(needs.android-build.result == 'success' || (inputs.platforms == 'ios' && needs.android-build.result == 'skipped'))"
    );
    expect(buildWorkflow).toContain(
      "(needs.ios-build.result == 'success' || (inputs.platforms == 'android' && needs.ios-build.result == 'skipped'))"
    );
    expect(buildWorkflow).toContain('platforms: ${{ inputs.platforms }}');
    expect(releaseWorkflow).toMatch(/testflight:[\s\S]*?if: \$\{\{ inputs\.platforms != 'android' \}\}/);
    expect(releaseWorkflow).toMatch(
      /android-release:[\s\S]*?if: \$\{\{ inputs\.platforms != 'ios' \}\}/
    );
    expect(releaseWorkflow).toContain('node scripts/release-notes.mjs --platform "$PLATFORMS"');
    expect(releaseWorkflow).toContain("makeLatest: ${{ inputs.platforms == 'ios' && 'false' || 'legacy' }}");
  });

  it('refuses any published build number an earlier artifact already consumed', () => {
    expect(packageScripts['release:check-build']).toBe('node scripts/check-build-number.mjs');
    expect(buildWorkflow).toMatch(
      /name: Require an unused build number[\s\S]*?asc_latest_build\.rb[\s\S]*?check-build-number\.mjs --require-origin --ignore-tag "\$TAG" --asc-max "\$ASC_MAX"/
    );
    expect(iosBuildWorkflow).toMatch(
      /name: Require an unused build number \(TestFlight dev build\)\s*\n\s*if: \$\{\{ inputs\.upload_testflight \}\}[\s\S]*?check-build-number\.mjs --require-origin --build "\$BUILD" --asc-max "\$ASC_MAX"/
    );
    // The number is checked before the long archive, not after the upload.
    expect(iosBuildWorkflow.indexOf('Require an unused build number')).toBeLessThan(
      iosBuildWorkflow.indexOf('- name: Archive')
    );
  });

  it('serializes TestFlight dev uploads with releases because both consume numbers', () => {
    expect(buildWorkflow).toContain(
      "(inputs.publish_release || inputs.upload_testflight) && 'uniclip-release'"
    );
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

  it('marks Alpha tags as prereleases for every public release surface', () => {
    expect(releaseWorkflow).toContain("contains(inputs.tag_name, '-alpha.')");
  });

  it('publishes Android updates to R2 and GitHub, with GitCode only as a verified mirror', () => {
    expect(releaseWorkflow).not.toMatch(/gitee/i);
    expect(gitcodeMirrorWorkflow).not.toMatch(/gitee/i);
  });

  it('mirrors the already built APK to GitCode after FlareRelease registration without blocking the release', () => {
    const job = parse(releaseWorkflow).jobs['mirror-android-gitcode'];
    expect(job.uses).toBe('./.github/workflows/mirror-android-gitcode.yml');
    expect(job.needs).toBe('android-release');
    expect(job.if).toBe("${{ inputs.platforms != 'ios' }}");
    expect(job.with).toEqual({ tag_name: '${{ inputs.tag_name }}', non_blocking: true });
    expect(job.secrets).toBe('inherit');
  });

  it('copies the same signed bytes and never rebuilds, re-signs or installs dependencies', () => {
    const workflow = parse(gitcodeMirrorWorkflow);
    expect(workflow.on).toHaveProperty('workflow_call');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(gitcodeMirrorWorkflow).toContain('name: apk-arm64-v8a');
    expect(gitcodeMirrorWorkflow).toContain('gh release download');
    // A release started by hand is still a workflow_dispatch run for called workflows.
    expect(gitcodeMirrorWorkflow).not.toContain('github.event_name');
    expect(gitcodeMirrorWorkflow).toContain('inputs.from_release == true');
    expect(gitcodeMirrorWorkflow).not.toMatch(/gradlew|expo prebuild|assembleRelease|apksigner|npm (ci|install)/);
    expect(gitcodeMirrorWorkflow).toContain('mirror-android-apk-to-gitcode.mjs');
  });

  it('keeps GitCode credentials in repository secrets and fails loudly when run by hand', () => {
    expect(gitcodeMirrorWorkflow).toContain('secrets.GITCODE_RELEASE_TOKEN');
    expect(gitcodeMirrorWorkflow).toContain('vars.GITCODE_OWNER');
    expect(gitcodeMirrorWorkflow).toContain('vars.GITCODE_REPO');
    expect(gitcodeMirrorWorkflow).toContain('secrets.FLARE_RELEASE_ACCESS_CLIENT_ID');
    expect(gitcodeMirrorWorkflow).toContain('secrets.FLARE_RELEASE_ACCESS_CLIENT_SECRET');
    expect(gitcodeMirrorWorkflow).toContain('continue-on-error: ${{ inputs.non_blocking == true }}');
    expect(gitcodeMirrorWorkflow).toContain("--missing-config \"${{ inputs.non_blocking == true && 'skip' || 'fail' }}\"");
    // A job timeout is a job failure that continue-on-error cannot absorb, so the
    // step and the script must both give up well before the job does.
    const mirrorJob = parse(gitcodeMirrorWorkflow).jobs.mirror;
    const mirrorStep = mirrorJob.steps.find((step: { id?: string }) => step.id === 'mirror');
    expect(mirrorStep['timeout-minutes']).toBeLessThan(mirrorJob['timeout-minutes']);
    expect(mirrorStep.run).toContain('--deadline-ms');
    for (const step of mirrorJob.steps.filter((candidate: { name?: string }) =>
      /^Download (the built APK|the APK)/.test(candidate.name ?? '')
    )) {
      expect(step['continue-on-error']).toBe('${{ inputs.non_blocking == true }}');
    }
    expect(mirrorStep.run).not.toContain('${{ inputs.tag_name }}');
    expect(gitcodeMirrorWorkflow).toContain('::warning');
    expect(gitcodeMirrorWorkflow).not.toContain('GITEE');
  });

  it('registers Android releases with FlareRelease without changing a channel', () => {
    expect(releaseWorkflow).toContain('build-flare-release-registration.mjs');
    expect(releaseWorkflow).toContain('/api/releases/register');
    expect(releaseWorkflow).toContain('FLARE_RELEASE_ACCESS_CLIENT_ID');
    expect(releaseWorkflow).toContain('FLARE_RELEASE_ACCESS_CLIENT_SECRET');
    expect(releaseWorkflow).not.toContain('uniclipboard-releases/android/${channel}.json');
    expect(releaseWorkflow).not.toContain('/api/channels/');
    expect(flareReleaseRegistrationScript).toContain("product: 'android'");
    expect(flareReleaseRegistrationScript).not.toMatch(/channel\s*:/);
  });

  it('publishes localized TestFlight notes', () => {
    expect(releaseWorkflow).toContain('release-notes-testflight.txt');
    expect(releaseWorkflow).toContain('release-notes-testflight.en.txt');
    expect(packageScripts['test:ci']).toContain('ruby scripts/asc_whats_to_test_test.rb');
  });

  it('does not delete unrelated previous releases before publishing', () => {
    expect(releaseWorkflow).not.toContain('Delete existing releases in same channel');
    expect(releaseWorkflow).toContain('allowUpdates: true');
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
    // github.token is only for the read-only quality job; PR creation must keep the app token.
    const pullRequestJob = engineAdoptionWorkflow.slice(
      engineAdoptionWorkflow.indexOf('actions/create-github-app-token@v3')
    );
    expect(pullRequestJob).not.toContain('GH_TOKEN: ${{ github.token }}');
  });
});
