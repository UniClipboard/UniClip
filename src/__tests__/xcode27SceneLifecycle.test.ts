import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

import { patchAppDelegateForXcode27 } from '../../plugins/withXcode27SceneLifecycle';

const legacyAppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;

describe('Xcode 27 scene lifecycle', () => {
  it('moves iOS window creation into a scene delegate while preserving tvOS startup', () => {
    const patched = patchAppDelegateForXcode27(legacyAppDelegate);

    expect(patched).toContain('#if os(tvOS)');
    expect(patched).toContain('@objc(SceneDelegate)');
    expect(patched).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(patched).toContain('UIWindow(windowScene: windowScene)');
    expect(patched).toContain('appDelegate.window = window');
    expect(patched).toContain('connectionOptions.urlContexts');
    expect(patched).not.toContain('#if os(iOS) || os(tvOS)');
  });

  it('is stable when Expo generates the project again', () => {
    const once = patchAppDelegateForXcode27(legacyAppDelegate);

    expect(patchAppDelegateForXcode27(once)).toBe(once);
  });

  it('rejects an unknown AppDelegate template instead of silently omitting the fix', () => {
    expect(() => patchAppDelegateForXcode27('unexpected source')).toThrow(
      'Unsupported Expo AppDelegate.swift'
    );
  });

  it('publishes the scene manifest for both app variants', () => {
    for (const variant of ['development', 'production']) {
      const result = spawnSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_VARIANT: variant,
          EXPO_NO_TELEMETRY: '1',
        },
      });

      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      const manifest = config.ios.infoPlist.UIApplicationSceneManifest;

      expect(manifest.UIApplicationSupportsMultipleScenes).toBe(false);
      expect(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication).toEqual([
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ]);
    }
  });

  it('runs the scene patch before extension targets are generated', () => {
    const appJson = JSON.parse(readFileSync('app.json', 'utf8'));
    const plugins = appJson.expo.plugins;

    expect(plugins).toContain('./plugins/build/withXcode27SceneLifecycle.js');
    expect(plugins.indexOf('./plugins/build/withXcode27SceneLifecycle.js')).toBeLessThan(
      plugins.indexOf('@bacons/apple-targets')
    );
  });
});
