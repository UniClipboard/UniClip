import { ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins';

/**
 * Rewrites the Android `versionName` to a 4-segment string
 * `${expo.version}.${expo.android.versionCode}` (e.g. `1.3.0.156`).
 *
 * ## Why
 *
 * The in-app self-updater (`src/services/UpdateService.ts`) is the ONLY update
 * channel on Android: it fetches the latest GitHub release, parses its tag
 * (`vX.Y.Z.B`) and compares it against the *installed* app's version string,
 * which it reads from `Application.nativeApplicationVersion` — i.e. the Android
 * `versionName`.
 *
 * We deliberately FREEZE the marketing version (`expo.version`) across many
 * releases so the iOS `CFBundleShortVersionString` does not change and Apple
 * does not re-trigger App Store / TestFlight review on every build (only the
 * iOS `CFBundleVersion` / `expo.ios.buildNumber` bumps). But if the Android
 * `versionName` also stayed frozen at `1.3.0`, a user already on the newest
 * build would still compare `1.3.0` (no build segment) against a newer tag
 * `v1.3.0.156` and see a permanent, false "update available".
 *
 * Folding the build counter into the Android `versionName` as a 4th segment
 * keeps the self-updater's comparison correct while leaving the iOS marketing
 * version untouched. `parseVersion`/`compareVersions` in `UpdateService.ts`
 * already understand the 4-segment `MAJOR.MINOR.PATCH.BUILD` format, so no app
 * code changes are needed.
 *
 * The 4th segment mirrors `expo.android.versionCode` (a single monotonic build
 * counter bumped every release, see `scripts/bump-build.mjs`), so the tag,
 * `versionCode`, and `versionName` all agree on the same build number.
 *
 * iOS is unaffected: it has no in-app APK updater (sideloading is Android-only),
 * so its `CFBundleShortVersionString` stays the plain 3-segment `expo.version`.
 */
const withAndroidBuildVersionName: ConfigPlugin = (config) => {
  const version = config.version ?? '0.0.0';
  const versionCode = config.android?.versionCode ?? 1;
  const versionName = `${version}.${versionCode}`;

  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    // Expo's version mod emits `versionName "1.3.0"` in defaultConfig; match
    // either quote style and replace only that value.
    const versionNameRe = /versionName\s+["'][^"']*["']/;

    if (!versionNameRe.test(contents)) {
      console.warn(
        '⚠ withAndroidBuildVersionName: no `versionName` line found in build.gradle; left unchanged'
      );
      return config;
    }

    config.modResults.contents = contents.replace(versionNameRe, `versionName "${versionName}"`);
    console.log(
      `✓ Android versionName → "${versionName}" (iOS marketing version stays ${version})`
    );
    return config;
  });
};

export default withAndroidBuildVersionName;
