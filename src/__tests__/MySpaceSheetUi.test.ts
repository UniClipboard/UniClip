import fs from 'fs';
import path from 'path';

function read(relativePath: string): string {
  const absolutePath = path.resolve(__dirname, '..', relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

const homeChrome = read('screens/HomeChrome.tsx');
const homeController = read('screens/useHomeController.ts');
const homeOverlays = read('screens/HomeOverlays.tsx');
const topBarTypes = read('components/HomeTopBar.types.ts');
const topBars = ['android', 'ios'].map((platform) => read(`components/HomeTopBar.${platform}.tsx`));
const mySpaceSheets = ['android', 'ios'].map((platform) =>
  read(`components/MySpaceSheet.${platform}.tsx`)
);
const mySpaceSheetTypes = read('components/MySpaceSheet.types.ts');
const mySpaceSheetHook = read('components/useMySpaceSheet.ts');

describe('home My Space sheet', () => {
  it('shows a fixed My Space entry instead of a connection or space-name indicator', () => {
    for (const topBar of topBars) {
      expect(topBar).toContain("t('topBar.mySpace')");
      expect(topBar).not.toContain('ConnectionStatusDot');
      expect(topBar).not.toContain('spaceLabel');
    }

    expect(topBarTypes).not.toContain('spaceLabel');
    expect(topBarTypes).not.toContain('connectionStatus');

    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const home = JSON.parse(read(`i18n/locales/${locale}/home.json`));
      expect(home.topBar.mySpace).toEqual(expect.any(String));
      expect(home.topBar.mySpace.length).toBeGreaterThan(0);
    }
  });

  it('keeps the My Space entry at the left edge of the default top bar', () => {
    for (const topBar of topBars) {
      const actions = topBar.indexOf('style={s.actions}');
      const mySpaceEntry = topBar.indexOf("accessibilityLabel={t('topBar.openSpaceA11y')}");

      expect(actions).toBeGreaterThan(-1);
      expect(mySpaceEntry).toBeGreaterThan(-1);
      expect(mySpaceEntry).toBeLessThan(actions);
    }
  });

  it('uses the same top-bar control height as the neighboring actions', () => {
    expect(topBars[0]).toMatch(/spaceStatus: \{[^}]*height: 36/);
    expect(topBars[0]).toMatch(/pill: \{[^}]*height: 36/);
    expect(topBars[1]).toMatch(/spacePill: \{[^}]*height: BTN/);
  });

  it('always opens the same My Space surface without routing from partially loaded state', () => {
    expect(homeChrome).toContain('onOpenSpace={() => c.setShowMySpace(true)}');
    expect(homeChrome).not.toContain('if (c.p2pSpaceId)');
    expect(homeChrome).not.toContain('setShowAddConnection');
    expect(homeController).toContain('const [showMySpace, setShowMySpace] = useState(false)');
    expect(homeController).toContain('showMySpace,');
    expect(homeController).toContain('setShowMySpace,');
    expect(homeOverlays).toContain('<MySpaceSheet');
    expect(homeOverlays).not.toContain('<AddSyncConnectionSheet');
    expect(homeOverlays).toContain('visible={c.showMySpace}');
    expect(homeOverlays).toContain('onClose={() => c.setShowMySpace(false)}');
  });

  it('defines the same bottom-sheet contract for iOS and Android', () => {
    expect(mySpaceSheetTypes).toContain('export interface MySpaceSheetProps');
    expect(mySpaceSheetTypes).toContain('visible: boolean');
    expect(mySpaceSheetTypes).toContain('onClose: () => void');
    expect(read('components/MySpaceSheet.tsx')).toContain("export * from './MySpaceSheet.android'");

    expect(mySpaceSheets[0]).toContain('<AppBottomSheet');
    expect(mySpaceSheets[0]).not.toContain('ModalBottomSheet');
    expect(mySpaceSheets[0]).toContain('LazyColumn');
    expect(mySpaceSheets[1]).toContain('BottomSheet');
    expect(mySpaceSheets[1]).toContain('List');
  });

  it('prioritizes Engine trust state while retaining online and offline fallback', () => {
    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain('device.displayName');
      expect(sheet).toContain("'space.devices.online'");
      expect(sheet).toContain("'space.devices.offline'");
      expect(sheet).toContain("device.reachability === 'online'");
      expect(sheet).toContain('space.deviceTrust.status.${device.primaryStatus}');
    }
    expect(mySpaceSheetHook).toContain('useSpaceDeviceManagement');
    expect(mySpaceSheetHook).toContain('deviceManagement.devices');
  });

  it('opens the shared read-only detail and renders the shared space overview', () => {
    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain('<SpaceDeviceDetail');
      expect(sheet).toContain('deviceManagement.openDevice');
      expect(sheet).toContain('deviceManagement.overview.primaryStatus');
      expect(sheet).toContain('canRemove={deviceManagement.canRemoveSelected}');
    }
    expect(mySpaceSheetHook).toContain('allowHighImpactActions: false');
  });

  it('hides only the update-required overview card while retaining device status rows', () => {
    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain("deviceManagement.overview.primaryStatus !== 'updateRequired'");
      expect(sheet).toContain('space.deviceTrust.status.${device.primaryStatus}');
    }
  });

  it('groups Android device entries in a rounded list with dividers', () => {
    expect(mySpaceSheets[0]).toContain('function SpaceDeviceRow');
    expect(mySpaceSheets[0]).toContain('<Surface');
    expect(mySpaceSheets[0]).toContain('const DEVICE_LIST_SHAPE = Shape.RoundedCorner');
    expect(mySpaceSheets[0]).toContain('shape={DEVICE_LIST_SHAPE}');
    expect(mySpaceSheets[0]).toContain('<HorizontalDivider');
    expect(mySpaceSheets[0]).toContain('border={{ color: colors.outlineVariant }}');
  });

  it('consumes the unified snapshot without refreshing when the sheet opens', () => {
    expect(mySpaceSheetHook).toContain('useUnifiedSpaceStore');
    expect(mySpaceSheetHook).not.toContain('useUnifiedEngineStore');
    expect(mySpaceSheetHook).not.toContain('.refreshDevices()');
    expect(mySpaceSheetHook).not.toContain('refreshRevision');
    expect(mySpaceSheetHook).not.toContain('if (!visible) return;\n    void refresh()');
    expect(mySpaceSheetHook).toContain('hasResolvedDeviceList');
    expect(mySpaceSheetHook).toContain('deviceListRefreshStatus');
    expect(mySpaceSheetHook).toContain('getUnifiedSpaceService().refresh()');
  });

  it('uses native pull-to-refresh on both platforms bound only to user requests', () => {
    expect(mySpaceSheets[0]).toContain('PullToRefreshBox');
    expect(mySpaceSheets[0]).toContain('isRefreshing={isUserRefreshing}');
    expect(mySpaceSheets[0]).toContain('onRefresh');
    expect(mySpaceSheets[1]).toContain('refreshable(');
    expect(mySpaceSheets[1]).toContain('refreshable(() => refresh())');
  });

  it('keeps loading, error, empty, and row states mutually exclusive on both platforms', () => {
    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain('isInitialLoading');
      expect(sheet).toContain('isInitialFailed');
      expect(sheet).toContain('deviceListFailed');
      expect(sheet).toContain('isKnownEmpty');
      expect(sheet).not.toContain('!isInitialLoading && devices.length === 0');
      expect(sheet).not.toContain('!isLoading && devices.length === 0');
    }
  });

  it('uses the header plus action to create an invitation inside the sheet', () => {
    expect(mySpaceSheets[0]).toContain('ICONS.add');
    expect(mySpaceSheets[0]).not.toContain('ICONS.close');
    expect(mySpaceSheets[1]).toContain('systemName="plus"');
    expect(mySpaceSheets[1]).not.toContain('systemName="xmark"');

    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain('issueInvitation');
      expect(sheet).toContain("'space.invitation.pairingInstructions'");
      expect(sheet).toContain('invitation.invitationCode');
      expect(sheet).toContain("'space.flow.copyInvitation'");
      expect(sheet).toContain("'space.flow.shareInvitation'");
      expect(sheet).toContain('invitationTimeRemaining');
      expect(sheet).toContain('pairedDeviceName');
    }
  });

  it('disables the add action while a decision or another space operation is active', () => {
    for (const sheet of mySpaceSheets) {
      expect(sheet).toContain('canIssueInvitation');
    }
    expect(mySpaceSheets[0]).toContain('enabled={canIssueInvitation}');
    expect(mySpaceSheets[1]).toContain('enabled={canIssueInvitation}');
  });

  it('shows invitation progress only in the header action', () => {
    expect(mySpaceSheets[0]).toContain('invitationPending ?');
    expect(mySpaceSheets[0]).toContain('<CircularProgressIndicator');
    expect(mySpaceSheets[0]).toContain(
      'const invitationHeight = invitation ? 248 : invitationError ? 72 : 0;'
    );
    expect(mySpaceSheets[0]).not.toContain('invitationPending || invitationError');
    expect(mySpaceSheets[1]).toContain('pending ?');
    expect(mySpaceSheets[1]).toContain('<ProgressView modifiers={[padding()]} />');

    for (const sheet of mySpaceSheets) {
      expect(sheet).not.toContain('invitationPending && !invitation');
      expect(sheet).not.toContain("t('space.working'");
    }
  });

  it('animates Android sheet height changes when invitation content appears', () => {
    expect(mySpaceSheets[0]).toContain('animateContentSize');
    expect(mySpaceSheets[0]).toContain(
      '<Column modifiers={[fillMaxWidth(), animateContentSize()]}'
    );
  });

  it('keeps the iOS sheet at half height while loading and expands when the invitation appears', () => {
    expect(mySpaceSheets[1]).toContain("useState<PresentationDetent>('medium')");
    expect(mySpaceSheets[1]).toContain("if (!visible) setSheetDetent('medium')");
    expect(mySpaceSheets[1]).toContain("if (invitation) setSheetDetent('large')");
    expect(mySpaceSheets[1]).toContain(
      "const presentedSheetDetent = invitation ? 'large' : sheetDetent"
    );
    expect(mySpaceSheets[1]).toContain('selection: presentedSheetDetent');
    expect(mySpaceSheets[1]).toContain('onSelectionChange: setSheetDetent');

    const issueHandler = mySpaceSheets[1].match(
      /const handleIssueInvitation = \(\) => \{[\s\S]*?\n  \};/
    )?.[0];
    expect(issueHandler).toBeDefined();
    expect(issueHandler).not.toContain("setSheetDetent('large')");
  });

  it('localizes the invitation guidance and header action in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const settingsSync = JSON.parse(read(`i18n/locales/${locale}/settingsSync.json`));
      expect(settingsSync.space.invitation.pairingInstructions).toEqual(expect.any(String));
      expect(settingsSync.space.invitation.pairingInstructions.length).toBeGreaterThan(0);
      expect(settingsSync.space.invitation.addA11y).toEqual(expect.any(String));
      expect(settingsSync.space.invitation.addA11y.length).toBeGreaterThan(0);
      expect(settingsSync.space.devices.refreshFailed).toEqual(expect.any(String));
      expect(settingsSync.space.devices.refreshFailed.length).toBeGreaterThan(0);
    }
  });

  it('uses the space translations by default for Android invitation content', () => {
    expect(mySpaceSheets[0]).toMatch(
      /function MySpaceSheetContent[\s\S]*?const \{ t \} = useTranslation\('settingsSync'\)/
    );
  });
});
