import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const settingsScreen = read('screens/SettingsScreen.ios.tsx');
const devicesScreen = read('screens/ios/DevicesScreen.tsx');
const devicesRoot = read('screens/ios/devices/DevicesRootPage.tsx');
const spaceSettings = read('screens/ios/devices/SpaceSettingsPage.tsx');

describe('iOS settings and devices tabs', () => {
  it('pushes settings sub-pages with a native navigation stack instead of a sheet', () => {
    expect(settingsScreen).toContain('<NavigationStack path={path} onPathChange={setPath}>');
    expect(settingsScreen).toContain('setPath((current) => [...current, page])');
    expect(settingsScreen).toContain('<NavigationDestination value="storage">');
    expect(settingsScreen).not.toContain('<BottomSheet');
    expect(settingsScreen).toContain("kind: 'navigation'");
  });

  it('keeps settings sheets as siblings of the navigation stack in one stable host', () => {
    const stackEnd = settingsScreen.indexOf('</NavigationStack>');
    expect(stackEnd).toBeGreaterThan(0);
    expect(settingsScreen.indexOf('<ShareSendSheet')).toBeGreaterThan(stackEnd);
    expect(settingsScreen.indexOf('<AddSyncConnectionSheet')).toBeGreaterThan(stackEnd);
  });

  it('moves sync channel and space management into the Devices tab', () => {
    expect(settingsScreen).not.toContain('SyncChannelPage');
    expect(settingsScreen).not.toContain('SpacePage');
    expect(devicesScreen).toContain('<NavigationStack path={path} onPathChange={setPath}>');
    expect(devicesScreen).toContain('<NavigationDestination value="spaceSettings">');
    expect(devicesScreen).toContain('onOpenSpaceSettings={() => setPath([\'spaceSettings\'])}');
  });

  it('owns every device sheet in the Devices host, outside the pushed pages', () => {
    const stackEnd = devicesScreen.indexOf('</NavigationStack>');
    for (const sheet of [
      '<SpaceDeviceDetail',
      '<AddSyncConnectionSheet',
      '<LanServerEditorSheet',
      '<SyncChannelConfirmationSheet',
    ]) {
      expect(devicesScreen.indexOf(sheet)).toBeGreaterThan(stackEnd);
    }
    expect(devicesScreen).toContain('persistentPresentation');
    for (const page of [devicesRoot, spaceSettings]) {
      expect(page).not.toMatch(/<(BottomSheet|Modal|Host|AddSyncConnectionSheet|SpaceDeviceDetail)\b/);
    }
    expect(spaceSettings).toContain('onSwitchSpace');
    expect(devicesScreen).toContain("onSwitchSpace={() => setSetupMode('switch')}");
  });

  it('keeps the sync method picker on the current value until direct sync is confirmed', () => {
    expect(devicesRoot).toContain("pickerStyle('segmented')");
    expect(devicesRoot).toContain('key={syncChannelPickerKey}');
    expect(devicesRoot).toMatch(/value === 'p2p'\) \{\s*onRequestP2pConfirmation\(\);\s*return;/);
    expect(devicesScreen).toContain('setSyncChannelPickerKey((key) => key + 1)');
  });
});
