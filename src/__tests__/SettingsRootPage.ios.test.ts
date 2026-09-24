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
    for (const page of ['history', 'clipboard', 'appearance', 'storage', 'keyboard', 'share', 'diagnostics', 'privacy', 'about', 'developer']) {
      expect(settingsRootPage).toContain(`onNavigate('${page}')`);
    }
    // sync method and space devices live in the Devices tab
    expect(settingsRootPage).not.toContain("onNavigate('syncChannel')");
  });

  it('pushes every hub page from the stable settings host', () => {
    const screen = read('screens/SettingsScreen.ios.tsx');
    for (const page of ['history', 'appearance', 'storage', 'keyboard', 'share', 'clipboard', 'diagnostics', 'privacy', 'about', 'developer']) {
      expect(screen).toContain(`<NavigationDestination value="${page}">`);
    }
  });
});
