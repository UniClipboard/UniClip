import Foundation
internal import UcEngineCore
import OSLog

private let log = Logger(subsystem: "app.uniclipboard", category: "share")

enum ShareUploadStage: Int, CaseIterable, Sendable {
    case connecting
    case connected
    case sending
    case sent

    init(_ progress: ExtensionSendProgress) {
        switch progress {
        case .connecting: self = .connecting
        case .connected: self = .connected
        case .sending: self = .sending
        case .sent: self = .sent
        }
    }
}

/// Uploads a single `ShareItem` to the active SyncClipboard server.
/// Lives in the Share Extension target — owns the §3.5 file-first PUT
/// sequence (file bytes first, metadata second) so the main app's sync
/// engine, when it next ticks, sees a fully-consistent server state.
///
/// Writes `lastSyncedContentHash` to the App-Group `SettingsStore` after
/// a successful push. This is what keeps the main app's `SyncEngine` from
/// interpreting the just-pushed entry as "server has new content" and
/// echoing it back to the device pasteboard on next tick (which would
/// trigger iOS's "Allow Paste" prompt — see CLAUDE.md notes on engine
/// dedup against `lastSyncedContentHash`).
struct ShareUploader {
    let store: SettingsStore

    init(store: SettingsStore = SettingsStore()) {
        self.store = store
    }

    func upload(
        _ item: ShareItem,
        to server: ServerConfig,
        trustInsecureCert: Bool,
        network: NetworkContext,
        diagnostics: ShareDiagnosticRecorder?,
        onStage: @escaping @MainActor @Sendable (ShareUploadStage) -> Void
    ) async throws {
        diagnostics?.record(stage: .connecting)
        await onStage(.connecting)
        do {
            let (entry, payload) = try build(from: item)
            let clients = ShareClientPool(trustInsecureCert: trustInsecureCert)
            logUploadStart(item: item, entry: entry, server: server)

            try await ServerRouteExecutor(store: store).run(
                server: server,
                network: network,
                probe: { routed in
                    let client = try await clients.client(for: routed)
                    try await client.probeReachability()
                },
                operation: { routed in
                    let client = try await clients.client(for: routed)
                    try await client.probeReachability()
                    diagnostics?.record(stage: .connected)
                    await onStage(.connected)
                    diagnostics?.record(stage: .sending)
                    await onStage(.sending)
                    if case .file(let staged) = item, let name = entry.dataName {
                        try await client.putFile(
                            name: name,
                            fileURL: staged.url,
                            byteCount: staged.byteCount
                        )
                        log.debug("upload: file-backed PUT done")
                    } else if entry.hasData, let payload, let name = entry.dataName {
                        try await client.putFile(name: name, body: payload)
                        log.debug("upload: §3.5 file PUT done")
                        if let hash = entry.hash, !hash.isEmpty {
                            let profileId = HistoryRecord.profileId(type: entry.type, hash: hash)
                            _ = try? await PayloadCache.shared.write(profileId: profileId, bytes: payload)
                        }
                    }
                    try await client.putClipboard(entry)
                }
            )
            diagnostics?.record(stage: .sent)
            await onStage(.sent)
            // Write the watermark only after a confirmed metadata PUT. A failed
            // route attempt may have uploaded bytes but did not publish metadata;
            // stamping before success can make the next sync skip real work.
            if let hash = entry.hash, !hash.isEmpty {
                store.saveLastSyncedHash(hash)
                // The pushed entry has no server identity yet — clear any stale
                // contentId watermark (kept atomic with the hash) so the main
                // app's SyncEngine doesn't dedup against a now-wrong identity. It
                // is re-learned on the next GET, where the server returns one.
                store.saveLastSyncedContentId(nil)
            }
            log.info("upload: metadata PUT done, watermark advanced")
            log.error("[share-route-v3] upload complete server=\(server.id, privacy: .public)")

            // Surface the push in the shared history so it shows up in the
            // main app's Home list. The app's SyncEngine won't log it on its own —
            // it sees the watermark we just wrote and treats the server entry as
            // already synced (skipping its own append). Routes to the shared
            // SQLite database (single source of truth) with a JSON-log fallback.
            HistoryLog(store: store).append(entry: entry, direction: .pushed)

            // Tell iOS Sharing Suggestions "the user just sent this to this
            // server" so next time the share sheet ranks the server's
            // contact tile higher. Best-effort: failures are swallowed inside.
            await ShareIntentDonation.donateSend(to: server, summary: item.displayName)
        } catch {
            diagnostics?.record(stage: .failed, error: ShareDiagnosticError(error))
            throw error
        }
    }

