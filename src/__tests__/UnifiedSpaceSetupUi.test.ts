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
    const navigationTypes = source('navigation/AppNavigator.types.ts');
    const iosRoot = source('screens/settings/ios/SettingsRootPage.tsx');
    const iosScreen = source('screens/SettingsScreen.ios.tsx');
    const iosPages = source('screens/settings/ios/types.ts');

    expect(androidHub).toContain('section="space"');
    expect(androidSubScreen).toContain("section === 'space' && (");
    expect(androidSubScreen).toContain('<UnifiedSpaceSetup');
    expect(androidSubScreen).toContain('initialDeviceId={route.params.deviceId}');
    expect(navigationTypes).toContain("| 'space'");
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
    const iosSettings = source('screens/SettingsScreen.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('useUnifiedSpaceStore');
      expect(platform).toContain('.leaveSpace()');
      expect(platform).toContain('space.leave.action');
    }
    expect(android).toContain('useSpaceDeviceManagement');
    expect(android).toContain('<SpaceDeviceDetail');
    expect(iosSettings).toContain('useSpaceDeviceManagement({ allowHighImpactActions: true })');
    expect(iosSettings).toContain('<SpaceDeviceDetail');
    expect(ios).not.toContain('<SpaceDeviceDetail');
    expect(android).toContain('space.devices.otherTitle');
    expect(ios).toContain('space.devices.title');
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

  it('uses the current device relationship instead of the legacy convergence summary', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('deviceManagement.overview');
      expect(platform).not.toContain('workspaceConvergence');
      expect(platform).not.toContain('pendingRemovalDecisionDeviceIds');
      expect(platform).not.toContain('.continueMemberRevocation(');
    }
  });

  it('puts the Android page status, adding devices, and device management ahead of leaving', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const androidRelay = source('screens/settings/CustomRelaySection.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(android).toMatch(
      /space\.overview\.status[\s\S]*space\.invitation\.addAction[\s\S]*space\.devices\.thisDevice[\s\S]*space\.devices\.otherTitle[\s\S]*space\.leave\.action/
    );
    expect(android).toContain('space.overview.memberCount');
    expect(androidRelay).toContain('space.advanced.title');
    expect(android).toContain('space.danger.title');
    expect(android).not.toContain('Boolean(error)');

    expect(ios).toMatch(
      /space\.overview\.status[\s\S]*space\.devices\.title[\s\S]*space\.leave\.action/
    );
    expect(ios).toContain('space.overview.memberCount');
    expect(ios).not.toContain('space.details');
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
    expect(android).toContain('SpaceDeviceDetail');
  });

  it('uses Engine trust relationships in both device lists without exposing stale remove actions', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('deviceManagement.devices');
      expect(platform).toContain('deviceManagement.openDevice');
      expect(platform).toContain('space.deviceTrust.status.${device.primaryStatus}');
      expect(platform).not.toContain('workspaceConvergence');
    }
  });

  it('keeps switching guarded by verified device details while leaving only waits for an active operation on Android', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(android).toContain('highImpactActionsDisabled');
    expect(android).toContain('space.switch.unavailable');
    expect(android).toContain(
      'const leaveSpaceDisabled = pending !== null || deviceManagement.operationInProgress;'
    );
    expect(android).toContain(
      'leaveSpaceDisabled ? undefined : [clickable(() => setConfirmLeave(true))]'
    );
    expect(ios).toContain('highImpactActionsDisabled');
    expect(ios).toContain('!deviceManagement.highImpactActionsAvailable');
  });

  it('presents the Android space page as status, device actions, then separate space controls', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');

    expect(android).toContain('const overview = deviceManagement.overview');
    expect(android).toContain('overview.primaryStatus');
    expect(android).toContain('space.invitation.addAction');
    expect(android).toContain('localDevice');
    expect(android).toContain('SpaceDeviceDetail');
    expect(android).toContain('space.manage.title');
    expect(android).toContain('space.danger.title');
    expect(android).toContain('BackHandler');
  });

  it('keeps invitation availability copy aligned in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.invitation.sameLocalNetwork).toEqual(expect.any(String));
      expect(messages.space.invitation.crossNetwork).toEqual(expect.any(String));
      expect(messages.space.devices.title).toEqual(expect.any(String));
      expect(messages.space.devices.remove).toEqual(expect.any(String));
      expect(messages.space.devices.removeConfirmNamed).toEqual(expect.any(String));
      expect(messages.space.devices.removeEffect).toEqual(expect.any(String));
      expect(messages.space.devices.thisDevice).toEqual(expect.any(String));
      expect(messages.space.leave.action).toEqual(expect.any(String));
      expect(messages.space.leave.confirm).toEqual(expect.any(String));
      expect(messages.space.switch.title).toEqual(expect.any(String));
      expect(messages.space.switch.description).toEqual(expect.any(String));
      expect(messages.space.switch.unavailable).toEqual(expect.any(String));
      expect(messages.space.switch.confirmTitle).toEqual(expect.any(String));
      expect(messages.space.switch.confirm).toEqual(expect.any(String));
      expect(messages.space.switch.confirmAction).toEqual(expect.any(String));
      expect(messages.space.status.currentDevice).toEqual(expect.any(String));
      expect(messages.space.overview.syncHealthy).toEqual(expect.any(String));
      for (const status of [
        'decisionRequired',
        'unverifiable',
        'updateRequired',
        'updating',
        'refreshing',
        'healthy',
        'empty',
      ]) {
        expect(messages.space.overview.status[status]).toEqual(expect.any(String));
      }
      expect(messages.space.deviceTrust.status.updating).toEqual(expect.any(String));
      for (const fact of [
        'reachability',
        'groupRelationship',
        'syncRelationship',
        'compatibility',
      ]) {
        expect(messages.space.deviceDetail[fact].label).toEqual(expect.any(String));
      }
      expect(messages.space.overview.deviceSummary).toEqual(expect.any(String));
      expect(messages.space.empty.title).toEqual(expect.any(String));
      expect(messages.space.empty.body).toEqual(expect.any(String));
      expect(messages.space.devices.manageHint).toEqual(expect.any(String));
      expect(messages.space.overview.syncError).toEqual(expect.any(String));
      expect(messages.space.manage.title).toEqual(expect.any(String));
      expect(messages.space.devices.idLabel).toEqual(expect.any(String));
      expect(messages.space.overview.noDevicesOnline).toEqual(expect.any(String));
      expect(messages.space.overview.devicesAvailable).toEqual(expect.any(String));
      expect(messages.space.invitation.addAction).toEqual(expect.any(String));
      expect(messages.space.devices.otherTitle).toEqual(expect.any(String));
      expect(messages.space.advanced.title).toEqual(expect.any(String));
      expect(messages.space.danger.title).toEqual(expect.any(String));
      expect(messages.relay.summary).toEqual(expect.any(String));
    }
  });

  it('uses Space language and fully explains removal and leaving consequences', () => {
    const messages = JSON.parse(source('i18n/locales/zh/settingsSync.json'));

    expect(JSON.stringify(messages.space.deviceTrust)).not.toContain('设备组');
    expect(messages.space.operation.title.keepCurrentSpace).not.toContain('设备组');
    expect(messages.space.devices.removeConfirmNamed).toContain('离线');
    expect(messages.space.leave.confirm).toContain('其他设备');
    expect(messages.space.leave.confirm).toContain('本地历史');
    expect(messages.space.leave.confirm).toContain('新的邀请');
  });

  it('offers a retry from the Android status when device details cannot be verified', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');

    expect(android).toContain('syncFailed && !isRefreshing');
    expect(android.match(/t\('action\.retry'/g)).toHaveLength(2);
  });
});
