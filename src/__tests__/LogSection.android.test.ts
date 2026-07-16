/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'screens', 'settings', 'LogSection.tsx'),
  'utf8'
);

describe('Android LogSection state contracts', () => {
  it('keeps the React label as the source of truth for the Compose field', () => {
    expect(source).toContain('const nativeLabel = useNativeState(label)');
    expect(source).toContain('<LogLevelField key={logLevelLabel} label={logLevelLabel} />');
    expect(source).not.toContain('logLevelNativeState.set');
  });

  it('does not gate log export on another settings screen storage calculation', () => {
    expect(source).not.toContain('useStorageSizesStore');
    expect(source).not.toContain('enabled={!isCalculating}');
  });

  it('asks for the export method before running either operation', () => {
    expect(source).toContain('showExportMethodDialog');
    expect(source).toContain('dialogs={');
    expect(source).toContain('const handleShareLogs');
    expect(source).toContain('archive = await createLogArchive(abortController.signal)');
    expect(source).toContain('shareFile(archive.uri, archive.fileName)');
    expect(source).toContain('scheduleExportedLogArchiveCleanup(archive.uri)');
    expect(source).toContain('const handleSaveLogsToFile');
    expect(source).toContain('await saveLogsToFile(abortController.signal)');
    expect(source).not.toContain('exportedArchive');
  });
});
