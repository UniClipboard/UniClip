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

  it('reuses a current local Engine and otherwise prepares origin/main', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('git -C "$ENGINE_ROOT" fetch origin main');
    expect(script).toContain('git -C "$ENGINE_ROOT" rev-parse origin/main');
    expect(script).toContain('prepare-local-unified-engine-core.sh');
    expect(script).toContain('build-android-aar.sh');
  });
});
