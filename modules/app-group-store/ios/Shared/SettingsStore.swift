import Foundation
#if canImport(AppGroupStore)
import class AppGroupStore.SharedStorageAccess
#elseif canImport(SharedStorageAccess)
import SharedStorageAccess
#endif

import OSLog

private let log = Logger(subsystem: "app.uniclipboard", category: "store")

/// Persists extension settings and local history under the keys defined in
/// `AppSettings.PersistenceKey`.
///
/// Pure Foundation — lives in the SwiftPM `Models` target so it can be
/// unit-tested via `swift test`.
///
/// Corruption policy: if a stored JSON blob fails to decode, the store
/// returns the type's default ( empty list / `AppSettings.defaults`). This
/// matches the forward-compat philosophy of `AppSettings.init(from:)` —
/// stored data must never block app startup.
public final class SettingsStore: @unchecked Sendable {
    /// App Group container shared between the main app and app extensions.
    /// The main app receives the value through Info.plist; extensions derive
    /// it from their own bundle identifier so dev/prod installs stay isolated
    /// without hardcoding the production container.
    public static var appGroupID: String {
        infoPlistAppGroupID ?? bundleDerivedAppGroupID ?? defaultAppGroupID
    }

    private static let defaultAppGroupID = "group.app.uniclipboard.UniClipboard"
    private static let appBundleIDPrefix = "app.uniclipboard.UniClipboard"
    private static let extensionBundleSuffixes = [".Share", ".Keyboard"]

