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
        var copied = 0
        if let oldURL = fm.containerURL(forSecurityApplicationGroupIdentifier: legacyAppGroupID),
           oldURL.path != newURL.path {
            copied += copyMissingItems(from: oldURL, to: newURL, fileManager: fm)
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

    private static func copyMissingItems(
        from sourceDirectory: URL,
        to destinationDirectory: URL,
        fileManager fm: FileManager
    ) -> Int {
        guard let contents = try? fm.contentsOfDirectory(
            at: sourceDirectory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return 0
        }

        try? fm.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)

        var copied = 0
        for source in contents {
            let destination = destinationDirectory.appendingPathComponent(source.lastPathComponent)
            let isDirectory = (try? source.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false

            if isDirectory {
                copied += copyMissingItems(from: source, to: destination, fileManager: fm)
                continue
            }

            if fm.fileExists(atPath: destination.path) { continue }

            do {
                try fm.copyItem(at: source, to: destination)
                copied += 1
            } catch {
                continue
            }
        }

        return copied
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
