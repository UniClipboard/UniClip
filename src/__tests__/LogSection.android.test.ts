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

  it('keeps the React label as the source of truth for the Compose field', () => {
    expect(source).toContain('const nativeLabel = useNativeState(label)');
    expect(source).toContain('<LogLevelField key={logLevelLabel} label={logLevelLabel} />');
    expect(source).not.toContain('logLevelNativeState.set');
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
