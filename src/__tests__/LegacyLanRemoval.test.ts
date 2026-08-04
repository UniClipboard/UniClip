import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { createDefaultSettings } from '../types/settings';

const projectRoot = process.cwd();

function projectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('legacy LAN removal', () => {
  it('does not expose LAN fields on fresh installs', () => {
    const settings = createDefaultSettings('android') as unknown as Record<string, unknown>;

    expect(settings).not.toHaveProperty('syncChannel');
    expect(settings).not.toHaveProperty('servers');
    expect(settings).not.toHaveProperty('activeServerIndex');
    expect(settings).not.toHaveProperty('legacyLanEligible');
  });

  it('removes the old runtime and server configuration surfaces', () => {
    expect(fs.existsSync(path.join(projectRoot, 'src', 'services'))).toBe(false);

    const startup = projectFile('src/app/runtime/appRuntime.ts');
    expect(startup).not.toMatch(/SyncChannelCoordinator|ClipboardSyncService|SyncEngine/);
  });
});
