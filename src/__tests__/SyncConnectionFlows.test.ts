import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('unified sync connection flows', () => {
  it('provides platform-specific create, join, and eligible legacy LAN branches', () => {
    const entry = source('components/AddSyncConnectionSheet.tsx');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(entry).toContain("export * from './AddSyncConnectionSheet.android'");
    expect(android).toContain('Host,');
    expect(android).toMatch(/<Host[^>]*>\s*<ModalBottomSheet/);
    expect(android).toMatch(/<\/ModalBottomSheet>\s*<\/Host>/);
    for (const platform of [android, ios]) {
      expect(platform).toContain('.createSpace(');
      expect(platform).toContain('.joinSpace(');
      expect(platform).toContain('legacyLanEligible');
      expect(platform).toContain('onOpenLegacyLan');
      expect(platform).toContain('completeConnection');
    }
  });

  it('gives the iOS add sheet a native hierarchy instead of a flat button list', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain('IosSheetPage');
    expect(ios).toContain('ConnectionChoiceCard');
    expect(ios).toContain("t('space.create.description')");
    expect(ios).toContain("t('space.join.description')");
    expect(ios).toContain("t('connection.addSheetTitle')");
    expect(ios).toContain('headerCircleButton');
    expect(ios).toContain("presentationDetents(['medium'])");
    expect(ios).toContain('disabled(!canSubmit || pending)');
  });

  it('does not reset native fields after connection completion unmounts the sheet', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      const completion = platform.slice(
        platform.indexOf('const completeConnection'),
        platform.indexOf('const openLegacyLan')
      );

      expect(platform).toContain('mountedRef');
      expect(completion).toMatch(/if \(!mountedRef\.current\) return;[\s\S]*reset\(\)/);
    }
  });

  it('clears iOS form values before switching between create and join', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const clearInputs = ios.slice(ios.indexOf('const clearInputs'), ios.indexOf('const reset'));
    const backToChoose = ios.slice(
      ios.indexOf('const backToChoose'),
      ios.indexOf('const completeConnection')
    );

    expect(clearInputs).toContain("setDeviceName('')");
    expect(clearInputs).toContain("setPassphrase('')");
    expect(clearInputs).toContain("setInvitationCode('')");
    expect(backToChoose).toContain('clearInputs()');
  });

  it('shows one P2P target plus deprecated LAN targets and selects them atomically', () => {
    const types = source('components/ServerSwitcherModal.types.ts');
    const android = source('components/ServerSwitcherModal.android.tsx');
    const ios = source('components/ServerSwitcherModal.ios.tsx');
    const controller = source('screens/useHomeController.ts');

    expect(types).toContain('SyncConnectionTarget');
    expect(types).toContain('selectedChannel');
    expect(types).toContain('legacyLanEligible');
    expect(types).toContain('p2pSpaceId');
    for (const platform of [android, ios]) {
      expect(platform).toContain("kind: 'p2p'");
      expect(platform).toContain("kind: 'lan'");
      expect(platform).toContain('connection.lanDeprecated');
      expect(platform).toContain('legacyLanEligible');
      expect(platform).toContain('onAdd');
    }
    expect(controller).toContain('selectSyncConnection(target)');
  });

  it('presents the Android connection switcher from the bottom edge', () => {
    const android = source('components/ServerSwitcherModal.android.tsx');

    expect(android).toContain("import { AppBottomSheet } from '@/components/ui'");
    expect(android).toContain('<AppBottomSheet');
    expect(android).not.toContain('AppTopSheet');
  });

  it('routes the home add action through the unified sheet while retaining the LAN editor', () => {
    const overlays = source('screens/HomeOverlays.tsx');

    expect(overlays).toContain('AddSyncConnectionSheet');
    expect(overlays).toContain('showAddConnection');
    expect(overlays).toContain('onOpenLegacyLan');
    expect(overlays).toContain('legacyLanEligible');
    expect(overlays).toContain('handleP2pConnected');
    expect(overlays).toContain('<AddServerSheet');
  });

  it('guards scanned legacy LAN handoff before opening the retained editor', () => {
    const controller = source('screens/useHomeController.ts');
    const androidModals = source('screens/settings/ServerModals.tsx');
    const iosSettings = source('screens/SettingsScreen.ios.tsx');

    expect(controller).toContain('config?.legacyLanEligible');
    expect(controller).toContain('if (!legacyLanEligible)');
    expect(controller).toContain('setShowAddServer(true)');
    expect(androidModals).toContain('legacyLanEligible');
    expect(androidModals).toContain('if (!legacyLanEligible)');
    expect(iosSettings).toContain('config?.legacyLanEligible');
    expect(iosSettings).toContain('if (!legacyLanEligible)');
  });

  it('hides legacy LAN settings from new installs and selects eligible targets atomically', () => {
    const androidScreen = source('screens/settings/SettingsSubScreen.android.tsx');
    const androidServers = source('screens/settings/ServerSection.tsx');
    const iosRoot = source('screens/settings/ios/SettingsRootPage.tsx');
    const iosServers = source('screens/settings/ios/ServerListPage.tsx');

    expect(androidScreen).toContain('legacyLanEligible && <ServerSection />');
    expect(androidScreen).toContain('legacyLanEligible && <ServerModals />');
    expect(androidServers).toContain("selectSyncConnection({ kind: 'lan', serverIndex: index })");
    expect(iosRoot).toContain('config.legacyLanEligible ?');
    expect(iosRoot).toContain("selectSyncConnection({ kind: 'p2p' })");
    expect(iosRoot).toContain("kind: 'lan'");
    expect(iosServers).toContain('connection.lanDeprecated');
  });
});
