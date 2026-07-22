import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('explicit sync channel settings', () => {
  it('uses native segmented controls on Android and iOS', () => {
    const android = readFileSync(
      join(root, 'src/screens/settings/SyncSettingsSection.tsx'),
      'utf8'
    );
    const ios = readFileSync(join(root, 'src/screens/settings/ios/SettingsRootPage.tsx'), 'utf8');

    expect(android).toContain('SingleChoiceSegmentedButtonRow');
    expect(android).toContain('SegmentedButton');
    expect(android).toContain('setSyncChannel');
    expect(ios).toContain("pickerStyle('segmented')");
    expect(ios).toContain('setSyncChannel');
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])('provides %s channel labels', (locale) => {
    const messages = JSON.parse(
      readFileSync(join(root, 'src/i18n/locales', locale, 'settings.json'), 'utf8')
    ) as { syncChannel?: Record<string, string> };

    expect(messages.syncChannel).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        p2p: expect.any(String),
        lan: expect.any(String),
      })
    );
  });
});
