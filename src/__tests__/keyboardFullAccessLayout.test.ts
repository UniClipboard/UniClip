/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

it('hides the editing key row until Full Access is enabled', () => {
  const rootView = fs.readFileSync(
    path.join(projectRoot, 'targets/keyboard/KeyboardRootView.swift'),
    'utf8'
  );
  const controller = fs.readFileSync(
    path.join(projectRoot, 'targets/keyboard/KeyboardViewController.swift'),
    'utf8'
  );

  expect(rootView).toContain('keyRowBand.isHidden = !layout.hasFullAccess');
  expect(rootView).toContain('static var restrictedContentHeight');
  expect(controller).toMatch(
    /hasFullAccess\s*\? KeyboardLayout\.contentHeight\s*: KeyboardLayout\.restrictedContentHeight/
  );
});
