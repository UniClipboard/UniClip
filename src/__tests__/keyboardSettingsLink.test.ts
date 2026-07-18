/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

it('links to the containing app settings from the keyboard extension', () => {
  const appConfig = require('../../app.json') as {
    expo: {
      plugins?: Array<string | [string, unknown]>;
      scheme?: string | string[];
    };
  };
  const schemes = Array.isArray(appConfig.expo.scheme)
    ? appConfig.expo.scheme
    : [appConfig.expo.scheme];
  const keyboardRootView = fs.readFileSync(
    path.join(projectRoot, 'targets/keyboard/KeyboardRootView.swift'),
    'utf8'
  );
  const controller = fs.readFileSync(
    path.join(projectRoot, 'targets/keyboard/KeyboardViewController.swift'),
    'utf8'
  );
  const settingsURL = fs.readFileSync(
    path.join(projectRoot, 'targets/keyboard/KeyboardSettingsURL.swift'),
    'utf8'
  );

  expect(schemes).not.toContain('prefs');
  expect(appConfig.expo.plugins).toContain('./plugins/build/withIosSettingsBundle.js');
  expect(fs.existsSync(path.join(projectRoot, 'resources/ios/Settings.bundle/Root.plist'))).toBe(
    true
  );
  expect(keyboardRootView).toContain('KeyboardSettingsURL.destination');
  expect(keyboardRootView).toContain('Link(');
  expect(settingsURL).toContain('App-prefs:');
  expect(settingsURL).toContain('UIApplication.openSettingsURLString');
  expect(`${keyboardRootView}\n${settingsURL}`).not.toContain('prefs:root');
  expect(controller).not.toContain('extensionContext?.open');
  expect(controller).not.toContain('sel_registerName("openURL:")');
  expect(`${keyboardRootView}\n${controller}`).not.toContain('App-prefs:');
});
