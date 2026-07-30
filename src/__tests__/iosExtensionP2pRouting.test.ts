/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('iOS extension P2P routing', () => {
  it('gives extensions only the P2P engine core without the Expo app bridge', () => {
    const podspec = readProjectFile('modules/uc-engine/ios/UcEngine.podspec');
    const module = readProjectFile('modules/uc-engine/ios/UcEngineModule.swift');
    const router = readProjectFile('targets/_shared/ExtensionSyncRouter.swift');

    expect(podspec).toContain("s.dependency 'UcEngineCore'");
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
    expect(podspec).not.toContain('vendored_frameworks');
    expect(module).toContain('import UcEngineCore');
    expect(router).toContain('import UcEngineCore');

    for (const target of ['keyboard', 'share']) {
      const pods = readProjectFile(`targets/${target}/pods.rb`);
      expect(pods).toContain("pod 'UcEngineCore'");
      expect(pods).not.toMatch(/pod 'UcEngine',/);
    }

    const corePodspec = readProjectFile('modules/uc-engine/ios/UcEngineCore.podspec');
    expect(corePodspec).not.toContain('ExpoModulesCore');
    expect(corePodspec).toContain("s.name           = 'UcEngineCore'");
    expect(corePodspec).toContain('s.vendored_frameworks');
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
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const nativeHost = readProjectFile('modules/uc-engine/ios/NativeSystemHost.swift');

    expect(host).toContain('sharedP2pDirectory');
    expect(host).toContain('sharedKeychainService');
    expect(nativeHost).toContain('accessGroup');
  });

  it('runs a bounded independent P2P session and hands runtime ownership between processes', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const ownership = readProjectFile('modules/uc-engine/ios/P2pRuntimeOwnership.swift');
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const module = readProjectFile('modules/uc-engine/ios/UcEngineModule.swift');
    const router = readProjectFile('targets/_shared/ExtensionSyncRouter.swift');
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');

    expect(coordinator).toContain('refreshPeerConnections()');
    expect(coordinator).toContain('nextEvent(timeoutMs:');
    expect(ownership).toContain('systemFlock');
    expect(host).toContain('ExtensionSyncCoordinator');
    expect(host).toContain('activeClipboardChanged');
    expect(host).toContain('restoreClipboard(entryId: entryId, mode: .standard)');
    expect(host).toContain('P2pRuntimeOwnership');
    expect(host).toContain('receiveTimeoutMs: UInt64 = 3_000');
    expect(module).toContain('RuntimeOwnedNativeLifecycle');
    expect(router).toContain('synchronizeKeyboardSnapshot');
    expect(keyboard).toContain('receivedRemoteChange');
    expect(keyboard).toContain('try await ExtensionSyncExecutor.run');
    expect(keyboard).not.toContain(
      'let result = try ExtensionSyncRouter.synchronizeKeyboardSnapshot(snapshot)'
    );
    expect(keyboard).toContain('case .offline');
    expect(keyboard).toContain('case .pending');
    expect(keyboard).toContain('publishP2pRemoteChange(clearError: !deliveryFailed)');
    expect(keyboard).not.toMatch(/guard let snapshot else \{[\s\S]*?pushStatus = \.none/);
  });

  it('coalesces keyboard sync events by source and runs at most one follow-up', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');
    const viewStore = readProjectFile('targets/keyboard/KeyboardModel+ViewStore.swift');

    expect(keyboard).toContain('private var syncEventGate = ExtensionSyncEventGate()');
    expect(keyboard).toContain('func requestSync(_ trigger: ExtensionSyncTrigger)');
    expect(keyboard).toContain('syncEventGate.request(trigger)');
    expect(keyboard).toContain('syncEventGate.finish()');
    expect(keyboard).toContain('requestSync(.appeared)');
    expect(keyboard).toContain('requestSync(.networkChanged)');
    expect(keyboard).toContain('requestSync(.localClipboardChanged)');
    expect(keyboard).toContain('requestSync(.serverChanged)');
    expect(keyboard).toContain('internal import UcEngineCore');
    expect(viewStore).toContain('case .refresh:');
    expect(viewStore).toContain('requestSync(.manual)');
    expect(rootView).not.toContain('UcEngineCore');
    expect(rootView).not.toContain('KeyboardModel');
    expect(keyboard).not.toContain('guard syncTask == nil else { return }');
  });

  it('keeps automatic local clipboard synchronization visually quiet', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const p2pSync = keyboard.match(/private func syncP2pSnapshot\([\s\S]*?\n    \}/)?.[0];

    expect(keyboard).toContain('publishHistoryChanges: trigger.shouldPublishHistoryImmediately');
    expect(p2pSync).toBeDefined();
    expect(p2pSync).toContain('publishHistoryChanges: Bool');
    expect(p2pSync).toContain('showSyncFeedback: Bool');
    expect(keyboard).toContain('if publishHistoryChanges || channel == .lan { reloadCards() }');
    expect(p2pSync).toMatch(/else if publishHistoryChanges\s*\{\s*reloadCards\(\)/);
  });

  it('prepares the restored keyboard before UIKit renders its first frame', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');
    const viewDidLoad = controller.match(/override func viewDidLoad\(\) \{[\s\S]*?\n    \}/)?.[0];
    const preparation = keyboard.match(/func prepareForFirstPresentation\([\s\S]*?\n    \}/)?.[0];

    expect(viewDidLoad).toBeDefined();
    expect(preparation).toBeDefined();
    expect(preparation).toContain('reloadCards()');
    expect(viewDidLoad).toContain('model.prepareForFirstPresentation(');
    expect(viewDidLoad?.indexOf('model.prepareForFirstPresentation(')).toBeLessThan(
      viewDidLoad?.indexOf('KeyboardRootView(viewStore: model)') ?? -1
    );
    expect(viewDidLoad?.indexOf('heightConstraint.isActive = true')).toBeLessThan(
      viewDidLoad?.indexOf('KeyboardRootView(viewStore: model)') ?? -1
    );
  });

  it('hosts the keyboard in a fixed-height UIKit surface without SwiftUI', () => {
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');

    expect(rootView).toContain('final class KeyboardRootView: UIView');
    expect(rootView).not.toContain('import SwiftUI');
    expect(rootView).not.toContain('struct KeyboardRootView: View');
    expect(controller).toContain('override func loadView()');
    expect(controller).toContain('UIInputView(');
    expect(controller).toContain('inputViewStyle: .default');
    expect(controller).toContain('allowsSelfSizing = true');
    expect(controller).toContain('preferredContentSize.height = targetHeight');
    expect(controller).not.toContain('import SwiftUI');
    expect(controller).not.toContain('UIHostingController');
  });

  it('publishes a copied item to the open keyboard without showing automatic progress', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');

    expect(coordinator).toContain('case .localClipboardChanged: return true');
    expect(coordinator).toContain('case .localClipboardChanged: return false');
  });

  it('covers the complete system keyboard frame with the dynamic tray surface', () => {
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');

    expect(rootView).toContain('enum KeyboardSurface');
    expect(rootView).toContain('static let trayUIColor = UIColor { trait in');
    expect(rootView).toContain('trait.userInterfaceStyle == .dark');
    expect(rootView).toContain('? .systemGray6');
    expect(rootView).toContain(': .systemGray5');
    expect(rootView).toContain('isOpaque = false');
    expect(rootView).toContain('backgroundColor = .clear');
    expect(controller).toContain('inputView.backgroundColor = .clear');
    expect(controller).toContain('inputView.isOpaque = false');
    expect(controller).toMatch(
      /keyboardView\.heightAnchor\.constraint\(\s*equalToConstant: keyboardView\.preferredHeight\s*\)/
    );
    expect(controller).toContain(
      'keyboardView.bottomAnchor.constraint(equalTo: view.bottomAnchor)'
    );
    expect(controller).toContain('"surfaceHeight": String(format: "%.1f", keyboardSurfaceHeight)');
    expect(controller).not.toContain('keyboardView.topAnchor.constraint(equalTo: view.topAnchor)');
    expect(controller).not.toContain('alpha: 0.001');
    expect(controller).not.toContain('UIHostingController');
  });

  it('keeps the card row free of the iOS 26 scroll-edge transition', () => {
    const cardList = readProjectFile('targets/keyboard/KeyboardCardListView.swift');

    expect(cardList).toContain('if #available(iOS 26.0, *)');
    expect(cardList).toContain('view.topEdgeEffect.isHidden = true');
    expect(cardList).toContain('view.bottomEdgeEffect.isHidden = true');
    expect(cardList).toContain('view.leftEdgeEffect.isHidden = true');
    expect(cardList).toContain('view.rightEdgeEffect.isHidden = true');
  });

  it('records synchronized clipboard writes and skips unchanged card publication', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const history = readProjectFile('targets/_shared/HistoryDatabase.swift');
    const p2pSync = keyboard.match(/private func syncP2pSnapshot\([\s\S]*?\n    \}/)?.[0];
    const reloadCards = keyboard.match(/private func reloadCards\(\) \{[\s\S]*?\n    \}/)?.[0];
    const cardEquality = keyboard.match(
      /static func == \(lhs: Card, rhs: Card\) -> Bool \{[\s\S]*?\n        \}/
    )?.[0];

    expect(p2pSync).toBeDefined();
    expect(p2pSync).toContain('UIPasteboard.general.changeCount');
    expect(p2pSync).toContain('recordHandledClipboardRevision');
    expect(p2pSync).toContain('clipboardRevisionTracker.markProcessing(changeCount)');
    expect(p2pSync).toContain('clipboardRevisionTracker.finishProcessing(changeCount)');
    expect(p2pSync?.indexOf('markProcessing(changeCount)')).toBeLessThan(
      p2pSync?.indexOf('p2pSession()') ?? -1
    );
    expect(reloadCards).toBeDefined();
    expect(reloadCards).toContain('let nextCards =');
    expect(reloadCards).toContain('guard nextCards != cards else { return }');
    expect(cardEquality).toBeDefined();
    expect(cardEquality).not.toContain('lhs.time');
    expect(cardEquality).not.toContain('rhs.time');
    expect(history).toContain('ExtensionStableIdentifier.uuid(for: hash)');
    expect(history).not.toContain('guard bytes.count == 16 else { return UUID() }');
  });

  it('keeps one P2P session alive only while the keyboard is visible', () => {
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const router = readProjectFile('targets/_shared/ExtensionSyncRouter.swift');
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');

    expect(host).not.toContain('defer { close() }');
    expect(host).toContain('public func waitForRemoteChange(timeoutMs:');
    expect(host).toContain('public func shutdown()');
    expect(router).toContain('using client: ExtensionP2pClient');
    expect(keyboard).toContain('private var p2pClient: ExtensionP2pClient?');
    expect(keyboard).toContain('private var p2pReceiveTask: Task<Void, Never>?');
    expect(keyboard).toContain('startP2pReceiving');
    expect(keyboard).toContain('stopP2pSession');
    expect(keyboard).toContain('syncEventGate.cancelAll()');
    expect(keyboard).toMatch(/func stopMonitoring\(\)[\s\S]*?stopP2pSession\(\)/);
  });

  it('keeps the Share P2P session alive until deferred downloads finish', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const router = readProjectFile('targets/_shared/ExtensionSyncRouter.swift');
    const uploader = readProjectFile('targets/share/ShareUploader.swift');
    const rootView = readProjectFile('targets/share/ShareRootView.swift');

    expect(coordinator).toContain('waitForOutboundDelivery(');
    expect(host).toContain('case .transferProgress(');
    expect(host).toContain('case .transferStatusChanged(');
    expect(host).toContain('public func waitForOutboundDelivery(');
    expect(router).toContain('defer { client.shutdown() }');
    expect(router).toContain('expectedReceiverCount: delivery.accepted');
    expect(router).toContain('requiresRemoteDownloadForImage(byteCount: bytes.count)');
    expect(uploader).toMatch(/func uploadP2p\([\s\S]*?_ item: ShareItem,[\s\S]*?onStage:/);
    expect(uploader).toContain('try await ExtensionSyncExecutor.run');
    expect(rootView).toContain(
      'try await ShareUploader().uploadP2p(item, diagnostics: diagnostics) { stage in'
    );
    expect(rootView).not.toContain('try ShareUploader().uploadP2p(item)');
  });

  it('keeps outbound file handles readable until the Share P2P session shuts down', () => {
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const sendFile = host.match(
      /public func sendFile\(_ url: URL, displayName: String\? = nil\) throws -> SendReport \{[\s\S]*?\n  \}/
    )?.[0];
    const shutdown = host.match(/public func shutdown\(\) \{[\s\S]*?\n  \}/)?.[0];

    expect(sendFile).toBeDefined();
    expect(sendFile).toContain('files.withRetainedInputFile(');
    expect(sendFile).not.toContain('defer { files.remove(handle) }');
    expect(shutdown).toBeDefined();
    expect(shutdown).toContain('files.removeAll()');
  });

  it('persists privacy-safe keyboard diagnostics across the full sync and render path', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');

    expect(keyboard).toContain('final class KeyboardDiagnostics');
    expect(keyboard).toContain('Library/Caches/UniClipDiagnostics');
    expect(keyboard).toContain('keyboard.jsonl');
    expect(keyboard).toContain('DispatchQueue(');
    expect(keyboard).toContain('maxFileBytes = 1_048_576');
    expect(keyboard).toContain('sessionID');
    expect(keyboard).toContain('processIdentifier');
    expect(keyboard).toContain('JSONEncoder');
    expect(keyboard).toContain('"mismatchIndex"');
    expect(keyboard).toContain('"changedFields"');
    expect(keyboard).toContain('"refreshOnline"');
    expect(keyboard).toContain('"refreshOffline"');
    expect(coordinator).toContain('peerRefresh');
    expect(host).toContain('ExtensionPeerRefreshReport');

    for (const event of [
      'model.appear',
      'model.stop',
      'clipboard.poll',
      'sync.request',
      'sync.start',
      'sync.finish',
      'p2p.connect.start',
      'p2p.connect.success',
      'p2p.connect.failure',
      'p2p.send.result',
      'p2p.receive.wait',
      'p2p.receive.change',
      'p2p.receive.failure',
      'p2p.close.start',
      'history.reload',
    ]) {
      expect(keyboard).toContain(`"${event}"`);
    }

    for (const event of [
      'controller.load',
      'controller.appear',
      'controller.disappear',
      'controller.layout',
    ]) {
      expect(controller).toContain(`"${event}"`);
    }

    expect(keyboard).not.toContain('snapshot.clipboard.text');
    expect(keyboard).not.toContain('fields: ["server"');
    expect(keyboard).not.toContain('fields: ["password"');
  });
});
