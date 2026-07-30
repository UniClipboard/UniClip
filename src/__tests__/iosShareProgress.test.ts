import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('iOS Share direct-send progress', () => {
  it('keeps all four truthful stages visible from connection through completion', () => {
    const rootView = read('targets/share/ShareRootView.swift');
    const uploader = read('targets/share/ShareUploader.swift');

    expect(uploader).toMatch(
      /enum ShareUploadStage:[\s\S]*?case connecting[\s\S]*?case connected[\s\S]*?case sending[\s\S]*?case sent/
    );
    expect(rootView).toContain('ForEach(ShareUploadStage.allCases');
    expect(rootView).toContain('ProgressView()');
    expect(rootView).toContain('checkmark.circle.fill');
    expect(rootView).toContain('Image(systemName: "circle")');
    expect(rootView).toContain('updateShareStage(stage)');
    expect(rootView).toContain('shareStage = .connecting');
  });

  it('confirms a receiver connection before reporting that sending began', () => {
    const coordinator = read('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const router = read('targets/_shared/ExtensionSyncRouter.swift');

    expect(coordinator).toMatch(
      /progress\?\(\.connecting\)[\s\S]*?refreshPeersForSend[\s\S]*?progress\?\(\.connected\)[\s\S]*?progress\?\(\.sending\)[\s\S]*?send\(\)/
    );
    expect(coordinator).toMatch(
      /refreshPeersForSend[\s\S]*?for attempt in[\s\S]*?refreshPeerConnections\(\)/
    );
    expect(router).toContain('progress(.sent)');
  });

  it('localizes every status label supported by the Share extension', () => {
    for (const locale of ['zh-Hans', 'en', 'pt-BR', 'ru']) {
      const strings = read(`targets/share/${locale}.lproj/Localizable.strings`);
      for (const label of ['正在连接', '已连接', '正在发送', '发送完成']) {
        expect(strings).toContain(`"${label}"`);
      }
    }
  });

  it('persists one correlated privacy-safe timeline across Share and P2P boundaries', () => {
    const diagnostics = read('targets/_shared/ShareDiagnostics.swift');
    const moduleDiagnostics = read('modules/app-group-store/ios/Shared/ShareDiagnostics.swift');
    const coordinator = read('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const router = read('targets/_shared/ExtensionSyncRouter.swift');
    const uploader = read('targets/share/ShareUploader.swift');
    const rootView = read('targets/share/ShareRootView.swift');
    const nativeModule = read('modules/app-group-store/ios/AppGroupStoreModule.swift');

    expect(moduleDiagnostics).toBe(diagnostics);
    expect(diagnostics).toContain('share-attempts');
    expect(diagnostics).toContain('maxAttempts: Int = 50');
    expect(diagnostics).toContain('retentionMilliseconds: Int64 = 3 * 24 * 60 * 60 * 1_000');
    expect(diagnostics).not.toContain('[String: String]');
    expect(coordinator).toContain('onPeerRefresh?(peerRefresh)');
    expect(router).toContain('onDelivery(delivery)');
    expect(uploader).toContain('diagnostics.record(stage: .engineStarting');
    expect(uploader).toContain('ShareDiagnosticError(error)');
    expect(rootView).toContain('ShareDiagnosticsStore');
    expect(rootView).toContain('stage: .networkObserved');
    expect(nativeModule).toContain('getShareDiagnostics');
  });
});
