import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('iOS top-level navigation', () => {
  const main = read('navigation/MainScreen.ios.tsx');
  const bar = read('components/ios/MainTabBar.tsx');
  const home = read('screens/HomeView.ios.tsx');

  it('hosts Clipboard, Devices and Settings as tabs with a floating glass tab bar', () => {
    expect(main).toContain('createBottomTabNavigator<MainTabParamList>()');
    for (const name of ['Clipboard', 'Devices', 'Preferences']) {
      expect(main).toContain(`name="${name}"`);
    }
    expect(main).toContain('<DevicesScreen {...route.params} />');
    expect(main).toContain('<SettingsScreen />');
    expect(bar).toContain('<GlassContainer shape="capsule"');
    expect(bar).toContain("position: 'absolute'");
    expect(bar).toContain('testID={`main-tab-${name}`}');
    expect(bar).toContain("type: 'tabPress'");
  });

  it('keeps search as a separate circle that always searches the clipboard history', () => {
    expect(bar).toContain('testID="main-tab-search"');
    expect(main).toMatch(
      /onSearch=\{\(\) => \{\s*props\.navigation\.navigate\('Clipboard'\);\s*setSearchRequestId\(\(id\) => id \+ 1\);/
    );
    expect(home).toContain('if (searchRequestId === handledSearchRequest.current) return;');
    expect(home).toContain('openSearch();');
  });

  it('hides the tab bar while the home page searches or selects', () => {
    expect(main).toContain('hidden={homeImmersive}');
    expect(home).toContain('const immersive = c.isSearching || c.isSelectMode;');
    expect(home).toContain('onImmersiveModeChange?.(immersive);');
    expect(bar).toContain("pointerEvents={hidden ? 'none' : 'box-none'}");
  });

  it('routes space notifications and LAN deep links to the Devices tab', () => {
    expect(read('navigation/openSpaceDevices.ios.ts')).toContain(
      "navigateWhenReady('Main', { screen: 'Devices', params: target })"
    );
    expect(read('features/lan-servers/openLanServerSettings.ios.ts')).toContain(
      "navigateWhenReady('Main', { screen: 'Devices' })"
    );
  });

  it('moves the add actions into the top-right glass menu instead of a FAB', () => {
    const topBar = read('components/HomeTopBar.ios.tsx');
    expect(home).toContain('showAddActionsFab={false}');
    expect(home).toContain('addActions={addActions}');
    expect(topBar).toContain('testID="home-add-menu"');
    expect(topBar).toContain("pickerStyle('inline')");
    expect(topBar).toContain("t('layout.title', { ns: 'history' })");
  });
});
