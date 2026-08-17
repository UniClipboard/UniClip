import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('AppNavigator native stack', () => {
  it('uses the platform-native stack without retaining the JS stack dependency', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');
    const androidOptionsSource = readSource('navigation/useSettingsScreenOptions.android.ts');
    const iosOptionsSource = readSource('navigation/useSettingsScreenOptions.ios.ts');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> };

    expect(navigatorSource).toContain("from '@react-navigation/native-stack'");
    expect(navigatorSource).toContain('createNativeStackNavigator<RootStackParamList>()');
    expect(navigatorSource).not.toContain("from '@react-navigation/stack'");
    expect(iosOptionsSource).toContain("contentStyle: { backgroundColor: 'transparent' }");
    expect(androidOptionsSource).toContain('headerShadowVisible: false');
    expect(navigatorSource).toContain("animation: 'slide_from_right'");
    expect(androidOptionsSource).toContain("animation: 'slide_from_right'");
    expect(packageJson.dependencies['@react-navigation/native-stack']).toBeDefined();
    expect(packageJson.dependencies['@react-navigation/stack']).toBeUndefined();
  });

  it('returns only persistently incomplete users to mandatory onboarding', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');
    const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'App.tsx'), 'utf8');

    expect(navigatorSource).toContain('useSpaceSetupCompletionStore');
    expect(navigatorSource).toContain("completionStatus === 'unknown'");
    expect(navigatorSource).toContain("completionStatus === 'incomplete'");
    expect(navigatorSource).toContain('setupSession');
    expect(navigatorSource).not.toContain(
      "showOnboarding = !!config && !showMigration && spaceStatus === 'empty'"
    );
    expect(navigatorSource).not.toContain('onboardingCompleted');
    expect(navigatorSource).toMatch(/<NavigationContainer\s+key=\{rootMode\}/);
    expect(navigatorSource).toContain('initialRouteName={initialRouteName}');
    expect(appSource).toContain('getSpaceSetupCompletion()');
    expect(appSource).toContain('completion.load()');
    expect(appSource).toContain('retryPendingWrite()');
  });

  it('sends upgraded LAN users to a join-only recovery screen', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');

    expect(navigatorSource).toContain('LegacyPairingGuide');
    expect(navigatorSource).toContain("legacyPairingGuide === 'pending'");
    expect(navigatorSource).toContain("spaceStatus === 'ready'");
    expect(navigatorSource).toContain("if (config && spaceStatus === 'ready'");
    expect(navigatorSource).toContain('name="Migration"');
    expect(navigatorSource).not.toContain('onDefer');
  });
});