    private static var infoPlistAppGroupID: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "UCAppGroupIdentifier") as? String else {
            return nil
        }
        return normalizeAppGroupID(raw)
    }

    private static var bundleDerivedAppGroupID: String? {
        guard var bundleID = Bundle.main.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              bundleID.hasPrefix(appBundleIDPrefix) else {
            return nil
        }
        for suffix in extensionBundleSuffixes where bundleID.hasSuffix(suffix) {
            bundleID.removeLast(suffix.count)
            break
        }
        return normalizeAppGroupID("group.\(bundleID)")
    }

    private static func normalizeAppGroupID(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value.contains("$(") ? nil : value
    }

    static let legacyLanFilenames = [
        "last_synced_hash",
        "last_synced_content_id",
        "last_known_ssid",
        "live_urls",
    ]

    private static let legacyLanDefaultsKeys = [
        "server_config_list",
        "server_config",
        "last_synced_content_hash",
        "history_modified_after",
        "last_history_sync_at",
    ]

    static let legacyAppGroupIDs = ["group.app.uniclipboard.ios"]

    private let migrationLock = NSLock()
    private var migrationPending = false
    private let defaults: UserDefaults
    private let containerURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// - Parameters:
    ///   - defaults: when nil (the default), the store opens the App Group
    ///     suite (`appGroupID`) and one-shot-migrates any existing keys
    ///     from `.standard` on first use. Falls back to `.standard` if the
    ///     App Group entitlement isn't active. Tests pass an explicit
    ///     ephemeral `UserDefaults(suiteName:)`.
    ///   - containerURL: directory holding file-backed state (currently
    ///     just `last_synced_hash`). When nil, resolves to the App Group
    ///     container URL. Tests inject a unique tmp dir so file state is
    ///     isolated per case.
    public init(defaults: UserDefaults? = nil, containerURL: URL? = nil) {
        let chosenDefaults: UserDefaults
        var needsMigration = false
        if let defaults {
            chosenDefaults = defaults
        } else if let suite = UserDefaults(suiteName: SettingsStore.appGroupID) {
            needsMigration = (try? SharedStorageAccess.shared.withAccess { !SettingsStore.migrateFromStandardIfNeeded(into: suite) }) ?? true
            chosenDefaults = suite
        } else {
            chosenDefaults = .standard
        }
        self.defaults = chosenDefaults

        let chosenContainer: URL
        if let containerURL {
            chosenContainer = containerURL
        } else if let groupURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ) {
            chosenContainer = groupURL
        } else {
            // No App Group entitlement (SwiftPM test harness, ad-hoc CLI).
            // A unique tmp dir keeps file state isolated and disposable —
            // any consumer that lacks the entitlement is by definition not
            // sharing state with another process, so process-uniqueness
            // matches what they get from `.standard` UserDefaults above.
            chosenContainer = FileManager.default.temporaryDirectory
                .appendingPathComponent("UniClipboardStore-\(UUID().uuidString)", isDirectory: true)
        }
        _ = try? SharedStorageAccess.shared.withAccess {
            try FileManager.default.createDirectory(at: chosenContainer, withIntermediateDirectories: true)
        }
        self.containerURL = chosenContainer
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.migrationPending = needsMigration

    }

    /// Copies each missing `.standard` key into the App Group independently.
    /// Existing destination values win; a failed write leaves its source key
    /// intact so the next store initialization can retry the remaining keys.
    private static func migrateFromStandardIfNeeded(into suite: UserDefaults) -> Bool {
        let keys = [
            AppSettings.PersistenceKey.appSettings,
            AppSettings.PersistenceKey.clipboardHistory,
            AppSettings.PersistenceKey.keyboardExtensionEnabled,
            AppSettings.PersistenceKey.keyboardExtensionFullAccess,
            AppSettings.PersistenceKey.lastSyncedChangeCount,
        ]
        let standard = UserDefaults.standard
        do {
            let migrated = try LegacyDefaultsMigrator.migrate(
                source: standard,
                destination: suite,
                keys: keys,
                removeSourceAfterCopy: true
            )
            if migrated > 0 {
                log.info("migrateFromStandardIfNeeded: moved \(migrated, privacy: .public) keys from .standard to the App Group suite")
            }
            return true
        } catch {
            log.error("migrateFromStandardIfNeeded: deferred remaining keys after a write failure")
            return false
        }
    }

    /// Retry only within an admitted operation. A partial write keeps the retry owned.
    private func finishDefaultsMigrationIfNeeded() {
        migrationLock.withLock {
            guard migrationPending else { return }
            migrationPending = !Self.migrateFromStandardIfNeeded(into: defaults)
        }
    }

    /// Removes obsolete server credentials and routing state from every
    /// container used by previous app versions. Safe to call on every launch.
    public static func clearLegacyLanConfiguration() throws {
        let defaultsStores = [UserDefaults.standard]
            + ([appGroupID] + legacyAppGroupIDs).compactMap(UserDefaults.init(suiteName:))

        for store in defaultsStores {
            sanitizeAppSettings(in: store)
        }

        let fileManager = FileManager.default
        let containers = ([appGroupID] + legacyAppGroupIDs).compactMap { groupID in
            fileManager.containerURL(
                forSecurityApplicationGroupIdentifier: groupID
            )
        }
        try LegacyLanCleaner.clean(
            defaultsStores: defaultsStores,
            defaultsKeys: legacyLanDefaultsKeys,
            containerDirectories: containers,
            filenames: legacyLanFilenames,
            fileManager: fileManager
        )
    }

    private static func sanitizeAppSettings(in defaults: UserDefaults) {
        let key = AppSettings.PersistenceKey.appSettings
        guard let data = defaults.data(forKey: key),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        object.removeValue(forKey: "trustInsecureCert")
        guard let sanitized = try? JSONSerialization.data(withJSONObject: object) else { return }
        defaults.set(sanitized, forKey: key)
    }

    // MARK: - AppSettings

    public func loadAppSettings() -> AppSettings {
        (try? SharedStorageAccess.shared.withAccess {
            finishDefaultsMigrationIfNeeded()
            defaults.synchronize()
            guard let data = defaults.data(forKey: AppSettings.PersistenceKey.appSettings) else {
                return .defaults
            }
            if let settings = try? decoder.decode(AppSettings.self, from: data) {
                return settings
            }
            log.fault("loadAppSettings: app_settings blob (\(data.count, privacy: .public) bytes) failed to decode — using defaults")
            return .defaults
        }) ?? .defaults
    }

    public func saveAppSettings(_ settings: AppSettings) {
        try? saveAppSettingsOrThrow(settings)
    }

    /// Propagates admission and encoding errors to callers that require persistence.
    public func saveAppSettingsOrThrow(_ settings: AppSettings) throws {
        try SharedStorageAccess.shared.withAccess {
            finishDefaultsMigrationIfNeeded()
            let data = try encoder.encode(settings)
            defaults.set(data, forKey: AppSettings.PersistenceKey.appSettings)
            defaults.synchronize()
        }
    }

    // MARK: - Clipboard history (cycle 11)

    /// Load the persisted clipboard observation log. Returns `[]` on cold
    /// launch or when the stored JSON fails to decode (forward-compat with
    /// the rest of the store's corruption policy — never block startup on
    /// a bad blob).
    public func loadHistory() -> [ClipboardHistoryItem] {
        (try? SharedStorageAccess.shared.withAccess { loadHistoryAdmitted() }) ?? []
    }

    private func loadHistoryAdmitted() -> [ClipboardHistoryItem] {
        finishDefaultsMigrationIfNeeded()
        guard let data = defaults.data(forKey: AppSettings.PersistenceKey.clipboardHistory) else {
            return []
        }
        return (try? decoder.decode([ClipboardHistoryItem].self, from: data)) ?? []
    }

    /// Persist the clipboard observation log. Callers cap the size before
    /// calling — this method writes whatever it's handed. An empty array
    /// is still encoded (rather than removing the key) so a subsequent
    /// load round-trips to `[]` and the corruption fallback never fires.
    public func saveHistory(_ items: [ClipboardHistoryItem]) {
        _ = try? SharedStorageAccess.shared.withAccess { saveHistoryAdmitted(items) }
    }

    private func saveHistoryAdmitted(_ items: [ClipboardHistoryItem]) {
        finishDefaultsMigrationIfNeeded()
        guard let data = try? encoder.encode(items) else { return }
        defaults.set(data, forKey: AppSettings.PersistenceKey.clipboardHistory)
    }

    /// Append one observation to the shared history log (App Group),
    /// newest-first, deduped against the most-recent same-direction+hash
    /// entry, and capped. Mirrors `AppViewModel.appendHistory` so an
    /// extension (keyboard / share) that pushes or applies content while the
    /// main app is suspended still lands a row the user will see — the app
    /// reconciles the on-disk log on its next foreground.
    ///
    /// Process-safety is load-modify-save (last writer wins). Only one
    /// extension runs at a time and the host app is suspended while a
    /// keyboard runs in another app, so concurrent writers are not a
    /// practical concern on iPhone; the app's foreground merge covers the
    /// iPad-multitasking edge.
    public func appendHistory(
        entry: Clipboard,
        direction: ClipboardHistoryItem.Direction,
        at timestamp: Date = Date(),
        cap: Int = 200
    ) {
        _ = try? SharedStorageAccess.shared.withAccess {
            var items = loadHistoryAdmitted()
            // Same content already at the head → never insert a duplicate row,
            // regardless of direction. Upgrade `.local` provenance to
            // pushed/pulled in place; keep the stronger direction otherwise.
            if let hash = entry.hash,
               let last = items.first,
               last.entry.hash == hash {
                if direction != .local, last.direction != direction {
                    items[0].direction = direction
                    saveHistoryAdmitted(items)
                }
                return
            }
            items.insert(
                ClipboardHistoryItem(entry: entry, timestamp: timestamp, direction: direction),
                at: 0
            )
            if items.count > cap { items = Array(items.prefix(cap)) }
            saveHistoryAdmitted(items)
        }
    }

    /// Move the history item with `id` to the head of the log by stamping
    /// its timestamp to now. Used by keyboard tap-to-copy so the row
    /// surfaces first (matching the main app's reapply semantics) and the
    /// uplink's "already at head?" dedup recognizes the copied entry.
    public func touchHistoryItem(id: UUID) {
        _ = try? SharedStorageAccess.shared.withAccess {
            var items = loadHistoryAdmitted()
            guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
            var item = items.remove(at: idx)
            item.timestamp = Date()
            items.insert(item, at: 0)
            saveHistoryAdmitted(items)
        }
    }

    // MARK: - Pasteboard change-count watermark (keyboard uplink)

    /// The `UIPasteboard.changeCount` the keyboard last synced. Lets the
    /// keyboard's uplink skip the *content* read (which fires iOS's
    /// "允许粘贴" prompt) when nothing has been copied since — reading
    /// `changeCount` itself is free and never prompts. `nil` on cold start.
    public func loadLastSyncedChangeCount() -> Int? {
        (try? SharedStorageAccess.shared.withAccess {
            finishDefaultsMigrationIfNeeded()
            return defaults.object(forKey: AppSettings.PersistenceKey.lastSyncedChangeCount) as? Int
        }) ?? nil
    }

    public func saveLastSyncedChangeCount(_ value: Int) {
        _ = try? SharedStorageAccess.shared.withAccess {
            finishDefaultsMigrationIfNeeded()
            defaults.set(value, forKey: AppSettings.PersistenceKey.lastSyncedChangeCount)
        }
    }

    // MARK: - Image data cache (App Group, shared with keyboard)

    private var imageCacheDir: URL {
        containerURL.appendingPathComponent("ImageData", isDirectory: true)
    }

    public func loadImageData(hash: String) -> Data? {
        (try? SharedStorageAccess.shared.withAccess {
            let file = imageCacheDir.appendingPathComponent("\(hash.uppercased()).dat")
            return try? Data(contentsOf: file)
        }) ?? nil
    }

    public func saveImageData(hash: String, data: Data) {
        _ = try? SharedStorageAccess.shared.withAccess {
            try? FileManager.default.createDirectory(at: imageCacheDir, withIntermediateDirectories: true)
            let file = imageCacheDir.appendingPathComponent("\(hash.uppercased()).dat")
            try? data.write(to: file, options: .atomic)
        }
    }

}
