import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('device direct sync confirmation', () => {
  it('does not persist p2p until the iOS confirmation action is pressed', () => {
    const page = read('screens/settings/ios/SyncChannelPage.tsx');
    const owner = read('screens/SettingsScreen.ios.tsx');
    const sheet = read('screens/settings/SyncChannelConfirmationSheet.ios.tsx');

    expect(page).toContain('onRequestP2pConfirmation');
    expect(page).not.toContain("handleSyncChannel('p2p')");
    expect(page).not.toContain('<BottomSheet');
    expect(owner).toContain('showSyncChannelConfirmation');
    expect(owner).toContain('<SyncChannelConfirmationSheet');
    expect(owner).toContain('onConfirm={confirmP2pSyncChannel}');
    expect(sheet).not.toContain('<SettingsIconTile');
    expect(sheet).not.toContain('flask.fill');
    expect(sheet).toContain('confirmationDescription');
    expect(sheet).not.toContain('IosSheetForm');
    expect(sheet).not.toContain('<Section');
    expect(sheet).toContain('confirmationWarning');
    expect(sheet).not.toContain('<IosSheetPage');
    expect(sheet).toContain('fitToContents');
    expect(sheet).not.toContain("presentationDetents(['medium'])");
    expect((sheet.match(/<Section/g) ?? []).length).toBe(0);
    expect(sheet).toContain('spacing={12}');
    expect(sheet).toContain('bottom: 12');
  });

  it('does not persist p2p until the Android confirmation action is pressed', () => {
    const section = read('screens/settings/SyncChannelSection.android.tsx');
    const sheet = read('screens/settings/SyncChannelConfirmationSheet.android.tsx');

    expect(section).toContain('showP2pConfirmation');
    expect(section).not.toContain("clickable(() => void handleSyncChannel('p2p'))");
    expect(section).toContain('<SyncChannelConfirmationSheet');
    expect(sheet).toContain('onConfirm');
    expect(sheet).toContain('onDismiss');
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])('provides %s confirmation copy', (locale) => {
    const messages = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src/i18n/locales', locale, 'settings.json'), 'utf8')
    ) as { syncChannel?: Record<string, string> };

    expect(messages.syncChannel).toEqual(
      expect.objectContaining({
        confirmationTitle: expect.any(String),
        confirmationDescription: expect.any(String),
        confirmationCrossNetwork: expect.any(String),
        confirmationExperimental: expect.any(String),
        confirmationWarning: expect.any(String),
        confirmationCancel: expect.any(String),
        confirmationConfirm: expect.any(String),
      })
    );
  });
});
