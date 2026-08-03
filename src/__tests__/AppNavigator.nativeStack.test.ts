import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('AppNavigator native stack', () => {
  it('uses the platform-native stack without retaining the JS stack dependency', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> };

    expect(navigatorSource).toContain("from '@react-navigation/native-stack'");
    expect(navigatorSource).toContain('createNativeStackNavigator<RootStackParamList>()');
    expect(navigatorSource).not.toContain("from '@react-navigation/stack'");
    expect(navigatorSource).toContain("contentStyle: { backgroundColor: 'transparent' }");
    expect(navigatorSource).toContain('headerShadowVisible: false');
    expect(navigatorSource.match(/animation: 'slide_from_right'/g) ?? []).toHaveLength(2);
    expect(packageJson.dependencies['@react-navigation/native-stack']).toBeDefined();
    expect(packageJson.dependencies['@react-navigation/stack']).toBeUndefined();
  });

  it('returns authoritative no-Space users to mandatory onboarding without guessing while loading', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');

    expect(navigatorSource).toContain('useUnifiedSpaceStore');
    expect(navigatorSource).toContain("spaceStatus === 'empty'");
    expect(navigatorSource).toContain('onboardingCompleted: false');
    expect(navigatorSource).toContain('key={rootMode}');
    expect(navigatorSource).toContain('initialRouteName={initialRouteName}');
    expect(navigatorSource).not.toContain("spaceStatus === 'loading' || spaceStatus === 'failed'");
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
