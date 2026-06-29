import Foundation

public extension SettingsStore {
    static let legacyAppGroupID = "group.app.uniclipboard.ios"

    private static var legacyMigrationSentinel: String {
        ".app_group_store_migrated"
    }

    static func migrateLegacyContainer() -> (migrated: Bool, keys: Int) {
        let fm = FileManager.default
        guard let newURL = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) else {
            return (false, 0)
        }

        let sentinel = newURL.appendingPathComponent(legacyMigrationSentinel, isDirectory: false)
        if fm.fileExists(atPath: sentinel.path) {
            return (false, 0)
        }

        var copied = 0
        if let oldURL = fm.containerURL(forSecurityApplicationGroupIdentifier: legacyAppGroupID),
           oldURL.path != newURL.path,
           let contents = try? fm.contentsOfDirectory(
               at: oldURL,
               includingPropertiesForKeys: nil,
               options: [.skipsHiddenFiles]
           ) {
            try? fm.createDirectory(at: newURL, withIntermediateDirectories: true)
            for source in contents {
                let destination = newURL.appendingPathComponent(source.lastPathComponent)
                if fm.fileExists(atPath: destination.path) { continue }
                do {
                    try fm.copyItem(at: source, to: destination)
                    copied += 1
                } catch {
                    continue
                }
            }
        }

        let newDefaults = UserDefaults(suiteName: appGroupID)
        let oldDefaults = UserDefaults(suiteName: legacyAppGroupID)
        for key in legacyMigrationKeys {
            guard newDefaults?.object(forKey: key) == nil,
                  let value = oldDefaults?.object(forKey: key) else {
                continue
            }
            newDefaults?.set(value, forKey: key)
            copied += 1
        }

        try? Data().write(to: sentinel, options: [.atomic])
        return (copied > 0, copied)
    }

    private static var legacyMigrationKeys: [String] {
        [
            AppSettings.PersistenceKey.serverConfigList,
            AppSettings.PersistenceKey.appSettings,
            AppSettings.PersistenceKey.legacyServerConfig,
            AppSettings.PersistenceKey.lastSyncedContentHash,
            AppSettings.PersistenceKey.clipboardHistory,
            AppSettings.PersistenceKey.historyModifiedAfter,
            AppSettings.PersistenceKey.lastHistorySyncAt,
            AppSettings.PersistenceKey.keyboardExtensionEnabled,
            AppSettings.PersistenceKey.keyboardExtensionFullAccess,
            AppSettings.PersistenceKey.lastSyncedChangeCount,
        ]
    }
}
