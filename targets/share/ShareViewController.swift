import Foundation
import UIKit

/// Principal class for the Share Extension. iOS instantiates this when the
/// user picks UniClipboard from the system share sheet.
///
/// The extension stages content and hands the user back to the host's Share
/// screen. It never starts an engine session or sends content itself.
final class ShareViewController: UIViewController {
    private var isVisible = false
    private var pendingHandoffID: String?

    override func viewDidLoad() {
        super.viewDidLoad()

        // 哑扩展不渲染任何 UI:立即隐藏自身视图,避免在提取/唤醒主应用期间
        // 向用户露出一个空白分享 sheet(隐藏不影响 viewDidAppear 与跳转)。
        view.isHidden = true

        SentryBootstrap.start()

        guard let context = extensionContext else { return }
        let inputContext = ShareExtensionContext(context)

        Task.detached(priority: .userInitiated) { // 不在主线程,避免阻塞面板关闭
            do {
                let item = try await ShareItemExtractor.extract(from: inputContext)
                let staged = try OutboundShareStore().stage(item) // 按 kind 分派
                try await Self.recordInHistory(staged)
                _ = try OutboundShareStore().enqueue(staged) // targetDeviceIds 恒为空
                Self.recordDiagnostics(staged: staged)
                await MainActor.run { [weak self] in
                    self?.requestHostHandoff(id: staged.id)
                }
            } catch {
                Self.recordDiagnostics(staged: nil)
                await MainActor.run {
                    context.completeRequest(returningItems: nil, completionHandler: nil)
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

        pendingHandoffID = nil
        Self.recordHandoff(stage: .handoffStarted, id: id)
        let responder = sequence(first: self, next: \.next)
            .first(where: { $0 is UIApplication })
        guard let application = responder as? UIApplication else {
            Self.recordHandoff(
                stage: .failed,
                id: id,
                error: ShareDiagnosticError(code: .handoffFailed)
            )
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            return
        }

        application.open(handoffURL, options: [:]) { [weak self] opened in
            Self.recordHandoff(
                stage: opened ? .handoffQueued : .failed,
                id: id,
                error: opened ? nil : ShareDiagnosticError(code: .handoffFailed)
            )
            self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    private static var hostShareURL: URL? {
        let scheme = SettingsStore.appGroupID.hasSuffix(".dev")
            ? "uniclipboard-dev"
            : "uniclipboard"
        return URL(string: "\(scheme)://share")
    }

    /// Records the staging phase of the share attempt. The attempt id equals
    /// the job id, so the main app can continue the same attempt when it
    /// sends the job from the share page (ShareDiagnosticsStore.record(for:)).
    nonisolated private static func recordDiagnostics(staged: StagedShareFile?) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ), let store = try? ShareDiagnosticsStore(containerURL: container) else { return }

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
        error: ShareDiagnosticError? = nil
    ) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ), let store = try? ShareDiagnosticsStore(containerURL: container) else { return }
        store.record(stage: stage, error: error, for: id)
    }

    nonisolated private static func recordInHistory(_ staged: StagedShareFile) async throws {
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

        if entry.hasData, let hash = entry.hash {
            try await PayloadCache.shared.writeFile(
                profileId: "\(entry.type.rawValue)-\(hash)",
                from: staged.url
            )
        }
        _ = HistoryLog(store: SettingsStore()).append(entry: entry, direction: .local)
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
