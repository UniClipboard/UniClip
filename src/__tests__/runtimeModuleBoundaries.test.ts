import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'src');

function source(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), 'utf8');
}

describe('runtime module boundaries', () => {
  it('does not route App Group sync back through its public entry point', () => {
    const sync = source('platform/app-group/appGroupSync.ts');

    expect(sync).toContain("from './appGroupAdapter'");
    expect(sync).not.toContain("from '@/platform/app-group'");
  });

  it('does not route App Group sync through the settings public entry point', () => {
    const sync = source('platform/app-group/appGroupSync.ts');

    expect(sync).toContain("from '@/features/settings/store'");
    expect(sync).not.toContain("from '@/features/settings'");
  });

  it('does not route the settings store through the App Group public entry point', () => {
    const store = source('features/settings/store.ts');

    expect(store).toContain("from '@/platform/app-group/appGroupAdapter'");
    expect(store).not.toContain("from '@/platform/app-group'");
  });

  it('does not route configuration storage through the App Group public entry point', () => {
    const storage = source('features/settings/internal/configStorage.ts');

    expect(storage).toContain("from '@/platform/app-group/appGroupSeed'");
    expect(storage).not.toContain("from '@/platform/app-group'");
  });

  it('uses an iOS page transition implementation without Compose animations', () => {
    const iosPath = join(sourceRoot, 'components/ui/SheetPageTransition.ios.tsx');

    expect(existsSync(iosPath)).toBe(true);
    expect(readFileSync(iosPath, 'utf8')).not.toContain('@expo/ui/jetpack-compose');
  });
});
