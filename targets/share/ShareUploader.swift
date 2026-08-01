import Foundation
internal import UcEngineCore

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

struct ShareUploader {
    func uploadP2p(
        _ item: ShareItem,
        targetDevices: [String],
        diagnostics: ShareDiagnosticRecorder?,
        onStage: @escaping @MainActor @Sendable (ShareUploadStage) -> Void,
        onTransferProgress: @escaping @MainActor @Sendable (ExtensionTransferProgress) -> Void
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
                        let transferProgress: @Sendable (ExtensionTransferProgress) -> Void = { progress in
                            Task { @MainActor in
                                onTransferProgress(progress)
                            }
                        }
                        switch item {
                        case .text(let text):
                            try ExtensionSyncRouter.sendText(
                                text,
                                targetDevices: targetDevices,
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery
                            )
                        case .image(let bytes, let ext):
                            try ExtensionSyncRouter.sendImage(
                                bytes,
                                ext: ext,
                                targetDevices: targetDevices,
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery,
                                onTransferProgress: transferProgress
                            )
                        case .file(let staged):
                            try ExtensionSyncRouter.sendFile(
                                staged.url,
                                displayName: Clipboard.sanitizedFilename(staged.displayName),
                                targetDevices: targetDevices,
                                progress: progress,
                                onPeerRefresh: onPeerRefresh,
                                onDelivery: onDelivery,
                                onTransferProgress: transferProgress
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
        if let error = error as? ExtensionPeerConnectionError {
            self.init(connectionError: error)
        } else if let error = error as? ExtensionP2pError {
            self.init(p2pError: error)
        } else if let error = error as? ExtensionOutboundDeliveryError {
            self.init(deliveryError: error)
        } else if let error = error as? BindingError {
            self.init(bindingError: error)
        } else if error is CancellationError {
            self.init(code: .cancelled)
        } else {
            self.init(code: .unknown)
        }
    }

    init(connectionError: ExtensionPeerConnectionError) {
        switch connectionError {
        case .noOnlinePeer: self.init(code: .receiverOffline)
        case .connectionTimedOut: self.init(code: .connectTimeout)
        }
    }

    init(p2pError: ExtensionP2pError) {
        switch p2pError {
        case .sharedStoreUnavailable: self.init(code: .sharedStoreUnavailable)
        case .spaceUnavailable: self.init(code: .spaceUnavailable)
        case .runtimeBusy: self.init(code: .runtimeBusy)
        case .sessionClosed: self.init(code: .sessionClosed)
        case .deliveryIncomplete(let state): self.init(code: state.diagnosticErrorCode)
        }
    }

    init(deliveryError: ExtensionOutboundDeliveryError) {
        switch deliveryError {
        case .timedOut: self.init(code: .deliveryTimedOut)
        case .failed: self.init(code: .deliveryDownloadFailed)
        case .cancelled: self.init(code: .deliveryCancelled)
        }
    }

    init(bindingError: BindingError) {
        switch bindingError {
        case .Engine(let code, let category, let retryable):
            self.init(
                code: .engine,
                engineCode: code,
                engineCategory: ShareDiagnosticEngineCategory(category),
                retryable: retryable
            )
        case .HostUnavailable: self.init(code: .hostUnavailable)
        case .HostPermissionDenied: self.init(code: .hostPermissionDenied)
        case .HostInvalidHandle: self.init(code: .hostInvalidHandle)
        case .HostIo: self.init(code: .hostIO)
        case .RuntimeUnavailable: self.init(code: .runtimeUnavailable)
        case .AlreadyStopped: self.init(code: .alreadyStopped)
        case .UnexpectedResult: self.init(code: .unexpectedEngineResult)
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
