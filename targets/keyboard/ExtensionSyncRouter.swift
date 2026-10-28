import Foundation
internal import UcEngineCore

enum KeyboardRemoteChange: Sendable {
    case pasteboardUpdated
    case snapshot(DeviceClipboardSnapshot)
}

struct KeyboardSyncResult: Sendable {
    let remoteChange: KeyboardRemoteChange?
    let delivery: ExtensionDeliveryReport?
    let peerRefresh: ExtensionPeerRefreshReport

    init(
        remoteChange: KeyboardRemoteChange? = nil,
        delivery: ExtensionDeliveryReport? = nil,
        peerRefresh: ExtensionPeerRefreshReport = .init(
            total: 0,
            online: 0,
            offline: 0,
            errors: 0
        )
    ) {
        self.remoteChange = remoteChange
        self.delivery = delivery
        self.peerRefresh = peerRefresh
    }
}

@MainActor
protocol KeyboardSyncTransport: AnyObject {
    var channel: SyncChannel { get }
    func synchronize(_ snapshot: DeviceClipboardSnapshot?) async throws -> KeyboardSyncResult
    func waitForRemoteChange(timeoutMs: UInt64) async throws -> KeyboardRemoteChange?
    func stop()
}

@MainActor
final class KeyboardP2pSyncTransport: KeyboardSyncTransport {
    let channel = SyncChannel.p2p
    private var client: ExtensionP2pClient?
    private var controller: ExtensionP2pClientController?

    func synchronize(_ snapshot: DeviceClipboardSnapshot?) async throws -> KeyboardSyncResult {
        let client = try await session()
        let result = try await ExtensionSyncExecutor.run {
            try ExtensionSyncRouter.synchronizeP2pSnapshot(snapshot, using: client)
        }
        return KeyboardSyncResult(
            remoteChange: result.receivedRemoteChange ? .pasteboardUpdated : nil,
            delivery: result.delivery,
            peerRefresh: result.peerRefresh
        )
    }

    func waitForRemoteChange(timeoutMs: UInt64) async throws -> KeyboardRemoteChange? {
        let client = try await session()
        let received = try await ExtensionSyncExecutor.run {
            try client.waitForRemoteChange(timeoutMs: timeoutMs)
        }
        return received ? .pasteboardUpdated : nil
    }

    func stop() {
        let activeClient = client
        let activeController = controller
        client = nil
        controller = nil
        if let activeClient {
            activeClient.shutdown()
        } else {
            activeController?.stopForSuspension()
        }
    }

    private func session() async throws -> ExtensionP2pClient {
        if let client { return client }
        let nextController = try ExtensionP2pClientController()
        controller = nextController
        do {
            let nextClient = try await ExtensionSyncExecutor.run {
                try ExtensionP2pClient(controller: nextController)
            }
            guard controller === nextController, !Task.isCancelled else {
                nextClient.shutdown()
                throw CancellationError()
            }
            client = nextClient
            return nextClient
        } catch {
            if controller === nextController { controller = nil }
            nextController.stopForSuspension()
            throw error
        }
    }
}

enum ExtensionSyncRouter {
    private static let outboundDeliveryTimeoutMs: UInt64 = 5 * 60 * 1_000

    @MainActor
    static func makeTransport(settings: AppSettings, store: SettingsStore) -> any KeyboardSyncTransport {
        switch settings.syncChannel {
        case .lan: return KeyboardLanSyncTransport(store: store)
        case .p2p: return KeyboardP2pSyncTransport()
        }
    }

    static func synchronizeP2pSnapshot(
        _ snapshot: DeviceClipboardSnapshot?,
        using client: ExtensionP2pClient
    ) throws -> ExtensionSyncResult {
        let send: (() throws -> SendReport)?
        guard let snapshot else {
            return try client.synchronize(receiveTimeoutMs: 0, send: nil)
        }
        switch snapshot.clipboard.type {
        case .text:
            let text = snapshot.payload.flatMap { String(data: $0, encoding: .utf8) }
                ?? snapshot.clipboard.text
            send = { try client.sendText(text, targetDevices: []) }
        case .image:
            guard let bytes = snapshot.payload else {
                return try client.synchronize(send: nil)
            }
            send = {
                try client.sendImage(
                    bytes,
                    mimeType: imageMimeType(for: snapshot.clipboard.dataName),
                    targetDevices: []
                )
            }
        case .file, .group:
            send = nil
        }
        return try client.synchronize(receiveTimeoutMs: 0, send: send)
    }

