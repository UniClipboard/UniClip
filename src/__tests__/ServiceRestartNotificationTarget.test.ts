import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Android service restart notification target', () => {
  const service = read(
    'modules/foreground-service/android/src/main/java/expo/modules/foregroundservice/SyncForegroundService.kt'
  );

  it('does not target a hard-coded legacy package', () => {
    expect(service).not.toContain('com.jericx.syncclipboardmobile');
    expect(service).not.toMatch(/setClassName\(packageName,\s*"/);
  });

  it('resolves the activity the app actually registers', () => {
    const suffix = service.match(/RESTART_ACTIVITY_SUFFIX = "([^"]+)"/)?.[1];
    expect(suffix).toBe('.servicerestart.ServiceRestartActivity');
    expect(service).toContain('it.name.endsWith(RESTART_ACTIVITY_SUFFIX)');
    expect(service).toContain('getLaunchIntentForPackage(packageName)');

    const plugin = read('plugins/withServiceRestartActivity.ts');
    expect(plugin).toContain(`const activityName = '${suffix}';`);

    const activity = read(
      'src/android/app/src/main/java/app/uniclipboard/android/expo-native/ServiceRestartActivity.kt'
    );
    expect(activity).toMatch(/^package [\w.]+\.servicerestart$/m);
    expect(activity).toContain('class ServiceRestartActivity');
  });
});
