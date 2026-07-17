import Foundation

extension KeyboardModel {
    func textCountText(_ count: Int) -> String {
        localization.string("%lld 字", Int64(count))
    }

    func imageSizeText(byteCount: Int) -> String {
        guard byteCount > 0 else { return "" }
        return localization.byteCount(byteCount)
    }

    /// "刚刚" inside ±5s, else the system relative formatter.
    func relativeShort(_ date: Date) -> String {
        if abs(date.timeIntervalSinceNow) < 5 { return localization.string("刚刚") }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = localization.locale
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    func message(for error: Error) -> String {
        if let syncError = error as? SyncError { return message(for: syncError) }
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription {
            return description
        }
        return localization.string("同步失败")
    }

    /// User-facing copy for `SyncError`. Mirrors the main app's intent errors.
    func message(for error: SyncError) -> String {
        switch error.kind {
        case .authFailed: return localization.string("认证失败 — 请检查用户名和密码")
        case .connectTimeout: return localization.string("连接超时 — 请检查服务器地址")
        case .receiveTimeout: return localization.string("接收超时 — 请稍后重试")
        case .networkUnreachable: return localization.string("无法连接 — 请检查网络和 URL")
        case .invalidURL: return localization.string("服务器地址无效")
        case .decodingFailed: return localization.string("服务器返回的数据无法解析")
        case .protocolError(let code):
            return localization.string("服务器返回 HTTP %lld", Int64(code))
        case .serverError(let code):
            return localization.string("服务器错误 %lld", Int64(code))
        case .notFound: return localization.string("服务器尚未发布剪贴板")
        case .hashMismatch: return localization.string("内容校验失败 — 文件可能损坏")
        case .cancelled: return localization.string("请求已取消")
        }
    }
}
