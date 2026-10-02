import fs from 'fs';
import path from 'path';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

it('keeps relay tokens out of password-specific fields on both platforms', () => {
  const ios = source('screens/ios/devices/RelayEditorPage.tsx');
  const android = source('screens/settings/android/RelayEditorSection.tsx');
  const androidTokenField = android.slice(
    android.indexOf('testID="relay-token-input"'),
    android.indexOf('{error ?')
  );

  expect(ios).not.toContain('SecureField');
  expect(ios).toContain('testID="relay-token-input"');
  expect(androidTokenField).not.toMatch(/\bsecure\b/);
});

it('edits a relay on its own page above the relay list, clear of the keyboard', () => {
  const editor = source('screens/settings/android/RelayEditorSection.tsx');
  const list = source('screens/settings/android/RelaySettingsSection.tsx');

  expect(editor).not.toContain('ModalBottomSheet');
  expect(editor).toContain('modifiers={[fillMaxWidth(), imePadding()]}');
  // The list page never holds editor state: back from the editor must return to the list.
  expect(list).not.toContain('editingUrl');
  expect(list).not.toContain('relay-url-input');
});

it('labels the Android relay fields through the shared text field, like other forms', () => {
  const editor = source('screens/settings/android/RelayEditorSection.tsx');

  expect(editor).toContain('label={t(\'relay.url\')}');
  expect(editor).toContain('label={t(\'relay.token\')}');
  // No hand-drawn caption above a field.
  expect(editor).not.toMatch(/<ComposeText[^>]*>\{t\('relay\.(url|token)'\)\}<\/ComposeText>/);
});
