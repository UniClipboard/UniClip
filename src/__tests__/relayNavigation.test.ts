import { describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { pushSettingsSub } from '../navigation/settingsSubNavigation';
import { devicesRoutePath, type DevicesRoute } from '../screens/ios/devices/devicesRoutes';

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('settings navigation structure', () => {
  it('builds each iOS Devices page stack from its ancestors, so one back is one level', () => {
    expect(devicesRoutePath('spaceSettings')).toEqual(['spaceSettings']);
    expect(devicesRoutePath('relay')).toEqual(['spaceSettings', 'relay']);
    expect(devicesRoutePath('relayEditor')).toEqual(['spaceSettings', 'relay', 'relayEditor']);
    const routes: DevicesRoute[] = ['spaceSettings', 'relay', 'relayEditor'];
    for (const route of routes) {
      const stack = devicesRoutePath(route);
      expect(stack[stack.length - 1]).toBe(route);
      expect(new Set(stack).size).toBe(stack.length);
    }
  });

  it('always pushes Android settings sub pages instead of swapping the current one', () => {
    const push = jest.fn();
    pushSettingsSub({ push } as never, { section: 'relayEditor', relayUrl: 'https://a.example.com' });
    expect(push).toHaveBeenCalledWith('SettingsSub', {
      section: 'relayEditor',
      relayUrl: 'https://a.example.com',
    });
  });

  it('opens SettingsSub only through pushSettingsSub', () => {
    const offenders = listSources(path.join(__dirname, '..')).filter((file) => {
      if (file.endsWith('settingsSubNavigation.ts')) return false;
      return /\.(navigate|push)\(\s*'SettingsSub'/.test(fs.readFileSync(file, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