    private func build(from item: ShareItem) throws -> (clipboard: Clipboard, payload: Data?) {
        switch item {
        case .text(let text):
            return Clipboard.publishText(text)
        case .image(let bytes, let ext):
            return Clipboard.publishImage(bytes: bytes, ext: ext)
        case .file(let staged):
            let name = Clipboard.sanitizedFilename(staged.displayName)
            return (
                Clipboard(
                    type: .file,
                    hash: try OutboundShareStore.sha256Upper(of: staged.url),
                    text: name,
                    hasData: true,
                    dataName: name,
                    size: Int(clamping: staged.byteCount)
                ),
                nil
            )
        }
    }

    func uploadP2p(
        _ item: ShareItem,
        diagnostics: ShareDiagnosticRecorder?,
        onStage: @escaping @MainActor @Sendable (ShareUploadStage) -> Void
    ) async throws {
        if let diagnostics {
            diagnostics.record(stage: .engineStarting)
        }
        let waitsForDelivery: Bool
        switch item {
        case .file:
            waitsForDelivery = true
        case .image(let bytes, _):
            waitsForDelivery = ExtensionOutboundDeliveryPolicy
                .requiresRemoteDownloadForImage(byteCount: bytes.count)
        case .text:
            waitsForDelivery = false
        }
        let stream = AsyncThrowingStream<ShareUploadStage, Error> { continuation in
            Task {
                do {
                    try await ExtensionSyncExecutor.run {
                        let progress: @Sendable (ExtensionSendProgress) -> Void = {
                            let stage = ShareUploadStage($0)
                            if stage == .connecting {
                                diagnostics?.record(stage: .engineReady)
                            }
                            diagnostics?.record(stage: stage.diagnosticStage)
                            continuation.yield(stage)
                        }
                        let onPeerRefresh: @Sendable (ExtensionPeerRefreshReport) -> Void = {
                            diagnostics?.record(
                                stage: .peerRefresh,
                                peerRefresh: ShareDiagnosticPeerRefresh($0)
                            )
                        }
                        let onDelivery: @Sendable (ExtensionDeliveryReport) -> Void = {
                            diagnostics?.record(
                                stage: .deliveryAccepted,
                                delivery: ShareDiagnosticDelivery($0)
                            )
                            if waitsForDelivery {
                                diagnostics?.record(stage: .deliveryWaiting)
                            }
                        }
                        switch item {
                        case .text(let text):
                            try ExtensionSyncRouter.sendText(
                                text,
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery
                            )
                        case .image(let bytes, let ext):
                            try ExtensionSyncRouter.sendImage(
                                bytes,
                                ext: ext,
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery
                            )
                        case .file(let staged):
                            try ExtensionSyncRouter.sendFile(
                                staged.url,
                                displayName: Clipboard.sanitizedFilename(staged.displayName),
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery
                            )
                        }
                    }
                    continuation.finish()
                } catch {
                    diagnostics?.record(stage: .failed, error: ShareDiagnosticError(error))
                    continuation.finish(throwing: error)
                }
            }
        }
        for try await stage in stream {
            await onStage(stage)
        }
    }
}

private extension ShareUploadStage {
    var diagnosticStage: ShareDiagnosticStage {
        switch self {
        case .connecting: return .connecting
        case .connected: return .connected
        case .sending: return .sending
        case .sent: return .sent
        }
    }
}

private extension ShareDiagnosticPeerRefresh {
    init(_ report: ExtensionPeerRefreshReport) {
        self.init(
            total: report.total,
            online: report.online,
            offline: report.offline,
            errors: report.errors
        )
    }
}

private extension ShareDiagnosticDelivery {
    init(_ report: ExtensionDeliveryReport) {
        self.init(
            accepted: report.accepted,
            duplicate: report.duplicate,
            offline: report.offline,
            errored: report.errored,
            pending: report.pending
        )
    }
}

