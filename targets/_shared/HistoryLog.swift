import Foundation

/// The extensions' single entry point to clipboard history. Routes every
/// read/write to the shared App Group SQLite database (`HistoryDatabase`,
/// the same rows the RN app queries — single source of truth) and falls back
/// to the legacy App Group JSON log (`SettingsStore.loadHistory` et al.) only
/// while the shared DB isn't available yet — i.e. the main app hasn't
/// launched once since the update that moved the database into the container.
///
/// Fallback writes land in the JSON log; the app merges that log into the
/// database on every launch (deduped by profileHash, tombstones respected),
/// so nothing recorded during the fallback window is lost.
public final class HistoryLog {
    private let store: SettingsStore
    private let db: HistoryDatabase?

    public init(store: SettingsStore, containerURL: URL? = nil) {
        self.store = store
        self.db = HistoryDatabase(containerURL: containerURL)
    }

    /// True when reads/writes hit the shared database (diagnostics only).
    public var usesSharedDatabase: Bool { db != nil }

    /// Newest-first, tombstones excluded.
    public func loadRecent(limit: Int = 200) -> [ClipboardHistoryItem] {
        if let db { return db.loadRecent(limit: limit) }
        return Array(
            store.loadHistory()
                .sorted { $0.timestamp > $1.timestamp }
                .prefix(limit)
        )
    }

    /// Hash of the newest visible entry — the "already at head?" dedup guard.
    public func headHash() -> String? {
        if let db { return db.headHash() }
        return store.loadHistory().first?.entry.hash
    }

    /// Fold one observation in. Returns `false` when suppressed (tombstoned
    /// content arriving via `.pulled` — the user deleted it in the app).
    @discardableResult
    public func append(
        entry: Clipboard,
        direction: ClipboardHistoryItem.Direction,
        at now: Date = Date()
    ) -> Bool {
        if let db { return db.record(entry: entry, direction: direction, at: now) }
        store.appendHistory(entry: entry, direction: direction, at: now)
        return true
    }

    /// Surface an existing entry at the head (tap-to-copy / re-apply).
    /// `legacyID` addresses the JSON log's UUID rows on the fallback path.
    public func touch(hash: String?, legacyID: UUID, at now: Date = Date()) {
        if let db {
            guard let hash, !hash.isEmpty else { return }
            db.touch(profileHash: hash, at: now)
        } else {
            store.touchHistoryItem(id: legacyID)
        }
    }
}
