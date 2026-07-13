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
});
