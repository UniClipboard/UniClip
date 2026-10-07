/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const section = fs.readFileSync(path.join(root, 'screens/settings/android/PowerUsageSection.tsx'), 'utf8');
const logSection = fs.readFileSync(path.join(root, 'screens/settings/LogSection.android.tsx'), 'utf8');
const recorder = fs.readFileSync(path.join(root, '../modules/uc-engine/android/src/main/java/expo/modules/ucengine/PowerMetricsRecorder.kt'), 'utf8');
const glue = fs.readFileSync(path.join(root, '../modules/uc-engine/android/src/main/java/expo/modules/ucengine/AndroidNativeDiagnostics.kt'), 'utf8');

describe('Android power usage section', () => {
  it('reuses the shared settings rows and keeps the reset action a full-row press', () => {
    expect(section).toContain("import { SettingsListRow } from './SettingsListRow'");
    expect(section).toContain("import { SettingsSectionItem } from '../SettingsSectionItem'");
    expect(section).toMatch(/<SettingsListRow[^>]*key="reset"[\s\S]*?onPress=/);
    expect(section).not.toContain('<Button');
    expect(section).not.toContain('<TextButton');
  });

  it('is shown on the diagnostics page and has no platform conditionals', () => {
    expect(logSection).toContain('<PowerUsageSection />');
    expect(section).not.toContain('Platform.OS');
  });

  it('states that battery figures are whole-device and per-app energy is unavailable', () => {
    const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/locales/en/settingsAbout.json'), 'utf8')).power;
    expect(en.battery.title).toMatch(/whole-phone/i);
    expect(en.footer).toMatch(/does not tell apps how much battery/i);
    expect(en.unknownValue).toBe('unavailable');
  });
});

describe('Power recorder boundaries', () => {
  it('does not poll, hold wake locks, register a battery receiver, or report remotely', () => {
    for (const forbidden of ['Handler(', 'java.util.Timer', 'CountDownTimer', 'postDelayed', 'AlarmManager', 'WorkManager', 'WakeLock', 'ACTION_BATTERY_CHANGED, ', 'okhttp', 'HttpURLConnection', 'PostHog']) {
      expect(recorder).not.toContain(forbidden);
    }
    // The sticky battery intent may only be read (registerReceiver with a null receiver).
    expect(recorder).toContain('registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))');
    expect(recorder).not.toMatch(/addAction\(Intent\.ACTION_BATTERY_CHANGED\)/);
  });

  it('never reads wake-lock names or clipboard content', () => {
    expect(recorder).not.toContain('Clipboard');
    expect(recorder).not.toMatch(/getTimers\([^)]*\)\.keys/);
    expect(glue).not.toContain('PostHog');
  });
});
