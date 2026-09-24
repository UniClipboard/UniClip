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
    expect(iosRoot).toContain("onNavigate('syncChannel')");
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
      path.join(root, 'src/screens/settings/ios/SyncChannelPage.tsx'),
      'utf8'
    );
    const iosOwner = fs.readFileSync(path.join(root, 'src/screens/SettingsScreen.ios.tsx'), 'utf8');

    expect(androidPage).toContain('RadioButton');
    expect(androidPage).toContain('<Badge');
    expect(androidPage).toContain("t('syncChannel.experimental')");
    expect(androidPage).toContain('ListItem modifiers={[clickable(');
    expect(androidPage).toContain('updateConfig({ syncChannel: channel })');
    expect(androidPage).toContain("syncChannel === 'lan'");
    expect(androidPage).toContain('<LanServersPage />');
    expect(androidPage).toContain('<UnifiedSpaceSetup');
    expect(androidPage).not.toContain("openSection('lanServers')");
    expect(androidPage).not.toContain("openSection('space')");
    expect(androidOwner).toContain("section === 'syncChannel'");
    expect(iosPage).toContain('<SettingsNavRow');
    expect(iosPage).toContain('spacing={0}');
    expect(iosPage).toContain("badge={t('syncChannel.experimental')}");
    expect(iosPage).toContain('selected={syncChannel ===');
    expect(iosPage).toContain('updateConfig({ syncChannel: channel })');
    expect(iosPage).toContain("syncChannel === 'lan'");
    expect(iosPage).toContain('<LanServersPage');
    expect(iosPage).toContain('<SpacePage');
    expect(iosPage).not.toContain("onNavigate('lanServers')");
    expect(iosPage).not.toContain("onNavigate('space')");
    expect(iosOwner).toContain("activePage === 'syncChannel'");
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
