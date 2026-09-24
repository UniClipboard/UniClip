import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(path, 'utf8');
it('offers capture control through each platform full-row component', () => {
  expect(read('src/screens/settings/ios/DiagnosticsPage.tsx')).toMatch(/<SettingsNavRow[\s\S]*testID="engine-diagnostic-capture"/);
  // Android:限时记录是一次性操作,卡片内整宽按钮承载同一 testID
  expect(read('src/screens/settings/LogSection.android.tsx')).toMatch(/modifiers=\{\[testID\('engine-diagnostic-capture'\)\]\}[\s\S]*?onClick=\{toggle\}/);
  for (const path of ['src/screens/settings/ios/DiagnosticsPage.tsx', 'src/screens/settings/LogSection.android.tsx']) {
    expect(read(path)).toContain('useEngineDiagnosticCapture');
  }
});
it('forwards native lifecycle and network boundaries after source registration', () => {
  const apple = read('modules/uc-engine/ios/AppleNativeDiagnostics.swift');
  const android = read('modules/uc-engine/android/src/main/java/expo/modules/ucengine/AndroidNativeDiagnostics.kt');
  expect(apple).toContain('EngineDiagnosticBridge.record');
  expect(android).toContain('EngineDiagnosticBridge.record');
  expect(read('modules/uc-engine/ios/SharedEngineHost.swift')).toContain('EngineDiagnosticBridge.register');
  expect(read('modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt')).toContain('EngineDiagnosticBridge.register');
});
it('initializes process logging without requiring a synchronization runtime', () => {
  const ios = read('modules/uc-engine/ios/UcEngineModule.swift');
  const android = read('modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');
  expect(ios).toContain('prepareDiagnosticLogging');
  expect(android).toContain('prepareDiagnosticLogging');
});
