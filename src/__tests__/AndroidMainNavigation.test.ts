import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('Android top-level navigation', () => {
  it('hosts Clipboard, Devices and Settings as bottom navigation destinations on Android only', () => {
    const base = read('navigation/MainScreen.tsx');
    const android = read('navigation/MainScreen.android.tsx');
    const ios = read('navigation/MainScreen.ios.tsx');
    const navigator = read('navigation/AppNavigator.tsx');

    expect(base).toContain("export * from './MainScreen.android'");
    expect(navigator).toContain("import { MainScreen } from './MainScreen'");
    expect(navigator).toContain('<Stack.Screen name="Main" component={MainScreen} />');

    expect(android).toContain('createBottomTabNavigator<MainTabParamList>()');
    for (const name of ['Clipboard', 'Devices', 'Preferences']) {
      expect(android).toContain(`name="${name}"`);
    }
    expect(android).toContain('<MainNavigationBar {...props} hidden={homeImmersive} />');
    expect(android).toContain("tabBarPosition: useRail ? 'left' : 'bottom'");

    // iOS keeps Home as the whole main screen and presents Settings from it
    expect(ios).toContain('<HomeView onOpenSettings={openSettings} onOpenAbout={openAbout} />');
    expect(ios).toContain("navigation.navigate('Settings')");
    expect(ios).not.toContain('createBottomTabNavigator');
  });

  it('renders a native M3 navigation bar on phones and a navigation rail on tablets', () => {
    const bar = read('components/android/MainNavigationBar.tsx');

    expect(bar).toContain('<NavigationBar>');
    expect(bar).toContain('<NavigationBarItem');
    expect(bar).toContain("focusedOptions.tabBarPosition === 'left'");
    expect(bar).toContain('if (hidden && !isRail) return null;');
    expect(bar).toContain('testID(`main-tab-${item.name}`)');
    expect(bar).toContain("type: 'tabPress'");
  });

  it('gives the bottom inset to the navigation bar and hides it for search and selection', () => {
    const android = read('navigation/MainScreen.android.tsx');
    const home = read('screens/HomeView.android.tsx');

    expect(android).toContain('const navigationBarShown = !useRail && !homeImmersive;');
    expect(android).toContain('navigationBarShown ? { ...insets, bottom: 0 } : insets');
    expect(android).toContain('<SafeAreaInsetsContext.Provider value={homeInsets}>');
    expect(home).toContain('const immersive = c.isSearching || c.isSelectMode;');
    expect(home).toContain('onImmersiveModeChange?.(immersive);');
  });

  it('makes the sync method page the Devices destination instead of a settings entry', () => {
    const android = read('navigation/MainScreen.android.tsx');
    const hub = read('screens/SettingsScreen.android.tsx');
    const subScreen = read('screens/settings/SettingsSubScreen.android.tsx');

    expect(android).toContain('<SettingsSectionPage section="syncChannel" {...route.params} />');
    expect(subScreen).toContain('export const SettingsSectionPage');
    expect(subScreen).toContain('<SettingsSectionPage {...route.params} />');
    expect(hub).not.toContain('section="syncChannel"');
    expect(hub).not.toContain('notificationNavigationRequestId');
  });

  it('opens space device notifications in the Devices destination on Android', () => {
    const observer = read('components/DeviceTrustNotificationObserver.tsx');

    expect(observer).not.toContain("navigateWhenReady('Settings'");
    expect(read('navigation/openSpaceDevices.ts')).toContain(
      "export * from './openSpaceDevices.android'"
    );
    expect(read('navigation/openSpaceDevices.android.ts')).toContain("screen: 'Devices'");
    expect(read('navigation/AppNavigator.types.ts')).toContain(
      'Main: NavigatorScreenParams<MainTabParamList> | undefined;'
    );
  });

  it('moves tablet filters from the Home rail to the chip row next to the app navigation rail', () => {
    const android = read('screens/HomeView.android.tsx');
    const ios = read('screens/HomeView.ios.tsx');
    const expanded = read('screens/HomeExpandedView.tsx');

    expect(android).toContain('filterPlacement="chips"');
    expect(android).toContain('screenWidth={screenWidth - NAVIGATION_RAIL_WIDTH - c.insets.left}');
    expect(ios).not.toContain('filterPlacement=');
    expect(expanded).toContain("filterPlacement = 'rail'");
    expect(expanded).toContain('{filterRail && (');
    expect(expanded).toContain('{!filterRail && (');
    expect(expanded).toContain('<HomeFilterChipsRow');
  });
});

describe('Android navigation rail and tablet chip row', () => {
  it('keeps the rail clear of the status bar and matches the chip fade to its surface', () => {
    const bar = read('components/android/MainNavigationBar.tsx');
    const chips = read('components/HomeFilterChipsRow.android.tsx');
    const expanded = read('screens/HomeExpandedView.tsx');

    expect(bar).toContain('paddingTop: insets.top');
    expect(bar).toContain('width: NAVIGATION_RAIL_WIDTH + insets.left');
    expect(chips).toContain('const fadeColor = surfaceColor ?? String(colors.background);');
    expect(expanded).toContain(
      "surfaceColor={typeof paneColor === 'string' ? paneColor : undefined}"
    );
  });
});
