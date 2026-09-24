import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const root = process.cwd();

describe('sync channel settings UI', () => {
  it('keeps one current-value entry on each settings root', () => {
    const androidRoot = fs.readFileSync(
      path.join(root, 'src/screens/SettingsScreen.android.tsx'),
      'utf8'
    );
    const iosRoot = fs.readFileSync(
      path.join(root, 'src/screens/settings/ios/SettingsRootPage.tsx'),
      'utf8'
    );

    const androidMain = fs.readFileSync(
      path.join(root, 'src/navigation/MainScreen.android.tsx'),
      'utf8'
    );

    // Android 的同步方式是顶级「设备」目的地,设置中枢不再重复入口
    expect(androidRoot).not.toContain('section="syncChannel"');
    expect(androidMain).toContain('section="syncChannel"');
    expect(androidRoot).not.toContain('SingleChoiceSegmentedButtonRow');
    // iOS 同样把同步方式放到顶级「设备」标签页
    expect(iosRoot).not.toContain("onNavigate('syncChannel')");
    expect(iosRoot).not.toContain("pickerStyle('segmented')");
  });

  it('owns selection and renders the selected connection settings inline', () => {
    const androidPage = fs.readFileSync(
      path.join(root, 'src/screens/settings/SyncChannelSection.android.tsx'),
      'utf8'
    );
    const androidOwner = fs.readFileSync(
      path.join(root, 'src/screens/settings/SettingsSubScreen.android.tsx'),
      'utf8'
    );
    const iosPage = fs.readFileSync(
      path.join(root, 'src/screens/ios/devices/DevicesRootPage.tsx'),
      'utf8'
    );
    const iosOwner = fs.readFileSync(path.join(root, 'src/screens/ios/DevicesScreen.tsx'), 'utf8');

    // Android 设备页顶部用紧凑的 M3 分段按钮,设备列表才是页面主体
    expect(androidPage).toContain('<SingleChoiceSegmentedButtonRow');
    expect(androidPage).not.toContain('RadioButton');
    expect(androidPage).toContain('<Badge');
    expect(androidPage).toContain("t('syncChannel.experimentalBadge')");
    expect(androidPage).toContain("testID('sync-channel-p2p')");
    expect(androidPage).toContain('setShowP2pConfirmation(true)');
    expect(androidPage).toContain('updateConfig({ syncChannel: channel })');
    expect(androidPage).toContain("syncChannel === 'lan'");
    expect(androidPage).toContain('<LanServersPage />');
    expect(androidPage).toContain('<UnifiedSpaceSetup');
    expect(androidPage).not.toContain("openSection('lanServers')");
    expect(androidPage).not.toContain("openSection('space')");
    expect(androidOwner).toContain("section === 'syncChannel'");
    expect(iosPage).toContain("pickerStyle('segmented')");
    expect(iosPage).toContain("t('syncChannel.experimentalBadge', { ns: 'settings' })");
    expect(iosPage).toContain("updateConfig({ syncChannel: 'lan' })");
    expect(iosPage).toContain("syncChannel === 'lan'");
    expect(iosPage).toContain('<LanServersContent');
    expect(iosPage).toContain('<DirectSpaceContent');
    expect(iosOwner).toContain("updateConfig({ syncChannel: 'p2p' })");
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])('provides %s channel labels', (locale) => {
    const messages = JSON.parse(
      fs.readFileSync(path.join(root, 'src/i18n/locales', locale, 'settings.json'), 'utf8')
    ) as { syncChannel?: Record<string, string> };

    expect(messages.syncChannel).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        lan: expect.any(String),
        p2p: expect.any(String),
        connectionSettings: expect.any(String),
        default: expect.any(String),
        experimental: expect.any(String),
      })
    );
  });
});
