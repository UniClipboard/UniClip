import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), 'src', path), 'utf8');
}

describe('shared Space device detail UI', () => {
  it('keeps shared props and separate native platform implementations', () => {
    const entry = source('components/SpaceDeviceDetail.tsx');
    const types = source('components/SpaceDeviceDetail.types.ts');
    const android = source('components/SpaceDeviceDetail.android.tsx');
    const ios = source('components/SpaceDeviceDetail.ios.tsx');

    expect(entry).toContain("export * from './SpaceDeviceDetail.android'");
    expect(types).toContain('export interface SpaceDeviceDetailProps');
    expect(types).toContain('device: DeviceTrustDeviceView | null');
    expect(android).toContain('ModalBottomSheet');
    expect(android).toContain('AlertDialog');
    expect(ios).toContain('<BottomSheet');
    expect(ios).not.toContain('<Modal');
    expect(android).toContain('device.blockedReason');
    expect(ios).toContain('device.blockedReason');
    expect(android).toContain("space.deviceDetail.identity.${device.isLocal ? 'local' : 'remote'}");
    expect(ios).toContain("space.deviceDetail.identity.${device.isLocal ? 'local' : 'remote'}");
    expect(android).toContain('space.deviceDetail.blockedReason.${device.blockedReason}');
    expect(ios).toContain('space.deviceDetail.blockedReason.${device.blockedReason}');
    expect(`${entry}${types}${android}${ios}`).not.toContain('Platform.OS');
  });

  it('labels local and remote identity in every supported language', () => {
    for (const locale of ['zh', 'en', 'pt-BR', 'ru']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`)) as {
        space: { deviceDetail: { identity?: Record<string, string> } };
      };
      expect(messages.space.deviceDetail.identity?.label).toEqual(expect.any(String));
      expect(messages.space.deviceDetail.identity?.local).toEqual(expect.any(String));
      expect(messages.space.deviceDetail.identity?.remote).toEqual(expect.any(String));
    }
  });

  it('translates every Engine-owned blocked reason without exposing its internal name', () => {
    const reasons = [
      'noCurrentChange',
      'changeNoLongerCurrent',
      'localDeviceConfirmationRequired',
      'localDeviceRemoved',
      'recoveryNotAvailableInThisVersion',
      'peerUpgradeRequired',
      'deviceFactsUnverifiable',
      'engineUnavailable',
    ];

    for (const locale of ['zh', 'en', 'pt-BR', 'ru']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`)) as {
        space: { deviceDetail: { blockedReason?: Record<string, string> } };
      };
      for (const reason of reasons) {
        const message = messages.space.deviceDetail.blockedReason?.[reason];
        expect(message).toEqual(expect.any(String));
        expect(message).not.toBe(reason);
      }
    }
  });

  it('uses one controller from Home and both Settings implementations', () => {
    const hook = source('components/useSpaceDeviceManagement.ts');
    const home = source('components/useMySpaceSheet.ts');
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(hook).toContain('buildCurrentSpaceDeviceViews');
    expect(hook).toContain('buildSpaceOverviewView');
    expect(home).toContain('useSpaceDeviceManagement');
    expect(android).toContain('useSpaceDeviceManagement');
    expect(ios).toContain('useSpaceDeviceManagement');
    expect(ios).toContain('accessibilityLabel(device.displayName)');
    expect(ios).not.toContain('accessibilityLabel(`${device.displayName}, ${removeLabel}`)');
  });

  it('offers the existing update route only on Android for the local device', () => {
    const types = source('components/SpaceDeviceDetail.types.ts');
    const android = source('components/SpaceDeviceDetail.android.tsx');
    const ios = source('components/SpaceDeviceDetail.ios.tsx');
    const androidSettings = source('screens/settings/UnifiedSpaceSetup.android.tsx');

    expect(types).toContain('onUpdateThisDevice?: () => void');
    expect(android).toContain('device.canUpdateThisDevice');
    expect(android).toContain('space.deviceDetail.updateAction');
    expect(androidSettings).toContain("section: 'about'");
    expect(ios).not.toContain('space.deviceDetail.updateAction');
  });

  it('uses the full-width settings row for the iOS remove-device action', () => {
    const android = source('components/SpaceDeviceDetail.android.tsx');
    const ios = source('components/SpaceDeviceDetail.ios.tsx');
    const iosRemoveAction = ios.match(/\{props\.canRemove \? \([\s\S]*?\n\s+\) : null\}/)?.[0];

    expect(android).toContain('containerColor: colors.error');
    expect(iosRemoveAction).toContain('<SettingsNavRow');
    expect(iosRemoveAction).toContain('destructive');
    expect(iosRemoveAction).toContain('showsChevron={false}');
  });

  it('keeps the iOS detail sheet in the existing SwiftUI host to avoid parent-page flashes', () => {
    const homeSheet = source('components/MySpaceSheet.ios.tsx');
    const settings = source('screens/SettingsScreen.ios.tsx');
    const spacePage = source('screens/settings/ios/SpacePage.tsx');
    const host = homeSheet.match(/<Host[\s\S]*?<\/Host>/)?.[0];

    expect(host).toContain('<SpaceDeviceDetail');
    expect(settings).toContain('useSpaceDeviceManagement({ allowHighImpactActions: true })');
    expect(settings).toContain('<SpaceDeviceDetail');
    expect(spacePage).not.toContain('<SpaceDeviceDetail');
  });
});
