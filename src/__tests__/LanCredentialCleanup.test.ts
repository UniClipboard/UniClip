import fs from 'fs';
import path from 'path';

describe('iOS LAN credential retention', () => {
  it.each([
    'modules/app-group-store/ios/Shared/LanServerCredentialStore.swift',
    'targets/_shared/LanServerCredentialStore.swift',
  ])('does not delete all accessible copies after saving in %s', (file) => {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    const saveAndMigration = source.slice(
      source.indexOf('public static func loadAndMigratePassword'),
      source.indexOf('public static func deletePassword')
    );
    // A nil access group matches every accessible group, including the new copy.
    expect(saveAndMigration).not.toMatch(/delete\(serverId: serverId, accessGroup: nil\)/);
  });
});
