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
      'createSpace',
      'issueInvitation',
      'joinSpace',
      'nextEvent',
      'sendText',
      'sendImage',
      'registerInputFile',
      'registerOutputFile',
      'sendFiles',
      'captureCurrentClipboard',
      'restoreClipboard',
      'exportEntry',
      'releaseFileHandle',
    ]) {
      expect(javascript).toContain(`export function ${operation}`);
    }
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
    expect(kotlin).toContain('recoverSession(true)');
    expect(kotlin).not.toContain('runCatching { currentEngine()?.suspend() }');
    expect(kotlin).not.toContain('runCatching { currentEngine()?.resume() }');
    expect(kotlin).toContain('FileHandleRegistry');
    expect(kotlin).not.toContain('putString(key');
  });

  it('installs the Android JNI context before starting the P2P engine', () => {
    const kotlin = read('android/src/main/java/expo/modules/ucengine/UcEngineModule.kt');

    const installContext = kotlin.indexOf('nativeInstallAndroidContext(context)');
    const startEngine = kotlin.indexOf('MobileEngine.start(');

    expect(installContext).toBeGreaterThan(-1);
    expect(startEngine).toBeGreaterThan(installContext);
  });

  it('pins both platform artifacts to the same core version and source commit', () => {
    const pin = read('core-source.json');

    expect(pin).toContain('"version": "core-v0.19.1"');
    expect(pin).toContain('"sourceCommit": "693bb50ffcb02d975e3356ccd42137a1b3e15624"');
    expect(pin).toContain('"iosSha256"');
    expect(pin).toContain('"androidSha256"');
  });
});
