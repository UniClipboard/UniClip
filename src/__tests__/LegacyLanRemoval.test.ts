import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { migrateConfig } from '../services/ConfigMigration';
import { createDefaultSettings, SETTINGS_SCHEMA_VERSION } from '../types/settings';

const projectRoot = process.cwd();

function projectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('legacy LAN removal', () => {
  it('upgrades a LAN profile into P2P-only settings without retaining credentials', () => {
    const legacy = {
      syncChannel: 'lan',
      servers: [
        {
          type: 'syncclipboard',
          name: 'Home',
          url: 'http://192.168.1.8:5033',
          username: 'alice',
          password: 'secret',
        },
      ],
      activeServerIndex: 0,
      legacyLanEligible: true,
      lanMigrationPromptedVersion: '1.4.0',
      appearance: 'dark',
      language: 'zh-CN',
      maxHistoryItems: 321,
    };

    const migrated = migrateConfig(legacy, 7) as unknown as Record<string, unknown>;

    expect(SETTINGS_SCHEMA_VERSION).toBeGreaterThan(7);
    expect(migrated).not.toHaveProperty('syncChannel');
    expect(migrated).not.toHaveProperty('servers');
    expect(migrated).not.toHaveProperty('activeServerIndex');
    expect(migrated).not.toHaveProperty('legacyLanEligible');
    expect(migrated).not.toHaveProperty('lanMigrationPromptedVersion');
    expect(migrated).toMatchObject({
      appearance: 'dark',
      language: 'zh-CN',
      maxHistoryItems: 321,
    });
    expect(legacy.servers[0].password).toBe('secret');
  });

  it('is idempotent and leaves P2P-owned settings unchanged', () => {
    const current = {
      ...createDefaultSettings('ios'),
      autoApplyRemote: false,
      autoPushLocal: false,
      keyboardSoundFeedback: false,
    };

    const once = migrateConfig(current, SETTINGS_SCHEMA_VERSION);
    const twice = migrateConfig(once, SETTINGS_SCHEMA_VERSION);

    expect(twice).toEqual(once);
    expect(twice).toMatchObject({
      autoApplyRemote: false,
      autoPushLocal: false,
      keyboardSoundFeedback: false,
    });
  });

  it('does not expose LAN fields on fresh installs', () => {
    const settings = createDefaultSettings('android') as unknown as Record<string, unknown>;

    expect(settings).not.toHaveProperty('syncChannel');
    expect(settings).not.toHaveProperty('servers');
    expect(settings).not.toHaveProperty('activeServerIndex');
    expect(settings).not.toHaveProperty('legacyLanEligible');
  });

  it('removes the old runtime and server configuration surfaces', () => {
    const removedPaths = [
      'src/services/SyncChannelCoordinator.ts',
      'src/services/SyncEngine.ts',
      'src/services/SyncManager.ts',
      'src/services/ClipboardSyncService.ts',
      'src/components/AddServerSheet.android.tsx',
      'src/components/AddServerSheet.ios.tsx',
      'src/components/ServerSwitcherModal.android.tsx',
      'src/components/ServerSwitcherModal.ios.tsx',
      'src/screens/settings/ServerSection.tsx',
      'src/screens/settings/ios/ServerListPage.tsx',
    ];

    for (const relativePath of removedPaths) {
      expect(fs.existsSync(path.join(projectRoot, relativePath))).toBe(false);
    }

    const startup = projectFile('src/services/BackgroundServiceManager.ts');
    expect(startup).not.toMatch(/SyncChannelCoordinator|ClipboardSyncService|SyncEngine/);
  });
});
