import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const moduleRoot = join(process.cwd(), 'modules', 'uc-engine');

function read(relativePath: string): string {
  const path = join(moduleRoot, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('unified P2P engine native module', () => {
  it('keeps the P2P engine separate from the LAN compatibility module', () => {
    const config = read('expo-module.config.json');
    const javascript = read('src/index.ts');

    expect(config).toContain('"name": "uc-engine"');
    expect(config).toContain('"UcEngineModule"');
    expect(javascript).toContain('requireNativeModule');
    expect(javascript).toContain("('UcEngine')");
    expect(javascript).not.toContain("requireNativeModule('UcCore')");
  });

  it('exposes lifecycle, space, content, event, clipboard, and file operations', () => {
    const javascript = read('src/index.ts');

    for (const operation of [
      'coreVersion',
      'start',
      'shutdown',
      'suspend',
      'resume',
      'setBackgroundSyncEnabled',
      'createSpace',
      'issueInvitation',
      'joinSpace',
      'nextEvent',
      'refreshPeerConnections',
      'sendText',
      'sendImage',
      'registerInputFile',
      'registerOutputFile',
      'sendFiles',
      'captureCurrentClipboard',
      'observeClipboardChange',
      'observeClipboardTextChange',
      'restoreClipboard',
      'exportEntry',
      'releaseFileHandle',
    ]) {
      expect(javascript).toMatch(new RegExp(`export (?:async )?function ${operation}\\b`));
    }
  });

  it('exposes custom relay saving on JavaScript, iOS, and Android', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('saveCustomRelayNode');
    expect(swift).toContain('AsyncFunction("saveCustomRelayNode")');
    expect(kotlin).toContain('AsyncFunction("saveCustomRelayNode")');
  });

  it('does not expose the removed workspace convergence query or event', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).not.toContain('queryWorkspaceConvergence');
    expect(javascript).not.toContain("type: 'workspaceConvergenceChanged'");
    expect(swift).not.toContain('AsyncFunction("queryWorkspaceConvergence")');
    expect(swift).not.toContain('case .workspaceConvergenceChanged');
    expect(kotlin).not.toContain('AsyncFunction("queryWorkspaceConvergence")');
    expect(kotlin).not.toContain('BindingEvent.WorkspaceConvergenceChanged');
  });

  it('exposes device trust query and decision on JavaScript, iOS, and Android', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    for (const operation of ['queryDeviceTrust', 'decideDeviceTrustChange']) {
      expect(javascript).toMatch(new RegExp(`export (?:async )?function ${operation}\\b`));
      expect(swift).toContain(`AsyncFunction("${operation}")`);
      expect(kotlin).toContain(`AsyncFunction("${operation}")`);
    }

    expect(javascript).toContain('choice: DeviceTrustChoice');
    expect(javascript).toContain('confirmLocalRemoval: boolean');
    expect(swift).toContain('choice: String, confirmLocalRemoval: Bool');
    expect(kotlin).toContain('choice: String, confirmLocalRemoval: Boolean');
  });

  it('returns structured device trust query failures on both native platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('export type DeviceTrustQueryResult');
    expect(javascript).toContain('queryDeviceTrust(): Promise<DeviceTrustQueryResult>');
    expect(swift).toContain('case let .Engine(code, category, retryable)');
    expect(swift).toContain('"failure": Self.engineFailureMap(');
    expect(kotlin).toContain('is BindingException.Engine -> mapOf(');
    expect(kotlin).toContain('"failure" to engineFailureMap(error)');
  });

  it('maps device trust changes to a revision-only event on both native platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain("type: 'deviceTrustChanged'; revision: number");
    expect(swift).toContain('case .deviceTrustChanged(let revision):');
    expect(swift).toContain('["type": "deviceTrustChanged", "revision": revision]');
    expect(kotlin).toContain('is BindingEvent.DeviceTrustChanged -> mapOf(');
    expect(kotlin).toContain('"type" to "deviceTrustChanged"');
    expect(kotlin).toContain('"revision" to event.revision.toLong()');
  });

  it('maps detailed clipboard, delivery, transfer, and presence events on both platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    for (const eventType of [
      'incomingEntry',
      'incomingPending',
      'receiveAttemptStateChanged',
      'deliveryStatusChanged',
      'peerPresenceChanged',
      'transferProgress',
      'transferStatusChanged',
      'activeClipboardChanged',
      'networkRecoveryChanged',
    ]) {
      expect(javascript).toContain(`type: '${eventType}'`);
      expect(swift).toContain(`"type": "${eventType}"`);
      expect(kotlin).toContain(`"type" to "${eventType}"`);
    }
  });

  it('exposes complete space management on JavaScript, iOS, and Android', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    for (const operation of [
      'querySpaceState',
      'listDevices',
      'removeMember',
      'resendEntry',
      'leaveSpace',
    ]) {
      expect(javascript).toMatch(new RegExp(`export (?:async )?function ${operation}\\b`));
      expect(swift).toContain(`AsyncFunction("${operation}")`);
      expect(kotlin).toContain(`AsyncFunction("${operation}")`);
    }
  });

  it('passes unreadable-history confirmation and result counts on both platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('preserveUnreadableHistory: boolean');
    expect(javascript).toContain('preservedUnreadableRecords: number');
    expect(swift).toContain('preserveUnreadableHistory: Bool');
    expect(swift).toContain('"preservedUnreadableRecords"');
    expect(kotlin).toContain('preserveUnreadableHistory: Boolean');
    expect(kotlin).toContain('"preservedUnreadableRecords"');
  });

  it('converts workspace convergence results for both native platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('export interface WorkspaceConvergence');
    expect(javascript).toContain('pendingRemovalDecisionDeviceIds: string[]');
    expect(javascript).toContain('divergedPeerDeviceIds: string[]');
    expect(javascript).toContain('upgradeRequiredPeerDeviceIds: string[]');
    expect(javascript).toContain('failureCategory: WorkspaceConvergenceFailureCategory | null');
    expect(javascript).toContain('updatedAtMs: number');
    expect(javascript).toContain('removeMember(deviceId: string): Promise<WorkspaceConvergence>');
    expect(kotlin).toContain('val result = engine.removeMember(deviceId)');
    expect(kotlin).toContain('"historyEventCount" to convergence.historyEventCount.toLong()');
    expect(kotlin).toContain('refreshAnalyticsContext(engine)');
    expect(swift).toContain('let result = try engine.removeMember(deviceId: deviceId)');
    expect(swift).toContain('"historyEventCount": convergence.historyEventCount');
    expect(swift).toContain('self.host.refreshAnalyticsContext(engine: engine)');
  });

  it('maps the synchronization-disabled resend result on both native platforms', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain("kind: 'synchronizationDisabled'");
    expect(swift).toContain('case .synchronizationDisabled:');
    expect(kotlin).toContain('ResendEntryOutcome.SynchronizationDisabled');
  });

  it('preserves the local-device marker on JavaScript, iOS, and Android', () => {
    const javascript = read('src/index.ts');
    const swift = read('ios/UcEngineModule.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('isLocal: boolean');
    expect(swift).toContain('let localDeviceId = try engine.queryLocalDevice().deviceId');
    expect(swift).toContain('"isLocal": $0.deviceId == localDeviceId');
    expect(kotlin).toContain('val localDeviceId = engine.queryLocalDevice().deviceId');
    expect(kotlin).toContain('"isLocal" to (it.deviceId == localDeviceId)');
  });

  it('uses Keychain and native app lifecycle on iOS without a file fallback', () => {
    const swift = `${read('ios/UcEngineModule.swift')}\n${read('ios/NativeSystemHost.swift')}`;

    expect(swift).toContain('kSecClassGenericPassword');
    expect(swift).toContain('SecItemCopyMatching');
    expect(swift).toContain('SecItemUpdate');
    expect(swift).toContain('OnAppEntersBackground');
    expect(swift).toContain('OnAppEntersForeground');
    expect(swift).toContain('NativeLifecycleHost');
    expect(swift).toContain('recoverSession(allowSecureStorageUnlock: true)');
    expect(swift).not.toContain('try? self.currentEngine()?.suspend()');
    expect(swift).not.toContain('try? self.currentEngine()?.resume()');
    expect(swift).toContain('FileHandleRegistry');
    expect(swift).not.toContain('UserDefaults');
  });

  it('uses Android Keystore and native activity lifecycle without plaintext key storage', () => {
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(kotlin).toContain('KeyStore.getInstance("AndroidKeyStore")');
    expect(kotlin).toContain('KeyGenParameterSpec.Builder');
    expect(kotlin).toContain('OnActivityEntersBackground');
    expect(kotlin).toContain('OnActivityEntersForeground');
    expect(kotlin).toContain('NativeLifecycleHost');
    expect(kotlin).toContain('AsyncFunction("setBackgroundSyncEnabled")');
    expect(kotlin).toContain('recoverSession(true)');
    expect(kotlin).not.toContain('runCatching { currentEngine()?.suspend() }');
    expect(kotlin).not.toContain('runCatching { currentEngine()?.resume() }');
    expect(kotlin).toContain('FileHandleRegistry');
    expect(kotlin).not.toContain('putString(key');
  });

  it('keeps Android event polling off the serialized native operation queue', () => {
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');
    const nextEventStart = kotlin.indexOf('AsyncFunction("nextEvent")');
    const nextOperationStart = kotlin.indexOf(
      'AsyncFunction("refreshPeerConnections")',
      nextEventStart
    );
    const nextEventDefinition = kotlin.slice(nextEventStart, nextOperationStart);

    expect(nextEventStart).toBeGreaterThan(-1);
    expect(nextOperationStart).toBeGreaterThan(nextEventStart);
    expect(nextEventDefinition).toContain('.runOnQueue(appContext.backgroundCoroutineScope)');
  });

  it('keeps blocking iOS engine work off the shared Expo async-function queue', () => {
    const swift = read('ios/UcEngineModule.swift');
    const nextEventStart = swift.indexOf('AsyncFunction("nextEvent")');
    const nextOperationStart = swift.indexOf(
      'AsyncFunction("refreshPeerConnections")',
      nextEventStart
    );
    const nextEventDefinition = swift.slice(nextEventStart, nextOperationStart);

    expect(swift).toContain(
      'private let engineOperationQueue = DispatchQueue(label: "app.uniclipboard.uc-engine")'
    );
    expect(swift).toContain(
      'private let engineEventQueue = DispatchQueue(label: "app.uniclipboard.uc-engine-events")'
    );
    expect(swift).toMatch(/AsyncFunction\("start"\)[\s\S]*?\.runOnQueue\(engineOperationQueue\)/);
    expect(nextEventDefinition).toContain('.runOnQueue(engineEventQueue)');
    expect(swift.slice(nextOperationStart)).toMatch(
      /AsyncFunction\("refreshPeerConnections"\)[\s\S]*?\.runOnQueue\(engineOperationQueue\)/
    );
  });

  it('installs the Android JNI context before starting the P2P engine', () => {
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    const installContext = kotlin.indexOf('nativeInstallAndroidContext(context)');
    const startEngine = kotlin.indexOf('MobileEngine.startWithAnalytics(');

    expect(installContext).toBeGreaterThan(-1);
    expect(startEngine).toBeGreaterThan(installContext);
  });

  it('supplies platform analytics context when each native engine starts', () => {
    const swift = read('ios/SharedEngineHost.swift');
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(swift).toContain('context: analyticsContext()');
    expect(swift).toContain('os: .ios');
    expect(kotlin).toContain('analyticsContext()');
    expect(kotlin).toContain('BindingAnalyticsOs.ANDROID');
  });

  it('preserves declared file names when native hosts write received files to the clipboard', () => {
    const swift = `${read('ios/UcEngineModule.swift')}\n${read('ios/SharedEngineHost.swift')}`;
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(swift).toContain('clipboardShares.create(displayName: displayName)');
    expect(swift).not.toContain(
      'UIPasteboard.general.url = try withHostBindingError { try self.files.url(handle) }'
    );
    expect(kotlin).toContain('createClipboardShareFile(context, representation.displayName)');
  });

  it('restores every core plain-text representation as Android text', () => {
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(kotlin).toContain('isPlainTextRepresentation');
    expect(kotlin).toContain('"public.utf8-plain-text"');
    expect(kotlin).toContain('format.substringBefore');
    expect(kotlin).toContain('normalizedFormat.equals("text", ignoreCase = true)');
  });

  it('preserves selected file names when registering opaque input handles', () => {
    const javascript = read('src/index.ts');
    const swift = `${read('ios/UcEngineModule.swift')}\n${read(
      'ios/SharedEngineHost.swift'
    )}\n${read('ios/NativeSystemHost.swift')}`;
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    expect(javascript).toContain('registerInputFile(uri: string, displayName?: string)');
    expect(swift).toContain('register(uri: uri, writable: false, displayName: displayName)');
    expect(swift).toContain('displayName: target.displayName ?? target.url.lastPathComponent');
    expect(kotlin).toContain('requireFiles().register(uri, false, displayName)');
    expect(kotlin).toContain('target.displayName ?:');
  });

  it('pins both platform artifacts to the same published engine release', () => {
    const pin = JSON.parse(read('core-source.json')) as {
      repository: string;
      version: string;
      sourceCommit: string;
      releaseManifestSha256: string;
      swiftPackageChecksum: string;
      artifacts: Record<string, string>;
    };

    expect(pin.repository).toBe('UniClipboard/Engine');
    expect(pin.version).toMatch(/^v\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/);
    expect(pin.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(pin.releaseManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pin.swiftPackageChecksum).toBe(pin.artifacts['UniClipboardEngine.xcframework.zip']);
    for (const artifact of [
      'UniClipboardEngine.aar',
      'UniClipboardEngine.aar.checksum.txt',
      'UniClipboardEngine.pom',
      'UniClipboardEngine.xcframework.checksum.txt',
      'UniClipboardEngine.xcframework.zip',
      'runtime-dependencies.txt',
      'source-commit.txt',
      'uc_engine_uniffi.kt',
      'uc_engine_uniffi.swift',
      'version.txt',
    ]) {
      expect(pin.artifacts[artifact]).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
