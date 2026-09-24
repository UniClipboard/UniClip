import fs from 'fs';
import path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

it('keeps relay tokens out of password-specific fields on both platforms', () => {
  const ios = source('screens/settings/CustomRelaySection.ios.tsx');
  const android = source('screens/settings/CustomRelaySection.android.tsx');
  const androidTokenField = android.slice(
    android.indexOf('testID="relay-token-input"'),
    android.indexOf('{error ?')
  );

  expect(ios).not.toContain('SecureField');
  expect(ios).toContain('testID="relay-token-input"');
  expect(androidTokenField).not.toMatch(/\bsecure\b/);
});

it('opens the Android relay editor full screen above the keyboard', () => {
  const android = source('screens/settings/CustomRelaySection.android.tsx');

  expect(android).toContain('<ModalBottomSheet skipPartiallyExpanded');
  expect(android).toContain(
    '...(editingUrl !== null ? [fillMaxSize(), imePadding()] : [fillMaxWidth()])'
  );
});
