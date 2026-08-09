import Foundation

#if canImport(UcEngineCore)
internal import UcEngineCore
#endif

/// Coarse, privacy-safe categories for recipient-loading failures in the
/// Share Extension. Only the raw value is ever logged or persisted; it
/// intentionally carries no recipient, device, address, content, path, or
/// token information.
enum RecipientLoadErrorCategory: String, Equatable {
    case runtimeBusy = "runtime_busy"
    case sharedStoreUnavailable = "shared_store_unavailable"
    case spaceUnavailable = "space_unavailable"
    case other = "other"
}

enum RecipientLoadErrorPresentation {
    /// Maps a recipient-loading failure to a coarse category. Any error that
    /// is not a recognized `ExtensionP2pError` collapses to `.other`.
    static func category(for error: Error) -> RecipientLoadErrorCategory {
#if canImport(UcEngineCore)
        if let p2pError = error as? ExtensionP2pError {
            switch p2pError {
            case .runtimeBusy: return .runtimeBusy
            case .sharedStoreUnavailable: return .sharedStoreUnavailable
            case .spaceUnavailable: return .spaceUnavailable
            case .sessionClosed, .deliveryIncomplete: return .other
            }
        }
#endif
        return .other
    }

    /// Localization key for the user-visible message. The generic message
    /// remains the fallback for unknown categories; known categories get an
    /// actionable message instead of hiding the cause.
    static func messageKey(for category: RecipientLoadErrorCategory) -> String {
        switch category {
        case .runtimeBusy:
            return "主程序正在同步，请稍后重试"
        case .sharedStoreUnavailable:
            return "请先打开 UniClip 主程序完成设置"
        case .spaceUnavailable:
            return "尚未加入空间，请先打开 UniClip 主程序加入"
        case .other:
            return "无法读取接收设备"
        }
    }
}
