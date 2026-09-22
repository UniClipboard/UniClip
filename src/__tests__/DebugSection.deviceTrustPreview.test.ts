import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src/screens/settings/android/DebugSection.tsx'),
  'utf8'
);

describe('Android device trust preview entry', () => {
  it('is guarded by development app identity and opens only fixed scenarios', () => {
    expect(source).toContain('isDeviceTrustPreviewAvailable()');
    expect(source).toContain('DEVICE_TRUST_PREVIEW_SCENARIOS.map');
    expect(source).toContain('openDeviceTrustPreview(scenario)');
  });

  it('makes the entry and every scenario row fully clickable', () => {
    expect(source).toMatch(
      /ListItem[\s\S]*?modifiers=\{\[clickable\(openDeviceTrustPreviewPicker\)\]\}/
    );
    expect(source).toMatch(
      /DEVICE_TRUST_PREVIEW_SCENARIOS\.map[\s\S]*?ListItem[\s\S]*?clickable\([\s\S]*?handleOpenDeviceTrustPreview\(scenario\.id\)[\s\S]*?\)/
    );
  });

  it('hands pairing sheet preview ownership to the stable settings screen', () => {
    const settingsScreen = readFileSync(
      join(process.cwd(), 'src/screens/settings/SettingsSubScreen.android.tsx'),
      'utf8'
    );

    expect(source).toContain('onOpenConnectionSheetPreview(scenario.id)');
    expect(source).not.toContain('<AddSyncConnectionSheet');
    expect(settingsScreen).toContain('<AddSyncConnectionSheet');
    expect(settingsScreen).toContain(
      'previewScenario={connectionSheetPreview ?? undefined}'
    );
  });
});
