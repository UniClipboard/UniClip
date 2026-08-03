/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('native Engine analytics hosts', () => {
  it('starts the Engine with analytics in the iOS app, iOS extensions, and Android app', () => {
    const swiftHost = read('modules/uc-engine/ios/SharedEngineHost.swift');
    const kotlinModule = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt'
    );

    expect(swiftHost.match(/MobileEngine\.startWithAnalytics/g)).toHaveLength(2);
    expect(kotlinModule).toContain('MobileEngine.startWithAnalytics(');
    expect(swiftHost).toContain('ApplePostHogAnalyticsHost');
    expect(kotlinModule).toContain('AndroidPostHogAnalyticsHost');
  });

  it('keeps consent and all analytics identities in native persistent storage', () => {
    const swift = read('modules/uc-engine/ios/NativeAnalyticsHost.swift');
    const kotlin = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/NativeAnalyticsHost.kt'
    );

    expect(swift).toContain('UserDefaults(suiteName:');
    expect(swift).toContain('anonymous_user_id');
    expect(swift).toContain('analytics_device_id');
    expect(swift).toContain('space_person_id');
    expect(swift).toContain('usage_analytics_enabled');
    expect(kotlin).toContain('getSharedPreferences(');
    expect(kotlin).toContain('anonymous_user_id');
    expect(kotlin).toContain('analytics_device_id');
    expect(kotlin).toContain('space_person_id');
    expect(kotlin).toContain('usage_analytics_enabled');
  });

  it('gates delivery, drops queued events when disabled, and rotates identities on reset', () => {
    const swift = read('modules/uc-engine/ios/NativeAnalyticsHost.swift');
    const kotlin = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/NativeAnalyticsHost.kt'
    );
    const javascript = read('modules/uc-engine/src/index.ts');

    for (const source of [swift, kotlin]) {
      expect(source).toContain('clearPendingEvents');
      expect(source).toContain('resetTelemetryIdentity');
      expect(source).toContain('UUID');
    }
    expect(javascript).toContain('getAnalyticsConsent');
    expect(javascript).toContain('setAnalyticsConsent');
    expect(javascript).toContain('resetAnalyticsIdentity');
  });

  it('adds common mobile context and PostHog person, session, device, and space fields', () => {
    const swift = read('modules/uc-engine/ios/NativeAnalyticsHost.swift');
    const kotlin = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/NativeAnalyticsHost.kt'
    );
    const normalizedKotlin = kotlin.replace(/\$\{'\$'\}/g, '$');

    for (const source of [swift, normalizedKotlin]) {
      for (const property of [
        'anonymous_user_id',
        'analytics_device_id',
        'session_id',
        'app_version',
        'app_channel',
        'os_version',
        'locale',
        'timezone',
        'active_device_count',
        'space_id_hash',
        '$device_id',
        '$session_id',
        '$groups',
        '$geoip_disable',
      ]) {
        expect(source).toContain(property);
      }
    }
  });

  it('rejects clipboard content, device names, file names, paths, credentials, and tokens', () => {
    const swift = read('modules/uc-engine/ios/NativeAnalyticsHost.swift');
    const kotlin = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/NativeAnalyticsHost.kt'
    );

    for (const source of [swift, kotlin]) {
      for (const forbidden of [
        'clipboard',
        'device_name',
        'display_name',
        'file_name',
        'filename',
        'path',
        'password',
        'secret',
        'token',
      ]) {
        expect(source).toContain(`"${forbidden}"`);
      }
      expect(source).toContain('containsSensitiveData');
    }
  });

  it('injects the PostHog project key only into native build configuration', () => {
    const appConfig = read('app.config.ts');
    const plugin = read('plugins/withPostHogAnalytics.ts');
    const appJson = read('app.json');
    const workflows = [
      read('.github/workflows/android-build.yml'),
      read('.github/workflows/build-ios.yml'),
      read('.github/workflows/ios-build-check.yml'),
    ].join('\n');

    expect(appConfig).not.toContain('posthogProjectKey:');
    expect(plugin).toContain('POSTHOG_PROJECT_KEY');
    expect(plugin).toContain('UCPostHogProjectKey');
    expect(plugin).toContain('app.uniclipboard.analytics.POSTHOG_PROJECT_KEY');
    expect(appJson).toContain('./plugins/build/withPostHogAnalytics.js');
    expect(workflows).toContain('POSTHOG_PROJECT_KEY: ${{ secrets.UC_POSTHOG_PROJECT_KEY }}');
    expect(workflows).not.toContain('secrets.POSTHOG_PROJECT_KEY');
  });

  it('exposes platform-native consent and identity reset controls', () => {
    const entry = read('src/screens/settings/AnalyticsConsentControl.tsx');
    const android = read('src/screens/settings/AnalyticsConsentControl.android.tsx');
    const ios = read('src/screens/settings/AnalyticsConsentControl.ios.tsx');

    expect(entry).toContain("export * from './AnalyticsConsentControl.android'");
    expect(android).toContain("from '@expo/ui/jetpack-compose'");
    expect(android).toContain('setAnalyticsConsent');
    expect(android).toContain('resetAnalyticsIdentity');
    expect(ios).toContain("from '@expo/ui/swift-ui'");
    expect(ios).toContain('setAnalyticsConsent');
    expect(ios).toContain('resetAnalyticsIdentity');
  });
});
