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

    expect(android).toContain("invitation.availability === 'sameLocalNetwork'");
    expect(ios).toContain("invitation.availability === 'sameLocalNetwork'");
    expect(combined).toContain('space.invitation.sameLocalNetwork');
    expect(combined).not.toContain('UnifiedSpaceProbe');
  });

  it('shows space setup only for the explicitly selected P2P channel', () => {
    const androidSettings = source('screens/settings/SyncSettingsSection.tsx');
    const iosRoot = source('screens/settings/ios/SettingsRootPage.tsx');
    const iosScreen = source('screens/SettingsScreen.ios.tsx');
    const iosPages = source('screens/settings/ios/types.ts');

    expect(androidSettings).toContain("syncChannel === 'p2p' && <UnifiedSpaceSetup />");
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

  it('keeps invitation availability copy aligned in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.invitation.sameLocalNetwork).toEqual(expect.any(String));
      expect(messages.space.invitation.crossNetwork).toEqual(expect.any(String));
    }
  });
});
