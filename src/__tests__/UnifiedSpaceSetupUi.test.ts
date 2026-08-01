import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('unified space setup UI', () => {
  it('opens the shared native connection flow instead of duplicating setup forms', () => {
    const entry = source('screens/settings/UnifiedSpaceSetup.tsx');
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(entry).toContain("export * from './UnifiedSpaceSetup.android'");
    expect(android).toContain('AddSyncConnectionSheet');
    expect(android).toContain('getUnifiedSpaceService');
    expect(android).not.toContain('.createSpace(');
    expect(android).not.toContain('.joinSpace(');
    expect(ios).toContain('AddSyncConnectionSheet');
    expect(ios).toContain('getUnifiedSpaceService');
    expect(ios).not.toContain('.createSpace(');
    expect(ios).not.toContain('.joinSpace(');
  });

  it('shows when an invitation only works on the same local network', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const combined = `${android}\n${ios}`;

    expect(android).toContain("visibleInvitation.availability === 'sameLocalNetwork'");
    expect(ios).toContain("visibleInvitation.availability === 'sameLocalNetwork'");
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
    expect(iosScreen).toContain("page === 'space'");
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

  it('shows the local device as online without a remove action and refreshes live presence', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('device.isLocal');
      expect(platform).toContain('space.devices.thisDevice');
      expect(platform).toContain('useUnifiedEngineStore');
      expect(platform).toContain('refreshRevision');
      expect(platform).toContain('.refreshDevices()');
    }
  });

  it('gives the iOS space page a compact overview and manageable device rows', () => {
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(ios).toContain('CopyableValue');
    expect(ios).toContain('Clipboard.setStringAsync');
    expect(ios).toContain('SettingsIconTile');
    expect(ios).toContain('SpaceDeviceRow');
    expect(ios).toContain('systemName="trash"');
    expect(ios).toContain('lineLimit(1)');
    expect(ios).toContain('space.status.currentDevice');
    expect(ios).toContain('AddSyncConnectionSheet');
  });

  it('keeps the iOS connection sheet inside the existing settings host', () => {
    const iosPage = source('screens/settings/ios/SpacePage.tsx');
    const iosSheet = source('components/AddSyncConnectionSheet.ios.tsx');
    const sheetProps = source('components/AddSyncConnectionSheet.types.ts');

    expect(iosPage).toContain('embeddedInHost');
    expect(sheetProps).toContain('embeddedInHost?: boolean;');
    expect(iosSheet).toContain('embeddedInHost = false');
    expect(iosSheet).toContain('<ConnectionSheetHost embedded={embeddedInHost}>');
    expect(iosSheet).toContain('embedded ? <Group>');
  });

  it('gives the Android space page a compact overview and manageable device rows', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');

    expect(android).toContain("import * as Clipboard from 'expo-clipboard'");
    expect(android).toContain('SpaceDeviceRow');
    expect(android).toContain('space.status.currentDevice');
    expect(android).toContain('space.status.spaceId');
    expect(android).toContain('space.devices.online');
    expect(android).toContain('space.devices.offline');
    expect(android).toContain('space.devices.remove');
    expect(android).toContain('space.invitation.code');
    expect(android).toContain('connection.invitationExpires');
    expect(android).toContain('Clipboard.setStringAsync');
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
      expect(messages.space.status.currentDevice).toEqual(expect.any(String));
    }
  });
});
