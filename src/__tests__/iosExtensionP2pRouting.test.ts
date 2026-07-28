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

    expect(keyboard).toContain('private var syncEventGate = ExtensionSyncEventGate()');
    expect(keyboard).toContain('func requestSync(_ trigger: ExtensionSyncTrigger)');
    expect(keyboard).toContain('syncEventGate.request(trigger)');
    expect(keyboard).toContain('syncEventGate.finish()');
    expect(keyboard).toContain('requestSync(.appeared)');
    expect(keyboard).toContain('requestSync(.networkChanged)');
    expect(keyboard).toContain('requestSync(.localClipboardChanged)');
    expect(keyboard).toContain('requestSync(.serverChanged)');
    expect(rootView).toContain('internal import UcEngineCore');
    expect(rootView).toContain('model.requestSync(.manual)');
    expect(keyboard).not.toContain('guard syncTask == nil else { return }');
  });

  it('keeps automatic local clipboard synchronization visually quiet', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const p2pSync = keyboard.match(/private func syncP2pSnapshot\([\s\S]*?\n    \}/)?.[0];

    expect(keyboard).toContain('syncPresentation.setSyncing(trigger.showsSyncProgress)');
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
      viewDidLoad?.indexOf('KeyboardRootView(model: model)') ?? -1
    );
    expect(viewDidLoad?.indexOf('heightConstraint.isActive = true')).toBeLessThan(
      viewDidLoad?.indexOf('KeyboardRootView(model: model)') ?? -1
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
    expect(controller).toContain('allowsSelfSizing = true');
    expect(controller).toContain('preferredContentSize.height = targetHeight');
    expect(controller).not.toContain('import SwiftUI');
    expect(controller).not.toContain('UIHostingController');
  });

  it('renders the values delivered by Combine instead of rereading stale published storage', () => {
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');

    expect(rootView).toContain(
      'Publishers.CombineLatest3(cards.$gate, cards.$lastError, cards.$cards)'
    );
    expect(rootView).toContain('self?.renderCards(gate: gate, lastError: lastError, cards: cards)');
    expect(rootView).not.toContain('cards.$cards.sink { [weak self] _ in self?.renderCards() }');
  });

  it('publishes a copied item to the open keyboard without showing automatic progress', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');

    expect(coordinator).toContain('case .localClipboardChanged: return true');
    expect(coordinator).toContain('case .localClipboardChanged: return false');
  });

  it('keeps the opaque keyboard surface bounded to keyboard height during system resizing', () => {
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');

    expect(rootView).toContain('enum KeyboardSurface');
    expect(rootView).toContain('static let trayUIColor = UIColor.systemGray5');
    expect(rootView).toContain('backgroundColor = KeyboardSurface.trayUIColor');
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

  it('keeps transient sync progress from invalidating the whole keyboard view', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');
    const keyboardModel = keyboard.match(
      /final class KeyboardModel: ObservableObject \{[\s\S]*?\/\/\/ A deliberately narrow observation surface/
    )?.[0];

    expect(keyboardModel).toBeDefined();
    expect(keyboard).toContain('let syncPresentation = KeyboardSyncPresentation()');
    expect(keyboardModel).not.toContain('@Published private(set) var isSyncing');
    expect(keyboardModel).not.toContain('@Published private(set) var syncFlash');
    expect(rootView).toContain('sync.$isSyncing.sink');
    expect(rootView).toContain('sync.$flash.sink');
    expect(rootView).toContain('private func renderSyncButton()');
    expect(rootView).not.toContain('model.$isSyncing');
    expect(rootView).not.toContain('model.$syncFlash');
  });

  it('publishes top-bar, card-list, and card-action changes independently', () => {
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');
    expect(keyboard).toContain('let topBarPresentation = KeyboardTopBarPresentation()');
    expect(keyboard).toContain('let cardListPresentation = KeyboardCardListPresentation()');
    expect(keyboard).toContain('let cardActionPresentation = KeyboardCardActionPresentation()');
    expect(rootView).toContain('top.$serverLabel.sink');
    expect(rootView).toContain(
      'Publishers.CombineLatest3(cards.$gate, cards.$lastError, cards.$cards)'
    );
    expect(rootView).toContain('actions.$actingCardID.sink');
    expect(rootView).toContain('private func renderTopBar()');
    expect(rootView).toContain('private func renderCards()');
    expect(rootView).toContain('private func renderCardActions()');
    expect(rootView).not.toContain('KeyboardContentPresentation');
    expect(rootView).not.toContain('@ObservedObject');
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

  it('persists privacy-safe keyboard diagnostics across the full sync and render path', () => {
    const coordinator = readProjectFile('modules/uc-engine/ios/ExtensionSyncCoordinator.swift');
    const host = readProjectFile('modules/uc-engine/ios/SharedEngineHost.swift');
    const keyboard = readProjectFile('targets/keyboard/KeyboardModel.swift');
    const controller = readProjectFile('targets/keyboard/KeyboardViewController.swift');
    const rootView = readProjectFile('targets/keyboard/KeyboardRootView.swift');

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
      'presentation.publish',
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

    expect(rootView).toContain('KeyboardDiagnostics.shared.record("view.render"');
    expect(rootView).toContain('"surface": "layout"');
    expect(rootView).toContain('"surface": "cards"');

    expect(keyboard).not.toContain('snapshot.clipboard.text');
    expect(keyboard).not.toContain('fields: ["server"');
    expect(keyboard).not.toContain('fields: ["password"');
  });
});
