import Foundation
internal import class AppGroupStore.SharedStorageAccess
import UIKit

/// Principal class for the Share Extension. iOS instantiates this when the
/// user picks UniClipboard from the system share sheet.
///
/// The extension stages content and hands the user back to the host's Share
/// screen. It never starts an engine session or sends content itself.
final class ShareViewController: UIViewController {
    private var isVisible = false
    private var storageGeneration: UInt64 = 0
    private var pendingHandoffID: String?
    private var nativeObservation: NativeDiagnosticOperation?
    nonisolated private static let nativeDiagnostics = NativeRuntimeDiagnostics(
        directory: FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)?
            .appendingPathComponent("Library/Caches/UniClipDiagnostics", isDirectory: true),
        role: .shareExtension
    )

    override func viewDidLoad() {
        super.viewDidLoad()
        SharedStorageAccess.shared.resume()
        storageGeneration = SharedStorageAccess.shared.generation

        // 哑扩展不渲染任何 UI:立即隐藏自身视图,避免在提取/唤醒主应用期间
        // 向用户露出一个空白分享 sheet(隐藏不影响 viewDidAppear 与跳转)。
        view.isHidden = true

        SentryBootstrap.start()

        guard let context = extensionContext else { return }
        nativeObservation = Self.nativeDiagnostics.begin(.shareHandoff, trigger: .userRequest)
        let inputContext = ShareExtensionContext(context)
        let generation = SharedStorageAccess.shared.generation

        Task.detached(priority: .userInitiated) { // 不在主线程,避免阻塞面板关闭
            do {
                let item = try await ShareItemExtractor.extract(from: inputContext)
                let staged = try SharedStorageAccess.shared.withAccess(generation: generation) {
                    try OutboundShareStore().stage(item)
                } // 按 kind 分派
                try await Self.recordInHistory(staged, generation: generation)
                _ = try SharedStorageAccess.shared.withAccess(generation: generation) {
                    try OutboundShareStore().enqueue(staged)
                } // targetDeviceIds 恒为空
                Self.recordDiagnostics(staged: staged, generation: generation)
                await MainActor.run { [weak self] in
                    self?.requestHostHandoff(id: staged.id)
                }
            } catch {
                Self.recordDiagnostics(staged: nil, generation: generation)
                await MainActor.run { [weak self] in
                    self?.finishNativeObservation(succeeded: false)
                    Self.completeRequest(context, generation: generation)
                }
            }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        isVisible = true
        openHostIfReady()
    }

    private func requestHostHandoff(id: String) {
        pendingHandoffID = id
        openHostIfReady()
    }

    private func openHostIfReady() {
        guard isVisible,
              let id = pendingHandoffID,
              let handoffURL = Self.hostShareURL
        else { return }

        let generation = storageGeneration
        pendingHandoffID = nil
        Self.recordHandoff(stage: .handoffStarted, id: id, generation: generation)
        let responder = sequence(first: self, next: \.next)
            .first(where: { $0 is UIApplication })
        guard let application = responder as? UIApplication else {
            Self.recordHandoff(
                stage: .failed,
                id: id,
                error: ShareDiagnosticError(code: .handoffFailed),
                generation: generation
            )
            finishNativeObservation(succeeded: false)
            if let context = extensionContext { Self.completeRequest(context, generation: generation) }
            return
        }

        application.open(handoffURL, options: [:]) { [weak self] opened in
            Self.recordHandoff(
                stage: opened ? .handoffQueued : .failed,
                id: id,
                error: opened ? nil : ShareDiagnosticError(code: .handoffFailed),
                generation: generation
            )
            self?.finishNativeObservation(succeeded: opened)
            if let context = self?.extensionContext { Self.completeRequest(context, generation: generation) }
        }
    }

    private func finishNativeObservation(succeeded: Bool) {
        guard let observation = nativeObservation else { return }
        nativeObservation = nil
        Self.nativeDiagnostics.finish(observation, outcome: succeeded ? .succeeded : .failed,
            failure: succeeded ? nil : .init(reason: .nativeFailure))
    }

    nonisolated private static func completeRequest(_ context: NSExtensionContext, generation: UInt64) {
        SharedStorageAccess.shared.suspend(ifGeneration: generation) {
            SharedStorageAccess.shared.whenFilesClosed(generation: generation) {
                DispatchQueue.main.async {
                    context.completeRequest(returningItems: nil, completionHandler: nil)
                }
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        isVisible = false
        SharedStorageAccess.shared.suspend(ifGeneration: storageGeneration)
    }

    private static var hostShareURL: URL? {
        let groupID = SettingsStore.appGroupID
        let scheme = groupID.hasSuffix(".dev")
            ? "uniclipboard-dev"
            : groupID.hasSuffix(".test") ? "uniclipboard-test" : "uniclipboard"
        return URL(string: "\(scheme)://share")
    }

    /// Records the staging phase of the share attempt. The attempt id equals
    /// the job id, so the main app can continue the same attempt when it
    /// sends the job from the share page (ShareDiagnosticsStore.record(for:)).
    nonisolated private static func recordDiagnostics(staged: StagedShareFile?, generation: UInt64) {
        guard SharedStorageAccess.shared.isOpen, SharedStorageAccess.shared.generation == generation else { return }
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ), let store = try? ShareDiagnosticsStore(containerURL: container, storageGeneration: generation) else { return }

        if let staged {
            guard let recorder = try? store.startAttempt(
                id: staged.id,
                itemKind: staged.kind.diagnosticItemKind,
                byteCount: Int(staged.byteCount)
            ) else { return }
            recorder.record(stage: .staged)
        } else {
            guard let recorder = try? store.startAttempt(
                id: UUID().uuidString.lowercased(),
                itemKind: .file,
                byteCount: 0
            ) else { return }
            recorder.record(stage: .stagedFailed, error: ShareDiagnosticError(code: .handoffFailed))
        }
    }

    nonisolated private static func recordHandoff(
        stage: ShareDiagnosticStage,
        id: String,
        error: ShareDiagnosticError? = nil,
        generation: UInt64
    ) {
        guard SharedStorageAccess.shared.isOpen, SharedStorageAccess.shared.generation == generation else { return }
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ), let store = try? ShareDiagnosticsStore(containerURL: container, storageGeneration: generation) else { return }
        store.record(stage: stage, error: error, for: id)
    }

    nonisolated private static func recordInHistory(_ staged: StagedShareFile, generation: UInt64) async throws {
        try SharedStorageAccess.shared.requireOpen()
        guard SharedStorageAccess.shared.generation == generation else { throw SharedStorageAccess.AccessError.suspended }
        let entry = try SharedStorageAccess.shared.withAccess(generation: generation) { () throws -> Clipboard in
            let entry: Clipboard
            switch staged.kind {
            case .text:
                let text = try String(contentsOf: staged.url, encoding: .utf8)
                entry = Clipboard.publishText(text).clipboard
            case .image, .file:
                let hash = try OutboundShareStore.sha256Upper(of: staged.url)
                entry = Clipboard(
                    type: staged.kind == .image ? .image : .file,
                    hash: hash,
                    text: staged.displayName,
                    hasData: true,
                    dataName: staged.displayName,
                    size: Int(clamping: staged.byteCount)
                )
            }

            return entry
        }

        if entry.hasData, let hash = entry.hash {
            try await PayloadCache.shared.writeFile(
                profileId: "\(entry.type.rawValue)-\(hash)",
                from: staged.url,
                generation: generation
            )
        }
        _ = try SharedStorageAccess.shared.withAccess(generation: generation) {
            HistoryLog(store: SettingsStore()).append(entry: entry, direction: .local)
        }
    }
}

private extension JobKind {
    var diagnosticItemKind: ShareDiagnosticItemKind {
        switch self {
        case .text: return .text
        case .image: return .image
        case .file: return .file
        }
    }
}

/// Thin wrapper around `NSExtensionContext` so extraction doesn't reach into
/// UIKit for attachment loading.
struct ShareExtensionContext {
    let inputItems: [NSExtensionItem]

    init(_ context: NSExtensionContext) {
        self.inputItems = context.inputItems.compactMap { $0 as? NSExtensionItem }
    }
}
