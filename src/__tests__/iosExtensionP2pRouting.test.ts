/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('iOS extension P2P routing', () => {
  it('gives the keyboard and share extensions the P2P engine dependency', () => {
    for (const target of ['keyboard', 'share']) {
      const pods = readProjectFile(`targets/${target}/pods.rb`);
      expect(pods).toContain("pod 'UcEngine'");
    }
  });

  it('makes both extensions route through the selected sync channel', () => {
    const router = readProjectFile('targets/_shared/ExtensionSyncRouter.swift');
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const share = readProjectFile('targets/share/ShareUploader.swift');

    expect(router).toContain('enum ExtensionSyncChannel');
    expect(router).toContain('case p2p');
    expect(router).toContain('case lan');
    expect(router).toContain('settings.syncChannel');
    expect(keyboard).toContain('ExtensionSyncRouter');
    expect(share).toContain('ExtensionSyncRouter');
  });

  it('uses one protected P2P store for the app and both extensions', () => {
    const host = readProjectFile('modules/uc-engine/ios/UcEngineModule.swift');
    const nativeHost = readProjectFile('modules/uc-engine/ios/NativeSystemHost.swift');

    expect(host).toContain('sharedP2pDirectory');
    expect(host).toContain('sharedKeychainService');
    expect(nativeHost).toContain('accessGroup');
  });
});
