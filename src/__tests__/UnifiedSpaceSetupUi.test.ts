import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('unified space setup UI', () => {
  it('keeps Android and iOS on native platform-specific form controls', () => {
    const entry = source('screens/settings/UnifiedSpaceSetup.tsx');
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(entry).toContain("export * from './UnifiedSpaceSetup.android'");
    expect(android).toContain('ModalBottomSheet');
    expect(android).toContain('visualTransformation="password"');
    expect(android).toContain('getUnifiedSpaceService');
    expect(ios).toContain('SecureField');
    expect(ios).toContain('getUnifiedSpaceService');
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

  it('shows space setup only for the explicitly selected P2P channel', () => {
    const androidSettings = source('screens/settings/SyncSettingsSection.tsx');
    const androidHub = source('screens/SettingsScreen.android.tsx');
    const androidSubScreen = source('screens/settings/SettingsSubScreen.android.tsx');
    const navigation = source('navigation/AppNavigator.tsx');
    const iosRoot = source('screens/settings/ios/SettingsRootPage.tsx');
    const iosScreen = source('screens/SettingsScreen.ios.tsx');
    const iosPages = source('screens/settings/ios/types.ts');

    expect(androidSettings).not.toContain('UnifiedSpaceSetup');
    expect(androidHub).toContain('section="space"');
    expect(androidSubScreen).toContain("section === 'space' && <UnifiedSpaceSetup />");
    expect(navigation).toContain("| 'space'");
    expect(navigation).toContain("space: t('space.title', { ns: 'settingsSync' })");
    expect(iosRoot).toContain("config.syncChannel === 'p2p'");
    expect(iosRoot).toContain("onNavigate('space')");
    expect(iosScreen).toContain("page === 'space'");
    expect(iosScreen).toContain('<SpacePage');
    expect(iosPages).toContain("| 'space'");
  });

  it('never writes the passphrase or invitation code to persistent settings', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');
    const combined = `${android}\n${ios}`;

    expect(combined).not.toContain('AsyncStorage');
    expect(combined).not.toContain('updateConfig({ passphrase');
    expect(combined).not.toContain('updateConfig({ invitationCode');
    expect(combined).toContain("setPassphrase('')");
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

  it('gives the iOS space page a compact overview and manageable device rows', () => {
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(ios).toContain('CopyableValue');
    expect(ios).toContain('Clipboard.setStringAsync');
    expect(ios).toContain('SettingsIconTile');
    expect(ios).toContain('SpaceDeviceRow');
    expect(ios).toContain('systemName="trash"');
    expect(ios).toContain('lineLimit(1)');
    expect(ios).toContain('space.status.currentDevice');
    expect(ios).toContain('disabled(!canSubmit || pending !== null)');
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
      expect(messages.space.leave.action).toEqual(expect.any(String));
      expect(messages.space.leave.confirm).toEqual(expect.any(String));
      expect(messages.space.status.currentDevice).toEqual(expect.any(String));
    }
  });
});
