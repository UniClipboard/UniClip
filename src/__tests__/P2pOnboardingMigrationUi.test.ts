import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('P2P onboarding and upgrade UI', () => {
  it('introduces the app without requiring create, join, or permissions', () => {
    const types = source('screens/OnboardingScreen.types.ts');
    const screen = source('screens/OnboardingScreen.tsx');

    expect(types).toContain('onComplete');
    for (const platform of [screen]) {
      expect(platform).not.toContain('AddSyncConnectionSheet');
      expect(platform).not.toContain('requestPermission');
      expect(platform).toContain("t('skip')");
      expect(platform).toContain('PagerView');
      expect(platform).toContain('onComplete');
      expect(platform).not.toContain("t('setup.skip')");
      expect(platform).not.toContain('QrScannerModal');
      expect(platform).not.toContain('LanArt');
    }
  });

  it('describes only the two required setup choices in every locale', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const onboarding = JSON.parse(source(`i18n/locales/${locale}/onboarding.json`));
      expect(Object.keys(onboarding.setup).sort()).toEqual(['body', 'create', 'join', 'title']);
      expect(Object.keys(onboarding.result).sort()).toEqual(['body', 'enter', 'title']);
    }
  });

  it('shows one platform-native result page after create or join closes its sheet', () => {
    const entry = source('screens/SpaceSetupResult.tsx');
    const types = source('screens/SpaceSetupResult.types.ts');
    const resultScreens = [
      source('screens/SpaceSetupResult.android.tsx'),
      source('screens/SpaceSetupResult.ios.tsx'),
    ];

    expect(entry).toContain("export * from './SpaceSetupResult.android'");
    expect(types).toContain('onEnter');
    for (const platform of resultScreens) {
      expect(platform).toContain("t('result.title')");
      expect(platform).toContain("t('result.body')");
      expect(platform).toContain("t('result.enter')");
    }
    expect(source('screens/OnboardingScreen.tsx')).not.toContain('SpaceSetupResult');

    const settingsScreens = [
      source('screens/settings/UnifiedSpaceSetup.android.tsx'),
      source('screens/settings/ios/SpacePage.tsx'),
    ];
    for (const platform of settingsScreens) {
      expect(platform).not.toContain('SpaceSetupResult');
    }
  });

  it('omits the welcome header and its reserved space', () => {
    const screen = source('screens/OnboardingScreen.tsx');
    expect(screen).not.toContain('UniClipboard');
    expect(screen).not.toContain('s.header');
    expect(screen).not.toContain('s.logo');
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

  it('keeps setup in settings without blocking access to Home', () => {
    const overlays = source('screens/HomeOverlays.tsx');
    const navigator = source('navigation/AppNavigator.tsx');

    expect(overlays).not.toContain('AddSyncConnectionSheet');
    expect(overlays).not.toContain('LanMigrationPrompt');
    expect(overlays).not.toContain('legacyLan');
    expect(navigator).not.toContain("completionStatus === 'incomplete'");
  });

  it('removes the obsolete mandatory re-pairing screens', () => {
    for (const file of [
      'screens/LegacyPairingGuide.tsx',
      'screens/LegacyPairingGuide.types.ts',
      'screens/LegacyPairingGuide.android.tsx',
      'screens/LegacyPairingGuide.ios.tsx',
    ]) {
      expect(source(file)).toBe('');
    }
  });

  it('removes the obsolete re-pairing explanation from every language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const onboarding = JSON.parse(source(`i18n/locales/${locale}/onboarding.json`));
      expect(onboarding.migration).toBeUndefined();
    }
  });
});
