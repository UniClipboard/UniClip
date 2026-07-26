import Foundation
internal import UcEngine

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
    static func channel(settings: AppSettings) -> ExtensionSyncChannel {
        ExtensionSyncChannel(settings: settings)
    }

    static func sendKeyboardSnapshot(_ snapshot: DeviceClipboardSnapshot) throws {
        let client = try ExtensionP2pClient()
        switch snapshot.clipboard.type {
        case .text:
            let text = snapshot.payload.flatMap { String(data: $0, encoding: .utf8) }
                ?? snapshot.clipboard.text
            _ = try client.sendText(text)
        case .image:
            guard let bytes = snapshot.payload else { return }
            _ = try client.sendImage(bytes, mimeType: imageMimeType(for: snapshot.clipboard.dataName))
        case .file, .group:
            return
        }
    }

    static func sendText(_ text: String) throws {
        _ = try ExtensionP2pClient().sendText(text)
    }

    static func sendImage(_ bytes: Data, ext: String) throws {
        _ = try ExtensionP2pClient().sendImage(bytes, mimeType: imageMimeType(for: ext))
    }

    static func sendFile(_ url: URL, displayName: String) throws {
        _ = try ExtensionP2pClient().sendFile(url, displayName: displayName)
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
