import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('Android settings theme', () => {
  it('uses the app accent as the Material palette seed on every settings screen', () => {
    const rootSource = readSource('screens/SettingsScreen.android.tsx');
    const subScreenSource = readSource('screens/settings/SettingsSubScreen.android.tsx');

    expect(rootSource).toContain('seedColor: theme.colors.accent');
    expect(rootSource).toContain('seedColor={theme.colors.accent}');
    expect(subScreenSource).toContain('seedColor={theme.colors.accent}');
  });
});
