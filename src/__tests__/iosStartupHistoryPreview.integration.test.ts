import fs from 'node:fs';
import path from 'node:path';

describe('iOS startup history preview integration', () => {
  const moduleRoot = path.join(process.cwd(), 'modules', 'app-group-store');

  it('registers the preview before React Native starts', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8')
    );

    expect(config.ios.appDelegateSubscribers).toContain('StartupHistoryPreviewSubscriber');
  });

  it('keeps startup preview source in the local Expo module', () => {
    const source = fs.readFileSync(
      path.join(moduleRoot, 'ios', 'StartupHistoryPreviewSubscriber.swift'),
      'utf8'
    );

    expect(source).toContain('customizeRootView');
    expect(source).toContain('prepareWindowForReact');
    expect(source).toContain('window.makeKeyAndVisible()');
    expect(source).toContain('StartupHistoryPreviewReader');
    expect(source).toContain('StartupHistoryPreviewCoordinator.install');
    expect(source).toContain('window.layer.displayIfNeeded()');
    expect(source.indexOf('StartupHistoryPreviewCoordinator.install')).toBeLessThan(
      source.indexOf('window.layer.displayIfNeeded()')
    );
  });
});
