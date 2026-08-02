import fs from 'node:fs';
import path from 'node:path';

describe('iOS startup Home rendering', () => {
  const moduleRoot = path.join(process.cwd(), 'modules', 'app-group-store');

  it('does not register a second native implementation of Home', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8')
    );

    expect(config.ios.appDelegateSubscribers ?? []).not.toContain(
      'StartupHistoryPreviewSubscriber'
    );
  });

  it('keeps fake Home drawing code out of the local Expo module', () => {
    expect(
      fs.existsSync(path.join(moduleRoot, 'ios', 'StartupHistoryPreviewSubscriber.swift'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(moduleRoot, 'ios', 'Shared', 'StartupHistoryPreviewReader.swift'))
    ).toBe(false);
  });
});
