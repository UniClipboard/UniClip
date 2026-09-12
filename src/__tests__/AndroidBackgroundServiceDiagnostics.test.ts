import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Android background service diagnostics', () => {
  it('records every service exit path in the exported native journal', () => {
    const service = read(
      'modules/foreground-service/android/src/main/java/expo/modules/foregroundservice/SyncForegroundService.kt'
    );
    const bridge = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/BackgroundServiceDiagnostics.kt'
    );
    const module = read(
      'modules/foreground-service/android/src/main/java/expo/modules/foregroundservice/ForegroundServiceModule.kt'
    );

    expect(read('modules/foreground-service/android/build.gradle')).toContain(
      "implementation project(':uc-engine')"
    );
    expect(service).toContain('BackgroundServiceDiagnostics.started(this)');
    expect(service).toContain('BackgroundServiceDiagnostics.systemRestarted(this)');
    expect(service).toContain('BackgroundServiceDiagnostics.stoppedPermanently(this)');
    expect(module).toContain('BackgroundServiceDiagnostics.stoppedPermanently(context)');
    expect(service).toContain('BackgroundServiceDiagnostics.stoppedTemporarily(this)');
    expect(service).toContain('BackgroundServiceDiagnostics.timedOut(this)');
    expect(service).toContain('BackgroundServiceDiagnostics.taskRemoved(this)');
    expect(service).toContain('BackgroundServiceDiagnostics.destroyed(this, expected = stoppedByUser)');
    expect(bridge).toContain('BindingHostDiagnosticSource.BACKGROUND_SERVICE');
    expect(bridge).toContain('AndroidNativeDiagnostics.get(context)');
  });
});
