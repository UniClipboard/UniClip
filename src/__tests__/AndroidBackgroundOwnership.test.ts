import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const foreground = (name: string) =>
  read(`modules/foreground-service/android/src/main/java/expo/modules/foregroundservice/${name}`);
const engine = read('modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

describe('Android background ownership', () => {
  it('keeps the Engine in a process-wide owner that the service retains', () => {
    expect(engine).toContain('object EngineOwner');
    const module = engine.slice(engine.indexOf('class UcEngineModule'));
    // The JS module must not hold the Engine itself, or destroying the runtime would shut it down.
    expect(module).not.toMatch(/private var engine: MobileEngine\?/);
    expect(module).toContain('EngineOwner.runtimeDetached(');

    const service = foreground('SyncForegroundService.kt');
    expect(service).toContain('EngineOwner.retain()');
    expect(service).toContain('EngineOwner.release(this)');
  });

  it('declares an honest foreground service type and holds the multicast lock only while running', () => {
    const plugin = read('plugins/withForegroundService.ts');
    expect(plugin).toContain("'android:foregroundServiceType': 'connectedDevice'");
    expect(plugin).toContain('FOREGROUND_SERVICE_CONNECTED_DEVICE');
    expect(plugin).toContain('CHANGE_WIFI_MULTICAST_STATE');
    expect(plugin).not.toContain('FOREGROUND_SERVICE_DATA_SYNC');

    const service = foreground('SyncForegroundService.kt');
    expect(service).toContain('FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE');
    expect(service).toContain('createMulticastLock');
    expect(service).toContain('releaseMulticastLock()');
  });

  it('recovers after boot only what the user enabled and did not stop', () => {
    const receiver = foreground('BootRecoveryReceiver.kt');
    expect(receiver).toContain('BackgroundIntent.enabled(context)');
    expect(receiver).toContain('ServiceStopRecord.USER_CHOSEN');
    expect(receiver).toContain('POST_NOTIFICATIONS');
    // Without JS the service cannot sync, so recovery is a prompt rather than a silent foreground start.
    expect(receiver).not.toContain('startForegroundService');

    const record = foreground('ServiceStopRecord.kt');
    expect(record).toMatch(/USER_CHOSEN = setOf\(USER_STOP, USER_PAUSE, TASK_REMOVED, POLICY\)/);

    const manifest = read('modules/foreground-service/android/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.intent.action.BOOT_COMPLETED');
    expect(manifest).toContain('android:exported="false"');
  });

  it('forwards native network changes to the Engine without a JS runtime', () => {
    const diagnostics = read(
      'modules/uc-engine/android/src/main/java/expo/modules/ucengine/AndroidNativeDiagnostics.kt'
    );
    expect(diagnostics).toContain('EngineOwner.hintNetworkChanged()');
    expect(engine).toContain('ConnectivityOpportunity.NETWORK_CHANGED');
  });

  it('rebinds the Shizuku user service through its listeners and a polling fallback', () => {
    const shizuku = read(
      'modules/shizuku-clipboard/android/src/main/java/expo/modules/shizukuclipboard/ShizukuClipboardModule.kt'
    );
    expect(shizuku).toContain('addBinderReceivedListenerSticky');
    expect(shizuku).toContain('addBinderDeadListener');
    expect(shizuku).toMatch(/if \(clipboardService == null\) bindUserService\(\)/);
    expect(shizuku).toContain('catch (_: DeadObjectException)');
  });

  it('keeps the recovery intent when the JS runtime, not the user, ends the service', () => {
    const module = foreground('ForegroundServiceModule.kt');
    expect(module).toMatch(/if \(runtimeStop != true\) BackgroundIntent\.set\(context, false\)/);
    expect(foreground('ServiceStopRecord.kt')).not.toMatch(/USER_CHOSEN = setOf\([^)]*RUNTIME_STOP/);

    const runtime = read('src/app/runtime/appRuntime.ts');
    expect(runtime).toContain('await this._stopBackgroundOnlyServices(true)');
  });
});
