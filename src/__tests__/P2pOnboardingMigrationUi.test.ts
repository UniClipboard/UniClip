import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('P2P onboarding and upgrade UI', () => {
  it('offers exactly create and join without a skip or legacy LAN scanner', () => {
    const types = source('screens/OnboardingScreen.types.ts');
    const android = source('screens/OnboardingScreen.android.tsx');
    const ios = source('screens/OnboardingScreen.ios.tsx');

    expect(types).toContain("'create'");
    expect(types).toContain("'join'");
    expect(types).not.toContain("'skip'");
    for (const platform of [android, ios]) {
      expect(platform).toContain('AddSyncConnectionSheet');
      expect(platform).toContain("setFlow('create')");
      expect(platform).toContain("setFlow('join')");
      expect(platform).toContain('onComplete');
      expect(platform).not.toContain("t('setup.skip')");
      expect(platform).not.toContain('style={s.skip}');
      expect(platform).not.toContain('QrScannerModal');
      expect(platform).not.toContain('LanArt');
    }
  });

  it('describes only the two required setup choices in every locale', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const onboarding = JSON.parse(source(`i18n/locales/${locale}/onboarding.json`));
      expect(Object.keys(onboarding.setup).sort()).toEqual(['body', 'create', 'join', 'title']);
    }
  });

  it('omits the top brand from new and upgraded user onboarding', () => {
    const screens = [
      source('screens/OnboardingScreen.android.tsx'),
      source('screens/OnboardingScreen.ios.tsx'),
      source('screens/LegacyPairingGuide.android.tsx'),
      source('screens/LegacyPairingGuide.ios.tsx'),
    ];

    for (const screen of screens) {
      expect(screen).not.toContain('BrandMark');
      expect(screen).not.toContain("t('welcome.wordmark')");
      expect(screen).not.toContain('s.brand');
      expect(screen).not.toContain('s.wordmark');
    }
  });

  it('lets the unified add sheet start directly in create or join mode', () => {
    const types = source('components/AddSyncConnectionSheet.types.ts');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(types).toContain('initialMode');
    for (const platform of [android, ios]) {
      expect(platform).toContain('initialMode');
      expect(platform).toContain('useAddSyncConnectionFlow');
    }
    expect(flow).toContain('setMode(modeFromInitial(initialMode))');
  });

  it('keeps setup out of Home because authoritative no-Space state is an onboarding gate', () => {
    const overlays = source('screens/HomeOverlays.tsx');
    const navigator = source('navigation/AppNavigator.tsx');

    expect(overlays).not.toContain('AddSyncConnectionSheet');
    expect(overlays).not.toContain('LanMigrationPrompt');
    expect(overlays).not.toContain('legacyLan');
    expect(navigator).toContain("spaceStatus === 'empty'");
  });

  it('provides a dedicated platform-native LAN recovery guide that opens Join Space directly', () => {
    const entry = source('screens/LegacyPairingGuide.tsx');
    const types = source('screens/LegacyPairingGuide.types.ts');
    const android = source('screens/LegacyPairingGuide.android.tsx');
    const ios = source('screens/LegacyPairingGuide.ios.tsx');

    expect(entry).toContain("export * from './LegacyPairingGuide.android'");
    expect(types).toContain('onComplete');
    expect(types).not.toContain('onDefer');
    for (const platform of [android, ios]) {
      expect(platform).toContain('CompanionArt');
      expect(platform).toContain('AddSyncConnectionSheet');
      expect(platform).toContain('initialMode="join"');
      expect(platform).toContain("t('migration.title')");
      expect(platform).toContain("t('migration.desktopHint')");
      expect(platform).toContain("t('migration.join')");
      expect(platform).not.toContain("'create'");
      expect(platform).not.toContain("'choose'");
    }
  });

  it('ships the recovery explanation and desktop invitation prompt in every language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const onboarding = JSON.parse(source(`i18n/locales/${locale}/onboarding.json`));

      expect(Object.keys(onboarding.migration).sort()).toEqual([
        'body',
        'desktopHint',
        'join',
        'title',
      ]);
    }

    const zh = JSON.parse(source('i18n/locales/zh/onboarding.json'));
    expect(zh.migration.join).toBe('配对新设备');
  });
});
