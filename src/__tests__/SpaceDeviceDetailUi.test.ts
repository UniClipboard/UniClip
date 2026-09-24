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

  it('uses one controller from both Settings implementations', () => {
    const hook = source('components/useSpaceDeviceManagement.ts');
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/ios/DevicesScreen.tsx');
    const iosRow = source('screens/ios/devices/deviceRows.tsx');

    expect(hook).toContain('buildCurrentSpaceDeviceViews');
    expect(hook).toContain('buildSpaceOverviewView');
    expect(android).toContain('useSpaceDeviceManagement');
    expect(ios).toContain('useSpaceDeviceManagement');
    expect(iosRow).toContain('accessibilityLabel(`${device.displayName}, ${status.label}`)');
  });

  it('uses a real full-row button so scrolling does not open device details', () => {
    const ios = source('screens/ios/devices/deviceRows.tsx');
    const row = ios.slice(ios.indexOf('export function SpaceDeviceRow'));

    expect(row).toContain('<SwiftUIButton');
    expect(row).toContain('contentShape(shapes.rectangle())');
    expect(row).not.toContain('onTapGesture');
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

  it('keeps the iOS detail sheet in the stable Devices host to avoid parent-page flashes', () => {
    const settings = source('screens/ios/DevicesScreen.tsx');
    const spacePage = source('screens/ios/devices/DevicesRootPage.tsx');

    expect(settings).toContain('useSpaceDeviceManagement({ allowHighImpactActions: true })');
    expect(settings).toContain('<SpaceDeviceDetail');
    expect(spacePage).not.toContain('<SpaceDeviceDetail');
  });
});
