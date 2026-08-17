import fs from 'fs';
import path from 'path';

const sourceRoot = path.join(__dirname, '..');

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

describe('platform-specific UI structure', () => {
  it('keeps Android-only UI directly under Android-owned directories', () => {
    expect(fs.existsSync(path.join(sourceRoot, 'components/android/TopRightMenu.tsx'))).toBe(true);
    expect(
      fs.existsSync(path.join(sourceRoot, 'screens/settings/android/AppearanceSection.tsx'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(sourceRoot, 'screens/settings/android/BackgroundSection.tsx'))
    ).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, 'screens/settings/android/DebugSection.tsx'))).toBe(
      true
    );
  });

  it('keeps Android-only activity roots directly under Android ownership', () => {
    expect(fs.existsSync(path.join(sourceRoot, 'app/android/QuickActionApp.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, 'app/android/ServiceRestartApp.tsx'))).toBe(true);
  });

  it('keeps small settings presentation differences in platform helpers', () => {
    const navigatorSource = readSource('navigation/AppNavigator.tsx');

    expect(navigatorSource).not.toContain('Platform.OS');
    expect(navigatorSource).toContain("from './useSettingsScreenOptions'");
    expect(
      fs.existsSync(path.join(sourceRoot, 'navigation/useSettingsScreenOptions.android.ts'))
    ).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, 'navigation/useSettingsScreenOptions.ios.ts'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(sourceRoot, 'navigation/AppNavigator.shared.tsx'))).toBe(false);
  });
});
