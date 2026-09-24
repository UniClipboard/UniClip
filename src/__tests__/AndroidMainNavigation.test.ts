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
    expect(android).toContain(
      '<MainNavigationBar {...props} hidden={homeImmersive} hiddenByMenu={homeAddMenuOpen} />'
    );
    expect(android).toContain("tabBarPosition: useRail ? 'left' : 'bottom'");

    // iOS keeps Home as the whole main screen and presents Settings from it
    expect(ios).toContain('<HomeView onOpenSettings={openSettings} onOpenAbout={openAbout} />');
    expect(ios).toContain("navigation.navigate('Settings')");
    expect(ios).not.toContain('createBottomTabNavigator');
  });

  it('renders a floating navigation pill on phones and a navigation rail on tablets', () => {
    const bar = read('components/android/MainNavigationBar.tsx');
    const pill = read('components/android/FloatingNavigationBar.tsx');

    expect(bar).toContain('<FloatingNavigationBar');
    expect(bar).not.toContain('<NavigationBar>');
    expect(bar).toContain("focusedOptions.tabBarPosition === 'left'");
    expect(bar).not.toContain('return null');
    expect(bar).toContain('testID(`main-tab-${item.name}`)');
    expect(bar).toContain("type: 'tabPress'");

    // the pill floats over content, anchored bottom-start, and never reaches the FAB
    expect(pill).toContain("position: 'absolute'");
    expect(pill).toContain('bottom: insets.bottom + FLOATING_NAV_MARGIN');
    expect(pill).toContain(
      'width - insets.left - insets.right - FLOATING_NAV_MARGIN * 2 - FAB_SIZE - FAB_GAP'
    );
    // each destination is one full-size pressable tab; only the expanded one shows its label
    expect(pill).toContain('testID={`main-tab-${item.name}`}');
    expect(pill).toContain('accessibilityRole="tab"');
    expect(pill).toContain('accessibilityState={{ selected: item.selected }}');
    expect(pill).toContain('numberOfLines={1}');
  });

  it('switches destinations by dragging across the pill as well as by tapping', () => {
    const pill = read('components/android/FloatingNavigationBar.tsx');

    // horizontal drags past a small slop belong to the pill; shorter touches stay taps
    expect(pill).toContain('<GestureDetector gesture={dragGesture}>');
    expect(pill).toContain('.activeOffsetX([-DRAG_ACTIVATION_DISTANCE, DRAG_ACTIVATION_DISTANCE])');
    expect(pill).toContain('onPress={() => onPress(index)}');
    // the indicator follows the finger and lands on the destination under it on release
    expect(pill).toContain('const index = hitTest(event.x, m, p, list);');
    expect(pill).toContain('scheduleOnRN(hover, index);');
    expect(pill).toContain('if (index >= 0) retarget(index);');
    expect(pill).toContain('if (item && !item.selected) item.onPress();');
  });

  it('animates the pill from one progress value so items and indicator stay in sync', () => {
    const pill = read('components/android/FloatingNavigationBar.tsx');

    // taps start the animation immediately instead of waiting for navigation to re-render
    expect(pill).toContain('scheduleOnUI(retarget, index);');
    expect(pill).toContain('moveTo(index);\n      navigate(index);');
    // only the origin collapses and the target expands; destinations passed over stay put
    expect(pill).toContain('return start + ((i === motion.target ? 1 : 0) - start) * progress;');
    // item widths and the indicator derive from the same motion, not separate layout animations
    expect(pill).toContain('width: ITEM_MIN_WIDTH + f * (extras.value[index] ?? 0),');
    expect(pill).toContain(
      'const rest = restingIndicator(motion.value, progress.value, extras.value);'
    );
    expect(pill).not.toContain('LinearTransition');
    expect(pill).not.toContain('android_ripple');
  });

  it('aligns the Home FAB with the pill and keeps destination content clear of it', () => {
    const android = read('navigation/MainScreen.android.tsx');
    const home = read('screens/HomeView.android.tsx');
    const compact = read('screens/HomeCompactView.tsx');
    const hub = read('screens/SettingsScreen.android.tsx');
    const subScreen = read('screens/settings/SettingsSubScreen.android.tsx');

    expect(android).toContain('const navigationBarShown = !useRail && !homeImmersive;');
    expect(android).toContain(
      'FLOATING_NAV_MARGIN + (FLOATING_NAV_HEIGHT - FAB_SIZE) / 2 - HOME_FAB_EDGE'
    );
    expect(android).toContain('lift > 0 ? { ...insets, bottom: insets.bottom + lift } : insets');
    expect(android).toContain('<SafeAreaInsetsContext.Provider value={value}>');
    expect(android).toContain('value={navigationBarShown ? FLOATING_NAV_CLEARANCE : 0}');
    expect(home).toContain('const immersive = c.isSearching || c.isSelectMode;');
    expect(home).toContain('onImmersiveModeChange?.(immersive);');
    expect(home).toContain('gridBottomPadding={c.insets.bottom + 80}');
    // the pill steps aside for the FAB menu scrim without moving the FAB
    expect(android).toContain('addMenuOpenSignal={homeAddMenuOpen}');
    expect(home).toContain('addMenuOpenSignal={addMenuOpenSignal}');
    expect(compact).toContain('openSignal={addMenuOpenSignal}');
    expect(compact).toContain('gridBottomPadding = 80');

    for (const page of [hub, subScreen]) {
      expect(page).toContain('bottom: insets.bottom + navClearance + 40');
      expect(page).toContain('<SettingsToastProvider bottomOffset={snackbarOffset}>');
    }
  });

  it('makes the sync method page the Devices destination instead of a settings entry', () => {
    const android = read('navigation/MainScreen.android.tsx');
    const hub = read('screens/SettingsScreen.android.tsx');
    const subScreen = read('screens/settings/SettingsSubScreen.android.tsx');

    expect(android).toContain('<SettingsSectionPage section="syncChannel" {...route.params} />');
    expect(android).toContain('<PreferencesDestination navigationBarShown={floatingNavShown} />');
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

describe('Android floating navigation and FAB motion', () => {
  it('keeps the pill mounted and hides it on the UI thread', () => {
    const pill = read('components/android/FloatingNavigationBar.tsx');

    // no remount: hiding slides + scales + fades the pill and drops its touches
    expect(pill).not.toContain('entering=');
    expect(pill).not.toContain('exiting=');
    expect(pill).toContain('hiddenByProp.value || hiddenByMenu.value');
    expect(pill).toContain('{ translateY: (1 - shown.value) * HIDDEN_OFFSET_Y },');
    expect(pill).toContain("hiddenByProp.value || hiddenByMenu.value ? 'none' : 'box-none'");
  });

  it('responds to FAB taps from local state and morphs the FAB with the menu progress', () => {
    const fab = read('components/AddActionsFab.android.tsx');

    // the tap animates immediately; the parent update runs as a transition
    expect(fab).toContain('startTransition(() => onOpenChange(next));');
    expect(fab).toContain('if (openSignal) openSignal.value = localOpen;');
    expect(fab).toContain('setOpen(!localOpen);');
    // color and shape follow the same progress as the + to x rotation
    expect(fab).toContain(
      'backgroundColor: interpolateColor(progress.value, [0, 1], [accentContainer, accent]),'
    );
    expect(fab).toContain(
      'borderRadius: FAB_CORNER + (FAB_SIZE / 2 - FAB_CORNER) * Math.min(1, progress.value),'
    );
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
