import fs from 'fs';
import path from 'path';

const settingsScreen = fs.readFileSync(
  path.resolve(__dirname, '../screens/SettingsScreen.ios.tsx'),
  'utf8'
);

describe('iOS settings page navigation', () => {
  it('keeps the scrollable root page stationary while a sub-page is open', () => {
    expect(settingsScreen).not.toContain('function SubPageSlide');
    expect(settingsScreen).not.toContain('offset({ x: atRoot ? 0 : -width * 0.3 })');
    expect(settingsScreen).not.toContain('<SubPageSlide');
  });
});
