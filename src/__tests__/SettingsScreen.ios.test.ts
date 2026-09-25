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

  it('holds the sync method picker on direct while confirming and animates it back', () => {
    // 原生分段 Picker 在代码回写选中值时不带动画(点 sheet 外关闭确认后滑块会直接跳回),
    // 同步方式必须用自绘的 IosSegmentedControl,滑块随选中值做动画
    expect(devicesRoot).toContain('<IosSegmentedControl');
    expect(devicesRoot).not.toContain("pickerStyle('segmented')");
    const control = read('components/ui/IosSegmentedControl.ios.tsx');
    expect(control).toContain('offset({ x: selectedIndex * segmentWidth })');
    expect(control).toMatch(/animation\([^)]*\), selectedIndex\)/);
    // 与设计稿一致:分段控件与下方卡片同宽,不缩进在列表行内
    expect(devicesRoot).toContain('listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 })');
    expect(devicesRoot).toMatch(/value === 'p2p'\) \{\s*onRequestP2pConfirmation\(\);\s*return;/);
    // 确认期间让选中值停在「直连」,不靠重挂载把控件拉回
    expect(devicesRoot).not.toMatch(/key=\{syncChannelPickerKey\}/);
    expect(devicesRoot).toContain("const pickerSelection = p2pConfirmationPending ? 'p2p' : syncChannel;");
    expect(devicesRoot).toContain('selection={pickerSelection}');
    expect(devicesScreen).toContain('p2pConfirmationPending={showP2pConfirmation}');
  });
});
