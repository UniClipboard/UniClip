import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const buildWorkflow = readFileSync(join(root, '.github', 'workflows', 'build.yml'), 'utf8');
const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');

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

  it('creates the derived tag only after validation, checks, and both builds', () => {
    expect(buildWorkflow).toContain('npm run release:validate');
    expect(buildWorkflow).toContain('bash scripts/create-release-tag.sh --check');
    expect(buildWorkflow).toMatch(
      /create-release-tag:[\s\S]*needs:\s*\[prepare, code-style, unit-tests, android-build, ios-build\]/
    );
    expect(buildWorkflow).toContain('bash scripts/create-release-tag.sh');
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

  it('does not delete unrelated previous releases before publishing', () => {
    expect(releaseWorkflow).not.toContain('Delete existing releases in same channel');
    expect(releaseWorkflow).toContain('Reusing Gitee release');
  });
});