private extension ShareDiagnosticError {
    init(_ error: Error) {
        switch error {
        case ExtensionPeerConnectionError.noOnlinePeer:
            self.init(code: .receiverOffline)
        case ExtensionPeerConnectionError.connectionTimedOut:
            self.init(code: .connectTimeout)
        case ExtensionP2pError.sharedStoreUnavailable:
            self.init(code: .sharedStoreUnavailable)
        case ExtensionP2pError.spaceUnavailable:
            self.init(code: .spaceUnavailable)
        case ExtensionP2pError.runtimeBusy:
            self.init(code: .runtimeBusy)
        case ExtensionP2pError.sessionClosed:
            self.init(code: .sessionClosed)
        case ExtensionP2pError.deliveryIncomplete(let state):
            self.init(code: state.diagnosticErrorCode)
        case ExtensionOutboundDeliveryError.timedOut:
            self.init(code: .deliveryTimedOut)
        case ExtensionOutboundDeliveryError.failed:
            self.init(code: .deliveryDownloadFailed)
        case ExtensionOutboundDeliveryError.cancelled:
            self.init(code: .deliveryCancelled)
        case BindingError.Engine(let code, let category, let retryable):
            self.init(
                code: .engine,
                engineCode: code,
                engineCategory: ShareDiagnosticEngineCategory(category),
                retryable: retryable
            )
        case BindingError.HostUnavailable:
            self.init(code: .hostUnavailable)
        case BindingError.HostPermissionDenied:
            self.init(code: .hostPermissionDenied)
        case BindingError.HostInvalidHandle:
            self.init(code: .hostInvalidHandle)
        case BindingError.HostIo:
            self.init(code: .hostIO)
        case BindingError.RuntimeUnavailable:
            self.init(code: .runtimeUnavailable)
        case BindingError.AlreadyStopped:
            self.init(code: .alreadyStopped)
        case BindingError.UnexpectedResult:
            self.init(code: .unexpectedEngineResult)
        case let sync as SyncError:
            self.init(code: sync.kind.diagnosticErrorCode)
        case is CancellationError:
            self.init(code: .cancelled)
        default:
            self.init(code: .unknown)
        }
    }
}

private extension ExtensionDeliveryState {
    var diagnosticErrorCode: ShareDiagnosticErrorCode {
        switch self {
        case .delivered: return .deliveryFailed
        case .partial: return .deliveryPartial
        case .offline: return .deliveryOffline
        case .pending: return .deliveryPending
        case .failed: return .deliveryFailed
        }
    }
}

private extension ShareDiagnosticEngineCategory {
    init(_ category: BindingErrorCategory) {
        switch category {
        case .invalidInput: self = .invalidInput
        case .invalidState: self = .invalidState
        case .unauthorized: self = .unauthorized
        case .notFound: self = .notFound
        case .conflict: self = .conflict
        case .unavailable: self = .unavailable
        case .deadlineExceeded: self = .deadlineExceeded
        case .internal: self = .internal
        }
    }
}

private extension SyncError.Kind {
    var diagnosticErrorCode: ShareDiagnosticErrorCode {
        switch self {
        case .invalidURL: return .invalidURL
        case .connectTimeout: return .connectTimeout
        case .receiveTimeout: return .receiveTimeout
        case .networkUnreachable: return .networkUnreachable
        case .authFailed: return .authentication
        case .notFound: return .notFound
        case .protocolError: return .protocolError
        case .serverError: return .serverError
        case .decodingFailed: return .protocolError
        case .hashMismatch: return .hashMismatch
        case .cancelled: return .cancelled
        }
    }
}

private func logUploadStart(item: ShareItem, entry: Clipboard, server: ServerConfig) {
    let urlList = server.urls.joined(separator: " | ")
    log.info(
        """
        upload: start \(item.kindLabel, privacy: .public) \
        bytes=\(item.byteCount, privacy: .public) hasData=\(entry.hasData, privacy: .public)
        """
    )
    log.error(
        """
        [share-route-v3] upload start server=\(server.id, privacy: .public) \
        urlCount=\(server.urls.count, privacy: .public) urls=\(urlList, privacy: .public) \
        hasData=\(entry.hasData, privacy: .public)
        """
    )
}

private actor ShareClientPool {
    private let trustInsecureCert: Bool
    private var clients: [String: SyncClipboardClient] = [:]

    init(trustInsecureCert: Bool) {
        self.trustInsecureCert = trustInsecureCert
    }

    func client(for server: ServerConfig) throws -> SyncClipboardClient {
        if let client = clients[server.url] {
            return client
        }
        let client = try SyncClipboardClient(
            server: server,
            trustInsecureCert: trustInsecureCert
        )
        clients[server.url] = client
        return client
    }
}
