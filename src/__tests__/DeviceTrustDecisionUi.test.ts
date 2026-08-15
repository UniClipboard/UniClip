import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

function read(relativePath: string): string {
  const path = join(root, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('global device trust decision UI', () => {
  it('uses the required platform file split and mounts above the application flows', () => {
    const entry = read('components/DeviceTrustDecision.tsx');
    const types = read('components/DeviceTrustDecision.types.ts');
    const app = read('../App.tsx');

    expect(entry).toContain("export * from './DeviceTrustDecision.android'");
    expect(types).toContain('export interface DeviceTrustDecisionProps');
    expect(app).toContain('<DeviceTrustDecision />');
    expect(app.lastIndexOf('<DeviceTrustDecision />')).toBeGreaterThan(
      app.lastIndexOf('processTextOverlay')
    );
  });

  it('prevents Android back and outside dismissal', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');

    expect(android).toContain('dismissOnBackPress: false');
    expect(android).toContain('dismissOnClickOutside: false');
    expect(android).not.toContain('onDismissRequest={onClose}');
    expect(android).toContain('useDeviceTrustDecision');
  });

  it('uses a full-screen iOS modal without an interactive dismiss path', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    expect(ios).toContain('presentationStyle="fullScreen"');
    expect(ios).toContain('onRequestClose={() => undefined}');
    expect(ios).not.toContain('presentationStyle="pageSheet"');
    expect(ios).not.toContain('onClose');
    expect(ios).toContain('useDeviceTrustDecision');
  });

  it('explains both stale decision outcomes on each platform', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("decision.outcome === 'stateChanged'");
      expect(platform).toContain("decision.outcome === 'alreadyCompleted'");
      expect(platform).toContain("t('space.deviceTrust.stateChanged')");
    }
  });

  it('explains which devices need a new invitation after each choice', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('choice.requiresRejoinNames');
      expect(platform).toContain('space.deviceTrust.requiresRejoin');
    }
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(read(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.deviceTrust.requiresRejoin).toEqual(expect.any(String));
    }
  });

  it('keeps platform branching out of the shared component contract', () => {
    const entry = read('components/DeviceTrustDecision.tsx');
    const types = read('components/DeviceTrustDecision.types.ts');

    expect(`${entry}\n${types}`).not.toContain('Platform.OS');
  });
});