    static func sendText(
        _ text: String,
        targetDevices: [String],
        progress: @escaping (ExtensionSendProgress) -> Void = { _ in },
        onPeerRefresh: @escaping (ExtensionPeerRefreshReport) -> Void = { _ in },
        onDelivery: @escaping (ExtensionDeliveryReport) -> Void = { _ in }
    ) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        let delivery = try requireDelivered(
            client.synchronize(
                receiveTimeoutMs: 0,
                progress: progress,
                onPeerRefresh: onPeerRefresh
            ) {
                try client.sendText(text, targetDevices: targetDevices)
            }
        )
        onDelivery(delivery)
        progress(.sent)
    }

    static func sendImage(
        _ bytes: Data,
        ext: String,
        targetDevices: [String],
        progress: @escaping (ExtensionSendProgress) -> Void = { _ in },
        onPeerRefresh: @escaping (ExtensionPeerRefreshReport) -> Void = { _ in },
        onDelivery: @escaping (ExtensionDeliveryReport) -> Void = { _ in },
        onTransferProgress: @escaping (ExtensionTransferProgress) -> Void = { _ in }
    ) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        let delivery = try requireDelivered(
            client.synchronize(
                receiveTimeoutMs: 0,
                progress: progress,
                onPeerRefresh: onPeerRefresh
            ) {
                try client.sendImage(
                    bytes,
                    mimeType: imageMimeType(for: ext),
                    targetDevices: targetDevices
                )
            }
        )
        onDelivery(delivery)
        guard ExtensionOutboundDeliveryPolicy.requiresRemoteDownloadForImage(byteCount: bytes.count)
        else {
            progress(.sent)
            return
        }
        try waitForDelivery(
            delivery,
            using: client,
            targetDeviceIds: targetDevices,
            onTransferProgress: onTransferProgress
        )
        progress(.sent)
    }

    static func sendFile(
        _ url: URL,
        displayName: String,
        targetDevices: [String],
        progress: @escaping (ExtensionSendProgress) -> Void = { _ in },
        onPeerRefresh: @escaping (ExtensionPeerRefreshReport) -> Void = { _ in },
        onDelivery: @escaping (ExtensionDeliveryReport) -> Void = { _ in },
        onTransferProgress: @escaping (ExtensionTransferProgress) -> Void = { _ in }
    ) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        let delivery = try requireDelivered(
            client.synchronize(
                receiveTimeoutMs: 0,
                progress: progress,
                onPeerRefresh: onPeerRefresh
            ) {
                try client.sendFile(
                    url,
                    displayName: displayName,
                    targetDevices: targetDevices
                )
            }
        )
        onDelivery(delivery)
        try waitForDelivery(
            delivery,
            using: client,
            targetDeviceIds: targetDevices,
            onTransferProgress: onTransferProgress
        )
        progress(.sent)
    }

    private static func waitForDelivery(
        _ delivery: ExtensionDeliveryReport,
        using client: ExtensionP2pClient,
        targetDeviceIds: [String],
        onTransferProgress: @escaping (ExtensionTransferProgress) -> Void
    ) throws {
        try client.waitForOutboundDelivery(
            entryId: delivery.entryId,
            expectedReceiverCount: delivery.accepted + delivery.duplicate + delivery.pending,
            timeoutMs: outboundDeliveryTimeoutMs,
            targetDeviceIds: targetDeviceIds,
            onTransferProgress: onTransferProgress
        )
    }

    private static func requireDelivered(_ result: ExtensionSyncResult) throws -> ExtensionDeliveryReport {
        guard let delivery = result.delivery else {
            throw ExtensionP2pError.deliveryIncomplete(.failed)
        }
        guard delivery.state == .delivered else {
            throw ExtensionP2pError.deliveryIncomplete(delivery.state)
        }
        return delivery
    }

    private static func imageMimeType(for source: String?) -> String {
        let ext = (source as NSString?)?.pathExtension.lowercased() ?? source?.lowercased() ?? ""
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "heic", "heif": return "image/heic"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        default: return "image/png"
        }
    }
}
