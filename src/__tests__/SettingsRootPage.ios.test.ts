import fs from 'fs';
import path from 'path';

const settingsRootPage = fs.readFileSync(
  path.resolve(__dirname, '../screens/settings/ios/SettingsRootPage.tsx'),
  'utf8'
);

describe('iOS settings root page', () => {
  it('does not refresh keyboard status whenever a sub-page returns', () => {
    expect(settingsRootPage).not.toContain('active = true');
    expect(settingsRootPage).not.toContain('if (active) refreshKeyboard();');
  });
});
