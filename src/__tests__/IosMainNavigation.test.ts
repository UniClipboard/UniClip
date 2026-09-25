import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('iOS top-level navigation', () => {
  const main = read('navigation/MainScreen.ios.tsx');
  const home = read('screens/HomeView.ios.tsx');

  it('hosts Clipboard, Devices and Settings in the native UITabBarController tab bar', () => {
    expect(main).toContain("from '@react-navigation/bottom-tabs/unstable'");
    expect(main).toContain('createNativeBottomTabNavigator<IosMainTabParamList>()');
    expect(main).not.toContain('tabBar=');
    for (const name of ['Clipboard', 'Devices', 'Preferences']) {
      expect(main).toContain(`name="${name}"`);
    }
    expect(main).toContain("tabBarIcon: { type: 'sfSymbol'");
    expect(main).toContain('<DevicesScreen {...route.params} />');
    expect(main).toContain('<SettingsScreen />');
    expect(fs.existsSync(path.resolve(__dirname, '..', 'components/ios/MainTabBar.tsx'))).toBe(false);
  });

  it('uses the system search tab as an unselectable entry that searches the clipboard history', () => {
    expect(main).toContain("tabBarSystemItem: 'search', tabBarSelectionEnabled: false");
    expect(main).toMatch(
      /tabPress: \(\) => \{\s*navigation\.navigate\('Clipboard'\);\s*setSearchRequestId\(\(id\) => id \+ 1\);/
    );
    expect(home).toContain('if (searchRequestId === handledSearchRequest.current) return;');
    expect(home).toContain('openSearch();');
  });

  it('hides the native tab bar while the home page searches or selects', () => {
    expect(main).toContain("tabBarStyle: { display: homeImmersive ? 'none' : 'flex' }");
    expect(home).toContain(
      'const immersive = c.isSearching || c.isSelectMode || c.detailPageItem != null;'
    );
    expect(home).toContain('onImmersiveModeChange?.(immersive);');
  });

  it('leaves bottom insets to SwiftUI safe areas and the home list, not native scroll-view overrides', () => {
    expect(main).toContain('overrideScrollViewContentInsetAdjustmentBehavior: false');
    expect(home).toContain('gridBottomPadding={tabBarClearance(c.insets.bottom)}');
    for (const screen of ['screens/SettingsScreen.ios.tsx', 'screens/ios/DevicesScreen.tsx']) {
      const source = read(screen);
      expect(source).toContain('<IosPageChromeProvider value={NAVIGATION_CHROME}>');
      expect(source).not.toContain('bottomClearance');
    }
  });

  it('scopes navigation chrome to the NavigationStack so sibling sheets keep their SheetHeader', () => {
    for (const screen of ['screens/SettingsScreen.ios.tsx', 'screens/ios/DevicesScreen.tsx']) {
      const source = read(screen);
      expect(source).toMatch(
        /<IosPageChromeProvider value=\{NAVIGATION_CHROME\}>\s*<NavigationStack[\s\S]*?<\/NavigationStack>\s*<\/IosPageChromeProvider>/
      );
      const providerEnd = source.indexOf('</IosPageChromeProvider>');
      for (const sheet of ['<AddSyncConnectionSheet', '<SpaceDeviceDetail', '<LanServerEditorSheet']) {
        const at = source.indexOf(sheet);
        if (at >= 0) expect(at).toBeGreaterThan(providerEnd);
      }
    }
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
