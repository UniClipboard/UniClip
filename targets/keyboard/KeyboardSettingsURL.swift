import Foundation
import UIKit

enum KeyboardSettingsURL {
    static var destination: URL? {
        if #available(iOS 18.0, *),
           let extensionIdentifier = Bundle.main.bundleIdentifier,
           extensionIdentifier.hasSuffix(".Keyboard") {
            let appIdentifier = extensionIdentifier.dropLast(".Keyboard".count)
            // app-settings: resolves against the extension bundle. App-prefs:
            // can select its container, but remains an undocumented Settings
            // route, so retain the public fallback for older system versions.
            return URL(string: "App-prefs:\(appIdentifier)")
        }

        return URL(string: UIApplication.openSettingsURLString)
    }
}
