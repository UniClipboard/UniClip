import Foundation
internal import UcEngineCore

/// The extension-side counterpart of the main app's selected transport. There
/// is deliberately no fallback: choosing P2P never sends a server request.
enum ExtensionSyncChannel {
    case p2p
    case lan

    init(settings: AppSettings) {
        self = settings.syncChannel == .p2p ? .p2p : .lan
    }
}

enum ExtensionSyncRouter {
    private static let outboundDeliveryTimeoutMs: UInt64 = 5 * 60 * 1_000

    static func channel(settings: AppSettings) -> ExtensionSyncChannel {
        ExtensionSyncChannel(settings: settings)
    }

    static func synchronizeKeyboardSnapshot(
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
            send = { try client.sendText(text) }
        case .image:
            guard let bytes = snapshot.payload else {
                return try client.synchronize(send: nil)
            }
            send = {
                try client.sendImage(
                    bytes,
                    mimeType: imageMimeType(for: snapshot.clipboard.dataName)
                )
            }
        case .file, .group:
            send = nil
        }
        return try client.synchronize(receiveTimeoutMs: 0, send: send)
    }

    static func sendText(_ text: String) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        _ = try requireDelivered(
            client.synchronize(receiveTimeoutMs: 0) { try client.sendText(text) }
        )
    }

    static func sendImage(_ bytes: Data, ext: String) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        let delivery = try requireDelivered(
            client.synchronize(receiveTimeoutMs: 0) {
                try client.sendImage(bytes, mimeType: imageMimeType(for: ext))
            }
        )
        guard ExtensionOutboundDeliveryPolicy.requiresRemoteDownloadForImage(byteCount: bytes.count)
        else { return }
        try client.waitForOutboundDelivery(
            entryId: delivery.entryId,
            expectedReceiverCount: delivery.accepted,
            timeoutMs: outboundDeliveryTimeoutMs
        )
    }

    static func sendFile(_ url: URL, displayName: String) throws {
        let client = try ExtensionP2pClient()
        defer { client.shutdown() }
        let delivery = try requireDelivered(
            client.synchronize(receiveTimeoutMs: 0) {
                try client.sendFile(url, displayName: displayName)
            }
        )
        try client.waitForOutboundDelivery(
            entryId: delivery.entryId,
            expectedReceiverCount: delivery.accepted,
            timeoutMs: outboundDeliveryTimeoutMs
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
