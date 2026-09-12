import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..', '..');
const scriptPath = resolve(projectRoot, 'scripts', 'install-dev-device.sh');

describe('install-dev-device.sh', () => {
  it('has valid Bash syntax', () => {
    const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('documents the current physical-device defaults without running an install', () => {
    const result = spawnSync('bash', [scriptPath, '--help'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('marks iPhone');
    expect(result.stdout).toContain('7bac761b');
    expect(result.stdout).toContain('does not replace the\nproduction app');
  });

  it('shows help through the single-platform shortcut', () => {
    const result = spawnSync('bash', [scriptPath, 'ios', '--help'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('requires the development app and keeps Metro separate', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('PRODUCT_BUNDLE_IDENTIFIER = app.uniclipboard.UniClipboard.dev;');
    expect(script).toContain("applicationId 'app.uniclipboard.android.dev'");
    expect(script).toContain('UC_ENGINE_LOCAL_CORE=1 APP_VARIANT=development npx expo run:ios');
    expect(script).toContain('APP_VARIANT=development npx expo run:ios');
    expect(script).toContain('UC_ENGINE_LOCAL_AAR="$engine_aar" ./gradlew :app:assembleDebug');
    expect(script).toContain('./gradlew :app:assembleDebug');
    expect(script).toContain('adb -s "$device" install -r "$apk_path"');
    expect(script).toContain('adb -s "$device" reverse tcp:8081 tcp:8081');
    expect(script).toContain('--no-bundler');
  });

  it('reuses a current local Engine and otherwise prepares the mobile pin', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('git -C "$ENGINE_ROOT" fetch origin "$INSTALL_ENGINE_COMMIT"');
    expect(script).toContain('core-source.json');
    expect(script).not.toContain('rev-parse origin/main');
    expect(script).toContain('prepare-local-unified-engine-core.sh');
    expect(script).toContain('build-android-aar.sh');
  });

  it('restores cached local iOS artifacts when the staged framework was replaced', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('restore_cached_local_ios_engine()');
    expect(script).toContain('verify-unified-engine-core.mjs" --local-prepared');
    expect(script).toContain('local cache_dir="$LOCAL_ENGINE_ROOT/ios-cache"');
    expect(script).toContain('--source-commit "$expected_commit"');
  });

  it('restores the pinned iOS Engine after a physical-device install exits', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('restore_pinned_ios_engine()');
    const exitTrap = script.match(/trap '([^\n]+)' EXIT/)?.[1];
    expect(exitTrap).toContain('restore_pinned_ios_engine');
    expect(exitTrap).toContain('status=$?');
    expect(exitTrap).toContain('exit "$status"');
    expect(script).toContain('UniClipboardEngine.xcframework.zip');
    expect(script).toContain('verify-unified-engine-core.mjs" --prepared');
  });

  it('prepares only the Engine artifacts required by the requested platform', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('prepare_install_engine() {\n  local platform="$1"');
    expect(script).toContain('restore_cached_local_ios_engine "$source_commit"');
    expect(script).toContain(
      'android_marker="$LOCAL_ENGINE_BUILD_ROOT/uc-engine-uniffi-dist/android/source-commit.txt"'
    );
    expect(script).toContain('prepare_install_engine ios');
    expect(script).toContain('prepare_install_engine android');
  });
});
