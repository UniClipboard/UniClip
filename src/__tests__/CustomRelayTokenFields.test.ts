import fs from 'fs';
import path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

it('keeps relay tokens out of password-specific fields on both platforms', () => {
  const ios = source('screens/ios/devices/RelaySettingsPage.tsx');
  const android = source('screens/settings/android/RelaySettingsSection.tsx');
  const androidTokenField = android.slice(
    android.indexOf('testID="relay-token-input"'),
    android.indexOf('{error ?')
  );

  expect(ios).not.toContain('SecureField');
  expect(ios).toContain('testID="relay-token-input"');
  expect(androidTokenField).not.toMatch(/\bsecure\b/);
});

it('edits an Android relay inside the relay page, above the keyboard', () => {
  const android = source('screens/settings/android/RelaySettingsSection.tsx');

  expect(android).not.toContain('ModalBottomSheet');
  expect(android).toContain('modifiers={[fillMaxWidth(), imePadding()]}');
});
