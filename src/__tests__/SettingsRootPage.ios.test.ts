import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const settingsRootPage = read('screens/settings/ios/SettingsRootPage.tsx');

describe('iOS settings root page', () => {
  it('does not refresh keyboard status whenever a sub-page returns', () => {
    expect(settingsRootPage).not.toContain('active = true');
    expect(settingsRootPage).not.toContain('if (active) refreshKeyboard();');
  });

  it('shows the native version together with the iOS build number on the About page', () => {
    expect(settingsRootPage).toContain('value={APP_VERSION}');
    const about = read('screens/settings/ios/AboutPage.tsx');
    expect(about).toContain("import { APP_VERSION_WITH_BUILD } from '@/constants'");
    expect(about).toContain('APP_VERSION_WITH_BUILD');
  });

  it('groups the hub into sync, general, extensions, support and other', () => {
    const sections = [
      "t('hub.clipboardSync.title')",
      "t('general.sectionTitle')",
      "t('category.extensions')",
      "t('category.support')",
      "t('category.other')",
    ].map((header) => settingsRootPage.indexOf(header));
    expect(sections.every((index) => index > 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    for (const page of ['history', 'clipboard', 'storage', 'keyboard', 'share', 'diagnostics', 'privacy', 'about', 'developer']) {
      expect(settingsRootPage).toContain(`onNavigate('${page}')`);
    }
    // theme and language are menu rows in the hub, not a pushed Appearance page
    expect(settingsRootPage).not.toContain("onNavigate('appearance')");
    // sync method and space devices live in the Devices tab
    expect(settingsRootPage).not.toContain("onNavigate('syncChannel')");
  });

  it('picks theme and language from full-row menu pickers in the General section', () => {
    const general = settingsRootPage.slice(
      settingsRootPage.indexOf("t('general.sectionTitle')"),
      settingsRootPage.indexOf("t('category.extensions')")
    );
    expect(general).toMatch(/<SettingsPickerRow\s+testID="settings-theme"/);
    expect(general).toMatch(/<SettingsPickerRow\s+testID="settings-language"/);
    expect(settingsRootPage).toContain('SUPPORTED_LANGUAGES.map');
    const common = read('screens/settings/ios/common.tsx');
    expect(common).toMatch(/export function SettingsPickerRow[\s\S]*?pickerStyle\('menu'\)/);
    expect(fs.existsSync(path.resolve(__dirname, '..', 'screens/settings/ios/AppearancePage.tsx'))).toBe(false);
  });

  it('pushes every hub page from the stable settings host', () => {
    const screen = read('screens/SettingsScreen.ios.tsx');
    for (const page of ['history', 'storage', 'keyboard', 'share', 'clipboard', 'diagnostics', 'privacy', 'about', 'developer']) {
      expect(screen).toContain(`<NavigationDestination value="${page}">`);
    }
    expect(screen).not.toContain('<NavigationDestination value="appearance">');
  });
});
