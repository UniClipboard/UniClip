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
    expect(android).not.toContain('initialFullyExpanded');
    expect(android).not.toContain('skipPartiallyExpanded');
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
    expect(ios).toContain('ConnectionChoice');
    expect(ios).toContain("t('space.create.description')");
    expect(ios).toContain("t('space.join.description')");
    expect(ios).toContain("t('connection.addSheetTitle')");
    expect(ios).toContain('HeaderCircleButton');
    expect(ios).toContain("presentationDetents(['medium', 'large']");
    expect(ios).toContain('disabled(!canSubmitDetails || pending)');
    expect(ios).toContain('iosDimensions.surfaceCornerRadius');
  });

  it('expands the created-space and success steps while keeping setup half-height', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain("useState<PresentationDetent>('medium')");
    expect(ios).toContain("mode === 'invitation' || mode === 'success'");
    expect(ios).toContain("setSheetDetent(fullHeight ? 'large' : 'medium')");
    expect(ios).toContain('selection: sheetDetent');
    expect(ios).toContain('onSelectionChange: setSheetDetent');
  });

  it('turns create and join into a staged connection experience on both platforms', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("'joinCode'");
      expect(platform).toContain("'joinDetails'");
      expect(platform).toContain("'invitation'");
      expect(platform).toContain("'success'");
      expect(platform).toContain('space.flow.waitingTitle');
      expect(platform).toContain('space.flow.successTitle');
      expect(platform).toContain('normalizeInvitationCodeInput');
      expect(platform).toContain('formatInvitationCode');
    }

    expect(android).toContain('space.flow.joinCodeTitle');
    expect(android).not.toContain('space.flow.joinCodeSheetTitle');
    expect(ios).toContain('space.flow.joinCodeSheetTitle');
  });

  it('accepts eight invitation characters without rewriting the active input', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('maxLength={8}');
      expect(platform).not.toContain('invitationCodeRef.current?.setText');
    }
  });

  it('supports copy, share, expiry, and network scope while the creator waits', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('Clipboard.setStringAsync');
      expect(platform).toContain('Share.share');
      expect(platform).toContain('invitation.expiresAtMs');
      expect(platform).toContain("invitation.availability === 'sameLocalNetwork'");
      expect(platform).toContain('space.flow.waitingForDevice');
    }
  });

  it('uses the unified add sheet instead of duplicate setup forms in settings', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('AddSyncConnectionSheet');
      expect(platform).not.toContain('.createSpace(');
      expect(platform).not.toContain('.joinSpace(');
    }
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

  it('clears iOS sensitive fields and restores the default device name on reset', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const clearInputs = ios.slice(ios.indexOf('const clearInputs'), ios.indexOf('const reset'));

    expect(clearInputs).toContain('setDeviceName(nextDeviceName)');
    expect(clearInputs).toContain("setPassphrase('')");
    expect(clearInputs).toContain("setInvitationCode('')");
    expect(clearInputs).toContain('passphraseRef.current?.clear()');
    expect(clearInputs).toContain('invitationCodeRef.current?.clear()');
  });

  it('shows the default device name in both iOS setup fields', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(ios).toContain('useNativeState(defaultDeviceName)');
    expect(ios.match(/text=\{deviceNameState\}/g)).toHaveLength(2);
    expect(ios).toContain('deviceNameState.value = nextDeviceName');
  });

  it('uses the system device name as the setup default on both platforms', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("import * as Device from 'expo-device'");
      expect(platform).toContain('resolveDefaultDeviceName(');
      expect(platform).toContain('Device.deviceName');
      expect(platform).toContain('Device.modelName');
    }
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

  it('ships the staged connection copy in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));

      expect(messages.space.flow.joinCodeSheetTitle).toEqual(expect.any(String));
      expect(messages.space.flow.joinCodeTitle).toEqual(expect.any(String));
      expect(messages.space.flow.waitingTitle).toEqual(expect.any(String));
      expect(messages.space.flow.waitingForDevice).toEqual(expect.any(String));
      expect(messages.space.flow.successTitle).toEqual(expect.any(String));
      expect(messages.space.error.invitationCodeInvalid).toEqual(expect.any(String));
      expect(messages.space.error.invitationNotFound).toEqual(expect.any(String));
      expect(messages.space.error.invitationExpired).toEqual(expect.any(String));
      expect(messages.space.error.passphraseMismatch).toEqual(expect.any(String));
    }
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
