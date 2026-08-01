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
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription {
            return description
        }
        return localization.string("同步失败")
    }
}
