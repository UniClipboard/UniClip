/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

describe('iOS diagnostics page', () => {
  it('shares the ZIP archive and never falls back to the summary-only JSON package', () => {
    const page = source('screens/settings/ios/DiagnosticsPage.tsx');

    expect(page).toContain('createDiagnosticArchive');
    expect(page).toContain('deleteDiagnosticArchive');
    expect(page).not.toContain('createDiagnosticPackage');
    expect(page).not.toContain('deleteDiagnosticPackage');
  });

  it('shows explicit messages when Engine logs are missing or unreadable', () => {
    const page = source('screens/settings/ios/DiagnosticsPage.tsx');

    expect(page).toContain("error.code === 'engine_logs_missing'");
    expect(page).toContain("error.code === 'engine_logs_unreadable'");
    expect(page).toContain("t('diagnostics.error.engineLogsMissing')");
    expect(page).toContain("t('diagnostics.error.engineLogsUnreadable')");
  });

  it('uses the iOS LogSection entry point for the diagnostics page', () => {
    const logSection = source('screens/settings/LogSection.ios.tsx');
    const settingsScreen = source('screens/SettingsScreen.ios.tsx');

    expect(logSection).toContain("import { DiagnosticsPage } from './ios/DiagnosticsPage'");
    expect(settingsScreen).toContain("import { LogSection } from './settings/LogSection'");
    expect(settingsScreen).toContain('<LogSection onBack={backToRoot} />');
  });

  it('describes the ZIP and both log sources in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsIos.json`));
      const diagnostics = messages.diagnostics;

      expect(diagnostics.package.format).toEqual(expect.any(String));
      expect(diagnostics.package.zipArchive).toEqual(expect.any(String));
      expect(diagnostics.package.appLogs).toEqual(expect.any(String));
      expect(diagnostics.package.engineLogs).toEqual(expect.any(String));
      expect(diagnostics.package.footer).toEqual(expect.any(String));
      expect(diagnostics.error.engineLogsMissing).toEqual(expect.any(String));
      expect(diagnostics.error.engineLogsUnreadable).toEqual(expect.any(String));
    }
  });
});
