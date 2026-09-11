import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

it('captures keyboard visibility even before an Engine session exists', () => {
  const controller = readFileSync(resolve(root, 'targets/keyboard/KeyboardViewController.swift'), 'utf8');
  expect(controller).toContain('AppleNativeDiagnostics.start()');
  expect(controller).toContain('record(.extensionVisible');
  expect(controller).toContain('record(.extensionHidden');
  expect(controller).toContain('AppleNativeDiagnostics.journal.flush');
});

it('shares the journal implementation without adding Engine to the Share process', () => {
  expect(realpathSync(resolve(root, 'targets/share/NativeRuntimeDiagnostics.swift')))
    .toBe(resolve(root, 'modules/uc-engine/ios/NativeRuntimeDiagnostics.swift'));
  const controller = readFileSync(resolve(root, 'targets/share/ShareViewController.swift'), 'utf8');
  expect(controller).not.toContain('import UcEngineCore');
  expect(controller).toContain('nativeDiagnostics.flush(deadlineMs: 250)');
  expect(controller.indexOf('nativeDiagnostics.flush')).toBeLessThan(controller.indexOf('context.completeRequest'));
});
