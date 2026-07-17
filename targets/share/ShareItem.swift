import Foundation
import UniformTypeIdentifiers
import UIKit

/// What we actually push to the server, after extracting one attachment
/// from the system share sheet. Mirrors the three publish paths on
/// `Clipboard`: `publishText`, `publishImage`, `publishFile`.
enum ShareItem: Equatable {
    case text(String)
    case image(Data, ext: String)
    case file(name: String, bytes: Data)

    var displayName: String {
        switch self {
        case .text(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count <= 80 { return trimmed }
            return String(trimmed.prefix(80)) + "…"
        case .image(_, let ext):  return "image.\(ext)"
        case .file(let name, _):  return name
        }
    }

    var byteCount: Int {
        switch self {
        case .text(let text):           return text.utf8.count
        case .image(let data, _):        return data.count
        case .file(_, let bytes):        return bytes.count
        }
    }

    /// Content-free case name for logging/telemetry — never the payload.
    var kindLabel: String {
        switch self {
        case .text:  return "text"
        case .image: return "image"
        case .file:  return "file"
        }
    }
}

/// Pulls one `ShareItem` out of the system share sheet attachments. Tries
/// type identifiers in priority order: URL > text > image > file. The
/// system already filtered to types declared in our `NSExtensionActivationRule`,
/// so the failure mode here is "the source app advertised a UTI it can't
/// fulfill" which we surface to the user as `.noUsableAttachment`.
enum ShareItemError: Error, LocalizedError {
    case noInputItems
    case noUsableAttachment
    case loadFailed(String)

    var errorDescription: String? {
        message(using: ExtensionLocalization())
    }

    func message(using localization: ExtensionLocalization) -> String {
        switch self {
        case .noInputItems:
            return localization.string("没有可分享的内容")
        case .noUsableAttachment:
            return localization.string("暂不支持这种内容")
        case .loadFailed(let reason):
            return localization.string("读取分享内容失败: %@", reason)
        }
    }
}

enum ShareItemExtractor {
    static func extract(from ctx: ShareExtensionContext) async throws -> ShareItem {
        let providers = ctx.inputItems.flatMap { $0.attachments ?? [] }
        guard !providers.isEmpty else { throw ShareItemError.noInputItems }

        // Priority 1 — public.url: Safari "share this page", Mail attachments
        // (often surfaced as file-url), etc. URL-shaped sharing is by far
        // the highest-signal text on iOS.
        for provider in providers
        where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try await loadURL(provider) {
                if url.isFileURL {
                    return try await readFileURL(url)
                }
                return .text(url.absoluteString)
            }
        }

        // Priority 2 — plain text. `public.plain-text` is the most common;
        // `public.text` is a parent UTI that some apps register.
        for provider in providers {
            for uti in [UTType.plainText.identifier, UTType.text.identifier]
            where provider.hasItemConformingToTypeIdentifier(uti) {
                if let text = try await loadString(provider, uti: uti) {
                    return .text(text)
                }
            }
        }

        // Priority 3 — image. Photos: HEIC. Screenshots / web: PNG. Old
        // photos / random apps: JPEG. GIF is rare. We probe in this order.
        for provider in providers {
            for (uti, ext) in [
                (UTType.png.identifier,  "png"),
                (UTType.heic.identifier, "heic"),
                (UTType.jpeg.identifier, "jpg"),
                (UTType.gif.identifier,  "gif"),
            ] where provider.hasItemConformingToTypeIdentifier(uti) {
                if let bytes = try await loadBytes(provider, uti: uti) {
                    return .image(bytes, ext: ext)
                }
            }
            // Fallback: any image UTI we didn't explicitly probe — load as
            // PNG (most-decodable fallback ext).
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let bytes = try await loadBytes(provider, uti: UTType.image.identifier) {
                    return .image(bytes, ext: "png")
                }
            }
        }

        // Priority 4 — arbitrary file via Files-app share.
        for provider in providers {
            for uti in [UTType.fileURL.identifier, UTType.data.identifier]
            where provider.hasItemConformingToTypeIdentifier(uti) {
                if let url = try await loadURL(provider), url.isFileURL {
                    return try await readFileURL(url)
                }
                if let bytes = try await loadBytes(provider, uti: uti) {
                    let suggestedName = provider.suggestedName ?? "file"
                    return .file(name: suggestedName, bytes: bytes)
                }
            }
        }

        throw ShareItemError.noUsableAttachment
    }

    // MARK: - NSItemProvider async wrappers

    private static func loadURL(_ provider: NSItemProvider) async throws -> URL? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { value, err in
                if let err { continuation.resume(throwing: ShareItemError.loadFailed("\(err)")); return }
                continuation.resume(returning: value as? URL)
            }
        }
    }

    private static func loadString(_ provider: NSItemProvider, uti: String) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: uti, options: nil) { value, err in
                if let err { continuation.resume(throwing: ShareItemError.loadFailed("\(err)")); return }
                if let text = value as? String { continuation.resume(returning: text); return }
                if let url = value as? URL, !url.isFileURL {
                    continuation.resume(returning: url.absoluteString); return
                }
                if let data = value as? Data, let text = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: text); return
                }
                continuation.resume(returning: nil)
            }
        }
    }

    /// Reads bytes for the requested UTI. The system delivers payloads two
    /// ways depending on the source — sometimes as a `URL` pointing into
    /// an extension-scoped temp dir (large images, files), sometimes as
    /// in-memory `Data`. We collapse both into bytes.
    private static func loadBytes(_ provider: NSItemProvider, uti: String) async throws -> Data? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: uti, options: nil) { value, err in
                if let err { continuation.resume(throwing: ShareItemError.loadFailed("\(err)")); return }
                if let data = value as? Data { continuation.resume(returning: data); return }
                if let url = value as? URL, url.isFileURL {
                    do {
                        let data = try Data(contentsOf: url)
                        continuation.resume(returning: data)
                    } catch {
                        continuation.resume(throwing: ShareItemError.loadFailed("\(error)"))
                    }
                    return
                }
                if let image = value as? UIImage, let data = image.pngData() {
                    continuation.resume(returning: data); return
                }
                continuation.resume(returning: nil)
            }
        }
    }

    private static func readFileURL(_ url: URL) async throws -> ShareItem {
        do {
            let bytes = try Data(contentsOf: url)
            let name = url.lastPathComponent
            // If it's an image extension, surface as image so the server
            // stores it under `Image` kind and the main app applies it to
            // the pasteboard. Otherwise it's a generic file.
            let ext = url.pathExtension.lowercased()
            if ["png", "jpg", "jpeg", "heic", "heif", "gif"].contains(ext) {
                let normalized = ext == "jpeg" ? "jpg" : (ext == "heif" ? "heic" : ext)
                return .image(bytes, ext: normalized)
            }
            return .file(name: name, bytes: bytes)
        } catch {
            throw ShareItemError.loadFailed("\(error)")
        }
    }
}
