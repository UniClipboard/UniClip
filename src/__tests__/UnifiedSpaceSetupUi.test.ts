import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function optionalSource(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('unified space setup UI', () => {
  it('opens the shared native connection flow instead of duplicating setup forms', () => {
    const entry = source('screens/settings/UnifiedSpaceSetup.tsx');
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const iosSettings = source('screens/SettingsScreen.ios.tsx');

    expect(entry).toContain("export * from './UnifiedSpaceSetup.android'");
    expect(android).toContain('AddSyncConnectionSheet');
    expect(android).toContain('getUnifiedSpaceService');
    expect(android).not.toContain('.createSpace(');
    expect(android).not.toContain('.joinSpace(');
    expect(ios).toContain('onOpenSetup');
    expect(iosSettings).toContain('AddSyncConnectionSheet');
    expect(ios).toContain('getUnifiedSpaceService');
    expect(ios).not.toContain('.createSpace(');
    expect(ios).not.toContain('.joinSpace(');
  });

  it('shows when an invitation only works on the same local network', () => {
    const android = source('components/SpaceInvitationSheet.android.tsx');
    const ios = source('components/SpaceInvitationSheet.ios.tsx');
    const combined = `${android}\n${ios}`;

    expect(android).toContain("invitation.availability === 'sameLocalNetwork'");
    expect(ios).toContain("invitation.availability === 'sameLocalNetwork'");
    expect(combined).toContain('space.invitation.sameLocalNetwork');
    expect(combined).not.toContain('UnifiedSpaceProbe');
  });

  it('keeps space setup directly available on both platforms', () => {
    const androidHub = source('screens/SettingsScreen.android.tsx');
    const androidSubScreen = source('screens/settings/SettingsSubScreen.android.tsx');
    const navigation = source('navigation/AppNavigator.tsx');
    const iosRoot = source('screens/settings/ios/SettingsRootPage.tsx');
    const iosScreen = source('screens/SettingsScreen.ios.tsx');
    const iosPages = source('screens/settings/ios/types.ts');

    expect(androidHub).toContain('section="space"');
    expect(androidSubScreen).toContain("section === 'space' && <UnifiedSpaceSetup />");
    expect(navigation).toContain("| 'space'");
    expect(navigation).toContain("space: t('space.title', { ns: 'settingsSync' })");
    expect(iosRoot).toContain("onNavigate('space')");
    expect(iosRoot).not.toContain('syncChannel');
    expect(iosScreen).toContain("activePage === 'space'");
    expect(iosScreen).toContain('<SpacePage');
    expect(iosPages).toContain("| 'space'");
  });

  it('never writes the passphrase or invitation code to persistent settings', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const androidFlow = source('components/AddSyncConnectionSheet.android.tsx');
    const iosFlow = source('components/AddSyncConnectionSheet.ios.tsx');
    const sharedFlow = source('components/useAddSyncConnectionFlow.ts');
    const combined = `${android}\n${ios}\n${androidFlow}\n${iosFlow}\n${sharedFlow}`;

    expect(combined).not.toContain('AsyncStorage');
    expect(combined).not.toContain('updateConfig({ passphrase');
    expect(combined).not.toContain('updateConfig({ invitationCode');
    expect(androidFlow).toContain("passphraseState.value = ''");
    expect(iosFlow).toContain('passphraseRef.current?.clear()');
    expect(sharedFlow).toContain("setPassphrase('')");
  });

  it('supports device management and leaving the local space on both platforms', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('useUnifiedSpaceStore');
      expect(platform).toContain('.removeMember(');
      expect(platform).toContain('.leaveSpace()');
      expect(platform).toContain('space.devices.title');
      expect(platform).toContain('space.leave.action');
    }
  });

  it('lets an active space join another space before offering leave', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const sheetProps = source('components/AddSyncConnectionSheet.types.ts');

    expect(sheetProps).toContain("| 'switch'");
    for (const platform of [android, ios]) {
      expect(platform).toContain('space.switch.title');
      expect(platform).toContain('space.switch.description');
      expect(platform).toMatch(/space\.switch\.title[\s\S]*space\.leave\.action/);
    }
    expect(ios).toContain("onPress={() => onOpenSetup('switch')}");
  });

  it('keeps space actions visually distinct on iOS', () => {
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const switchSectionStart = ios.lastIndexOf(
      '<Section',
      ios.lastIndexOf('space.switch.description')
    );
    const switchSection = ios.slice(
      switchSectionStart,
      ios.indexOf('</Section>', switchSectionStart)
    );
    const leaveSectionStart = ios.lastIndexOf('<Section', ios.lastIndexOf('space.leave.confirm'));
    const leaveSection = ios.slice(leaveSectionStart, ios.indexOf('</Section>', leaveSectionStart));

    expect(switchSection).toContain('<SettingsNavRow');
    expect(switchSection).toContain('icon="arrow.triangle.2.circlepath"');
    expect(switchSection).toContain("title={t('space.switch.title')}");
    expect(switchSection).toContain('showsPressFeedback={false}');
    expect(switchSection).not.toContain('onTapGesture');
    expect(leaveSection).toContain('<SettingsNavRow');
    expect(leaveSection).toContain('icon="rectangle.portrait.and.arrow.right"');
    expect(leaveSection).toContain("title={t('space.leave.action')}");
    expect(leaveSection).toContain('destructive');
    expect(leaveSection).toContain('showsChevron={false}');
  });

  it('shows retained-device removal progress and requires an explicit permanent-loss action', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('memberRemoval');
      expect(platform).toContain('pendingRecipientDeviceIds');
      expect(platform).toContain("memberRemoval.outcome === 'recoveryRequired'");
      expect(platform).toContain('.continueMemberRevocation(');
    }
  });

  it('puts connection health and devices ahead of leaving the space', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toMatch(
        /space\.overview\.syncHealthy[\s\S]*space\.devices\.title[\s\S]*space\.leave\.action/
      );
      expect(platform).toContain('space.overview.deviceSummary');
      expect(platform).not.toContain('space.details');
    }
  });

  it('opens a focused invitation sheet instead of keeping invitations in the settings page', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const iosSettings = source('screens/SettingsScreen.ios.tsx');
    const sheetEntry = optionalSource('components/SpaceInvitationSheet.tsx');
    const sheetTypes = optionalSource('components/SpaceInvitationSheet.types.ts');
    const androidSheet = optionalSource('components/SpaceInvitationSheet.android.tsx');
    const iosSheet = optionalSource('components/SpaceInvitationSheet.ios.tsx');

    expect(sheetEntry).toContain("export * from './SpaceInvitationSheet.android'");
    expect(sheetTypes).toContain('export interface SpaceInvitationSheetProps');
    expect(androidSheet).toContain('ModalBottomSheet');
    expect(iosSheet).toContain('BottomSheet');

    for (const sheet of [androidSheet, iosSheet]) {
      expect(sheet).toContain('issueOnOpen: true');
      expect(sheet).toContain('invitation.invitationCode');
      expect(sheet).toContain('space.flow.shareInvitation');
      expect(sheet).toContain('space.flow.copyInvitation');
      expect(sheet).toContain('invitationTimeRemaining');
      expect(sheet).toContain('pairedDeviceName');
    }

    expect(android).toContain('SpaceInvitationSheet');
    expect(iosSettings).toContain('SpaceInvitationSheet');

    for (const platform of [android, ios]) {
      expect(platform).not.toContain('space.invitation.title');
      expect(platform).not.toContain('visibleInvitation');
    }
  });

  it('presents the iOS invitation from the settings sheet instead of the sliding space page', () => {
    const iosPage = source('screens/settings/ios/SpacePage.tsx');
    const iosSettings = source('screens/SettingsScreen.ios.tsx');

    expect(iosPage).not.toContain('SpaceInvitationSheet');
    expect(iosPage).toContain('onOpenInvitation');
    expect(iosSettings).toContain('showSpaceInvitation');
    expect(iosSettings).toContain('onOpenInvitation={() => setShowSpaceInvitation(true)}');
    expect(iosSettings).toContain('<SpaceInvitationSheet');
  });

  it('uses device rows for management without permanent action buttons', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(android).not.toContain('ICONS.remove');
    expect(ios).not.toContain('systemName="trash"');
    for (const platform of [android, ios]) {
      expect(platform).toContain('space.devices.manageHint');
      expect(platform).not.toContain('space.devices.inviteOnlyDevice');
    }
  });

  it('shows the local device as online without a remove action and consumes the unified snapshot', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('device.isLocal');
      expect(platform).toContain('space.devices.thisDevice');
      expect(platform).toContain('useUnifiedSpaceStore');
      expect(platform).not.toContain('useUnifiedEngineStore');
      expect(platform).not.toContain('refreshRevision');
      expect(platform).not.toContain('.refreshDevices()');
    }
  });

  it('gives the iOS space page a compact overview and manageable device rows', () => {
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(ios).toContain('SettingsIconTile');
    expect(ios).toContain('SpaceDeviceRow');
    expect(ios).toContain('onOpenSetup');
  });

  it('keeps the iOS connection sheet inside the existing settings host', () => {
    const iosPage = source('screens/settings/ios/SpacePage.tsx');
    const iosSheet = source('components/AddSyncConnectionSheet.ios.tsx');
    const iosSettings = source('screens/SettingsScreen.ios.tsx');
    const sheetProps = source('components/AddSyncConnectionSheet.types.ts');

    expect(iosPage).not.toContain('<AddSyncConnectionSheet');
    expect(iosSettings).toContain('embeddedInHost');
    expect(sheetProps).toContain('embeddedInHost?: boolean;');
    expect(iosSheet).toContain('embeddedInHost = false');
    expect(iosSheet).toContain('<ConnectionSheetHost embedded={embeddedInHost}>');
    expect(iosSheet).toContain('embedded ? <Group>');
  });

  it('gives the Android space page a compact overview and manageable device rows', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');

    expect(android).toContain('SpaceDeviceRow');
    expect(android).toContain('space.devices.online');
    expect(android).toContain('space.devices.offline');
    expect(android).toContain('space.devices.remove');
  });

  it('keeps invitation availability copy aligned in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.invitation.sameLocalNetwork).toEqual(expect.any(String));
      expect(messages.space.invitation.crossNetwork).toEqual(expect.any(String));
      expect(messages.space.devices.title).toEqual(expect.any(String));
      expect(messages.space.devices.remove).toEqual(expect.any(String));
      expect(messages.space.devices.thisDevice).toEqual(expect.any(String));
      expect(messages.space.leave.action).toEqual(expect.any(String));
      expect(messages.space.leave.confirm).toEqual(expect.any(String));
      expect(messages.space.switch.title).toEqual(expect.any(String));
      expect(messages.space.switch.description).toEqual(expect.any(String));
      expect(messages.space.switch.confirmTitle).toEqual(expect.any(String));
      expect(messages.space.switch.confirm).toEqual(expect.any(String));
      expect(messages.space.switch.confirmAction).toEqual(expect.any(String));
      expect(messages.space.status.currentDevice).toEqual(expect.any(String));
      expect(messages.space.overview.syncHealthy).toEqual(expect.any(String));
      expect(messages.space.overview.deviceSummary).toEqual(expect.any(String));
      expect(messages.space.empty.title).toEqual(expect.any(String));
      expect(messages.space.empty.body).toEqual(expect.any(String));
      expect(messages.space.devices.manageHint).toEqual(expect.any(String));
    }
  });
});
