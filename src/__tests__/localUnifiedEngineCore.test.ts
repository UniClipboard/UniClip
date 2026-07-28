import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

function read(path: string): string {
  const fullPath = join(root, path);
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
}

describe('local unified engine preparation', () => {
  it('keeps local iOS artifacts behind an explicit verified build mode', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const prepareScript = read('scripts/prepare-local-unified-engine-core.sh');
    const verifier = read('scripts/verify-unified-engine-core.mjs');
    const podspec = read('modules/uc-engine/ios/UcEngineCore.podspec');

    expect(packageJson.scripts['core:prepare:local:ios']).toBe(
      'bash scripts/prepare-local-unified-engine-core.sh'
    );
    expect(packageJson.scripts['core:verify:local:ios']).toBe(
      'node scripts/verify-unified-engine-core.mjs --local-prepared'
    );
    expect(prepareScript).toContain('build-ios-xcframework.sh');
    expect(prepareScript).toContain('--record-local');
    expect(prepareScript).toContain('source-state-sha256');
    expect(verifier).toContain('--local-prepared');
    expect(verifier).toContain('local-prepared.json');
    expect(verifier).toContain('sourceStateSha256');
    expect(podspec).toContain('UC_ENGINE_LOCAL_CORE');
    expect(podspec).toContain('--local-prepared');
    expect(podspec).toContain('--prepared');
  });
});
