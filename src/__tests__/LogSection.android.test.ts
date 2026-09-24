/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const settingsDirectory = path.join(__dirname, '..', 'screens', 'settings');
const source = fs.readFileSync(path.join(settingsDirectory, 'LogSection.android.tsx'), 'utf8');

describe('Android LogSection state contracts', () => {
  it('declares paired platform implementations', () => {
    expect(fs.existsSync(path.join(settingsDirectory, 'LogSection.android.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(settingsDirectory, 'LogSection.ios.tsx'))).toBe(true);
  });

  it('selects the log level from a full-row selector driven by React state', () => {
    expect(source).toContain('<SettingsSelectRow');
    expect(source).toContain("selectedValue={logLevel ?? 'error'}");
    expect(source).not.toContain('OutlinedTextField');
    expect(source).not.toContain('useNativeState');
  });

  it('does not gate log export on another settings screen storage calculation', () => {
    expect(source).not.toContain('useStorageSizesStore');
    expect(source).not.toContain('enabled={!isCalculating}');
  });

  it('creates the same diagnostic archive as iOS before sharing or saving', () => {
    expect(source).toContain('showExportMethodDialog');
    expect(source).toContain('dialogs={');
    expect(source).toContain('const handleShareLogs');
    expect(source).toContain('return createDiagnosticArchive(');
    expect(source).toContain('archive = await createArchive(abortController.signal)');
    expect(source).toContain('shareFile(archive.uri, archive.fileName)');
    expect(source).toContain('saveFile(archive.uri, archive.fileName)');
    expect(source).toContain('deleteDiagnosticArchive(archive.uri)');
    expect(source).toContain('const handleSaveLogsToFile');
    expect(source).not.toContain('createLogArchive');
    expect(source).not.toContain('saveLogsToFile');
  });
});
