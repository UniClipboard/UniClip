import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

function read(relativePath: string): string {
  const path = join(root, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('iOS device trust preview entry', () => {
  it('shows a development-only developer page from the settings root', () => {
    const settingsRoot = read('screens/settings/ios/SettingsRootPage.tsx');
    const settingsTypes = read('screens/settings/ios/types.ts');
    const settingsScreen = read('screens/SettingsScreen.ios.tsx');

    expect(settingsRoot).toContain('isDeviceTrustPreviewAvailable()');
    expect(settingsRoot).toContain("onNavigate('developer')");
    expect(settingsTypes).toContain("| 'developer'");
    expect(settingsScreen).toContain('<NavigationDestination value="developer">');
    const developerPage = settingsScreen.match(/<DeveloperPage\b[\s\S]*?\/>/)?.[0];
    expect(developerPage).toContain('onBack={back}');
    expect(developerPage).toContain('onOpenPreview={openPreview}');
  });

  it('opens only fixed scenarios from a full-width native menu', () => {
    const developerPage = read('screens/settings/ios/DeveloperPage.tsx');
    const common = read('screens/settings/ios/common.tsx');
    const settingsScreen = read('screens/SettingsScreen.ios.tsx');
    const appNavigator = read('navigation/AppNavigator.tsx');

    expect(developerPage).toContain('DEVICE_TRUST_PREVIEW_SCENARIOS.map');
    expect(developerPage).toContain('onOpenPreview(scenarioId)');
    expect(developerPage).toContain('onPress={() => openScenario(scenario.id)}');
    expect(developerPage).not.toContain('deviceTrustPreviewCoordinator');
    expect(developerPage).not.toContain('BottomSheet');
    expect(developerPage).not.toContain('Modal');
    expect(developerPage).not.toContain('<Menu');

    // Scenario pickers reuse the shared menu row, whose label shares the nav
    // row's full-width body with a rectangular hit shape.
    const menuRows = developerPage.match(/<SettingsMenuRow\b/g) ?? [];
    expect(menuRows).toHaveLength(2);
    const menuRow = common.match(/export function SettingsMenuRow[\s\S]*?\n}\n/)?.[0];
    expect(menuRow).toContain('<Menu');
    expect(menuRow).toContain('label={<SettingsRowContent');
    const navRow = common.match(/export function SettingsNavRow[\s\S]*?\n}\n/)?.[0];
    expect(navRow).toContain('<SettingsRowContent');
    const rowContent = common.match(/function SettingsRowContent[\s\S]*?\n}\n/)?.[0];
    expect(rowContent).toContain('frame({ maxWidth: Infinity })');
    expect(rowContent).toContain('contentShape(shapes.rectangle())');

    expect(settingsScreen).toContain('canOpenDeviceTrustPreview()');
    // Settings is a tab page now: no sheet to dismiss before the preview sheet presents
    expect(settingsScreen).toContain('openDeviceTrustPreview(scenarioId)');
    expect(settingsScreen).toContain('onOpenPreview={openPreview}');
    expect(appNavigator).not.toContain('openPendingDeviceTrustPreview');
  });

  it('shows only the Previews group, not Android-only debug switches', () => {
    const developerPage = read('screens/settings/ios/DeveloperPage.tsx');

    expect(developerPage).toContain("t('debug.previewsTitle'");
    for (const key of ['welcomeTour', 'connectionScreens', 'connectionSheet', 'deviceRelationship']) {
      expect(developerPage).toContain(`t('debug.previewRows.${key}'`);
    }
    for (const androidOnly of ['debugMode', 'debugUrlScheme', 'debugUpdateCheckNoLimit', 'statisticsStore']) {
      expect(developerPage).not.toContain(androidOnly);
    }
  });
});
