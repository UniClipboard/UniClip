import Foundation

/// Resolves extension-owned strings using the language selected in UniClip.
/// The `system` sentinel intentionally uses the host's autoupdating locale.
struct ExtensionLocalization: Equatable {
    let locale: Locale
    let bundle: Bundle

    init(preference: String = "system", rootBundle: Bundle = .main) {
        let languageIdentifier: String?
        switch preference {
        case "zh-CN": languageIdentifier = "zh-Hans"
        case "en": languageIdentifier = "en"
        case "ru": languageIdentifier = "ru"
        case "pt-BR": languageIdentifier = "pt-BR"
        default: languageIdentifier = nil
        }

        if let languageIdentifier,
           let path = rootBundle.path(forResource: languageIdentifier, ofType: "lproj"),
           let localizedBundle = Bundle(path: path) {
            locale = Locale(identifier: languageIdentifier)
            bundle = localizedBundle
        } else {
            locale = .autoupdatingCurrent
            bundle = rootBundle
        }
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.locale.identifier == rhs.locale.identifier
            && lhs.bundle.bundlePath == rhs.bundle.bundlePath
    }

    func string(_ key: String, _ arguments: CVarArg...) -> String {
        let format = bundle.localizedString(forKey: key, value: key, table: nil)
        guard !arguments.isEmpty else { return format }
        return String(format: format, locale: locale, arguments: arguments)
    }

    func byteCount(_ count: Int) -> String {
        Int64(count).formatted(.byteCount(style: .file).locale(locale))
    }
}
