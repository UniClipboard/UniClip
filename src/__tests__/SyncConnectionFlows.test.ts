import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('unified sync connection flows', () => {
  it('provides platform-specific create and join flows', () => {
    const entry = source('components/AddSyncConnectionSheet.tsx');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(entry).toContain("export * from './AddSyncConnectionSheet.android'");
    expect(android).toContain('Host,');
    expect(android).toMatch(/<Host[^>]*>\s*<AddSyncConnectionSheetContent/);
    expect(android).toMatch(/<AddSyncConnectionSheetContent[^>]*\/>\s*<\/Host>/);
    expect(android).not.toContain('initialFullyExpanded');
    expect(android).not.toContain('skipPartiallyExpanded');
    for (const platform of [android, ios]) {
      expect(platform).toContain('useAddSyncConnectionFlow');
      expect(platform).toContain('completeConnection');
      expect(platform).not.toContain('legacyLan');
      expect(platform).not.toContain('onOpenLegacyLan');
    }
    expect(flow).toContain('.createSpace(');
    expect(flow).toContain('.joinSpace(');
    expect(flow).toContain('completeConnection');
  });

  it('applies the selected app theme to the Android add-connection sheet', () => {
    const android = source('components/AddSyncConnectionSheet.android.tsx');

    expect(android).toContain("import { useTheme } from '@/hooks/useTheme'");
    expect(android).toMatch(
      /<Host\s+colorScheme=\{theme\.isDark \? 'dark' : 'light'\}\s+seedColor=\{theme\.colors\.accent\}\s*>[\s\S]*<AddSyncConnectionSheetContent/
    );
    expect(android).toMatch(
      /function AddSyncConnectionSheetContent[\s\S]*const colors = useMaterialColors\(\)/
    );
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
    const flow = source('components/useAddSyncConnectionFlow.ts');

    for (const platform of [android, ios]) {
      expect(platform).toContain('copyInvitation');
      expect(platform).toContain('shareInvitation');
      expect(platform).toContain('invitationExpired');
      expect(platform).toContain("invitation.availability === 'sameLocalNetwork'");
      expect(platform).toContain('space.flow.waitingForDevice');
    }
    expect(flow).toContain('Clipboard.setStringAsync');
    expect(flow).toContain('Share.share');
    expect(flow).toContain('invitation.expiresAtMs');
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
    const flow = source('components/useAddSyncConnectionFlow.ts');
    const completion = flow.slice(
      flow.indexOf('const completeConnection'),
      flow.indexOf('const close')
    );

    expect(flow).toContain('mountedRef');
    expect(completion).toMatch(/if \(!mountedRef\.current\) return;[\s\S]*reset\(\)/);
  });

  it('clears iOS sensitive fields and restores the default device name on reset', () => {
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(ios).toContain('resetNativeFields: (nextDeviceName)');
    expect(ios).toContain('deviceNameState.value = nextDeviceName');
    expect(ios).toContain('passphraseRef.current?.clear()');
    expect(ios).toContain('invitationCodeRef.current?.clear()');
    expect(flow).toContain('setDeviceName(defaultDeviceName)');
    expect(flow).toContain("setPassphrase('')");
    expect(flow).toContain("setInvitationCode('')");
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

  it('routes the upgraded Home add action directly into Join Space', () => {
    const overlays = source('screens/HomeOverlays.tsx');

    expect(overlays).toContain('AddSyncConnectionSheet');
    expect(overlays).toContain('showAddConnection');
    expect(overlays).toContain('initialMode="join"');
    expect(overlays).toContain('handleP2pConnected');
    expect(overlays).not.toContain('legacyLan');
    expect(overlays).not.toContain('AddServer');
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
});
