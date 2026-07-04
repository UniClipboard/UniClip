import Foundation
import OSLog
import SQLite3

private let log = Logger(subsystem: "app.uniclipboard", category: "historydb")

/// `sqlite3_bind_text` must copy Swift string bytes (their lifetime ends at
/// the call boundary) — this is the canonical SQLITE_TRANSIENT destructor.
private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Direct reader/writer over the main app's clipboard-history SQLite database
/// (`<AppGroup>/Databases/uniclipboard.db`). Schema is owned by RN
/// (`src/services/db/database.ts`, `clipboard_history` v1); this class makes
/// that database the single source of truth on iOS — the app, keyboard, and
/// share extension all touch the same rows, so a delete in the app vanishes
/// from the keyboard, and the `isDeleted` tombstone stops a server pull from
/// resurrecting deleted content.
///
/// Ownership rules:
/// - The RN app CREATES and MIGRATES the database. This class opens
///   read-write WITHOUT `SQLITE_OPEN_CREATE`; if the file or table is missing
///   (app not launched yet after the update that moved the DB into the App
///   Group) the initializer fails and callers fall back to the legacy App
///   Group JSON log via `HistoryLog`.
/// - Future RN schema migrations must keep the v1 columns this class touches
///   (additive-only policy, documented next to `SCHEMA_VERSION`); the
///   canonical SELECT is validated at init so an incompatible schema degrades
///   to the JSON fallback instead of crashing mid-session.
///
/// Cross-process safety: WAL + `busy_timeout` on both sides. Reads never
/// block the app's writes; extension writes are single short statements.
public final class HistoryDatabase {
    public static let databaseSubdirectory = "Databases"
    public static let databaseFilename = "uniclipboard.db"

    private static let table = "clipboard_history"

    /// Columns of the canonical read, aligned with RN's `rowMapper.ts`.
    private static let readColumns = "profileHash, type, text, dataName, size, hasData, timestamp"

    private let db: OpaquePointer
    private let containerURL: URL

    /// Fails when the App Group container, database file, or expected table
    /// isn't there — callers must treat that as "shared DB not ready" and
    /// fall back to the legacy JSON log, never as an error to surface.
    public init?(containerURL: URL? = nil) {
        guard let base = containerURL ?? FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)
        else { return nil }

        let path = base
            .appendingPathComponent(Self.databaseSubdirectory, isDirectory: true)
            .appendingPathComponent(Self.databaseFilename)
            .path
        guard FileManager.default.fileExists(atPath: path) else { return nil }

        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK,
              let opened = handle
        else {
            log.error("open failed: \(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "nil handle")")
            sqlite3_close(handle)
            return nil
        }
        self.db = opened
        self.containerURL = base
        sqlite3_busy_timeout(opened, 3000)

        // Validate the canonical read against whatever schema version the
        // app last migrated to. Prepare failure ⇒ incompatible ⇒ fall back.
        var probe: OpaquePointer?
        let probeSQL = "SELECT \(Self.readColumns), isDeleted FROM \(Self.table) LIMIT 0"
        guard sqlite3_prepare_v2(opened, probeSQL, -1, &probe, nil) == SQLITE_OK else {
            log.warning("schema probe failed — falling back to legacy log: \(String(cString: sqlite3_errmsg(opened)))")
            return nil // deinit closes the handle
        }
        sqlite3_finalize(probe)
    }

    deinit { sqlite3_close(db) }

    // MARK: - Reads

    /// Newest-first, tombstones excluded. Metadata only — payload bytes stay
    /// on disk, so this is safe inside the keyboard's memory budget.
    public func loadRecent(limit: Int) -> [ClipboardHistoryItem] {
        let sql = """
        SELECT \(Self.readColumns) FROM \(Self.table)
        WHERE isDeleted = 0 ORDER BY timestamp DESC LIMIT ?
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("loadRecent prepare"); return []
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(limit))

        var items: [ClipboardHistoryItem] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard
                let hash = columnText(stmt, 0),
                let rawType = columnText(stmt, 1),
                let kind = Clipboard.Kind(rawValue: rawType)
            else { continue }
            let entry = Clipboard(
                type: kind,
                hash: hash,
                text: columnText(stmt, 2) ?? "",
                hasData: sqlite3_column_int(stmt, 5) != 0,
                dataName: columnText(stmt, 3),
                size: sqlite3_column_type(stmt, 4) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 4))
            )
            let ms = sqlite3_column_int64(stmt, 6)
            items.append(ClipboardHistoryItem(
                id: Self.stableUUID(fromHex: hash),
                entry: entry,
                timestamp: Date(timeIntervalSince1970: Double(ms) / 1000),
                // Direction isn't materialized in the table and no extension
                // UI reads it — placeholder keeps the shared model type.
                direction: .local
            ))
        }
        return items
    }

    /// Hash of the newest non-deleted row (the "already at head?" dedup the
    /// extensions run before appending).
    public func headHash() -> String? {
        let sql = "SELECT profileHash FROM \(Self.table) WHERE isDeleted = 0 ORDER BY timestamp DESC LIMIT 1"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("headHash prepare"); return nil
        }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return columnText(stmt, 0)
    }

    // MARK: - Writes

    /// Fold one observation into the shared table.
    ///
    /// - Existing row, tombstoned, `direction == .pulled`: the user deleted
    ///   this content in the app — respect the tombstone, do nothing. This is
    ///   the rule that stops server pulls from resurrecting deletions.
    /// - Existing row, any other case: surface it — undelete, bump the
    ///   timestamps (moves it to the head), mark synced for pushed/pulled.
    ///   A deliberate re-copy on this device (`.local`/`.pushed`) is a fresh
    ///   user intent and DOES override a tombstone.
    /// - No row: insert a full v1 row mirroring RN's `toRow()` defaults.
    ///
    /// Returns `false` when the tombstone suppressed the write.
    @discardableResult
    public func record(
        entry: Clipboard,
        direction: ClipboardHistoryItem.Direction,
        at now: Date = Date()
    ) -> Bool {
        guard let hash = entry.hash, !hash.isEmpty else { return false }

        switch existingState(profileHash: hash) {
        case .tombstoned where direction == .pulled:
            log.info("record: tombstone suppressed pulled \(hash.prefix(16))…")
            return false
        case .tombstoned, .present:
            return resurface(profileHash: hash, direction: direction, at: now)
        case .absent:
            return insert(entry: entry, hash: hash, direction: direction, at: now)
        }
    }

    /// Stamp a row to the head (tap-to-copy / re-apply from an extension).
    public func touch(profileHash: String, at now: Date = Date()) {
        let sql = "UPDATE \(Self.table) SET timestamp = ?, lastAccessed = ? WHERE profileHash = ?"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("touch prepare"); return
        }
        defer { sqlite3_finalize(stmt) }
        let ms = Self.epochMs(now)
        sqlite3_bind_int64(stmt, 1, ms)
        sqlite3_bind_int64(stmt, 2, ms)
        bindText(stmt, 3, profileHash)
        if sqlite3_step(stmt) != SQLITE_DONE { logError("touch step") }
    }

    // MARK: - Row state

    private enum RowState { case absent, present, tombstoned }

    private func existingState(profileHash: String) -> RowState {
        let sql = "SELECT isDeleted FROM \(Self.table) WHERE profileHash = ?"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("existingState prepare"); return .absent
        }
        defer { sqlite3_finalize(stmt) }
        bindText(stmt, 1, profileHash)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return .absent }
        return sqlite3_column_int(stmt, 0) != 0 ? .tombstoned : .present
    }

    private func resurface(
        profileHash: String,
        direction: ClipboardHistoryItem.Direction,
        at now: Date
    ) -> Bool {
        // syncStatus: pushed/pulled content is on the server (1 = Synced);
        // a plain local observation keeps whatever status the row had.
        let sql = """
        UPDATE \(Self.table) SET
          isDeleted = 0, timestamp = ?, lastAccessed = ?, lastModified = ?,
          syncStatus = CASE WHEN ? = 1 THEN 1 ELSE syncStatus END,
          "from" = CASE WHEN ? = 1 THEN 'server' ELSE "from" END
        WHERE profileHash = ?
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("resurface prepare"); return false
        }
        defer { sqlite3_finalize(stmt) }
        let ms = Self.epochMs(now)
        sqlite3_bind_int64(stmt, 1, ms)
        sqlite3_bind_int64(stmt, 2, ms)
        sqlite3_bind_int64(stmt, 3, ms)
        sqlite3_bind_int(stmt, 4, direction == .local ? 0 : 1)
        sqlite3_bind_int(stmt, 5, direction == .pulled ? 1 : 0)
        bindText(stmt, 6, profileHash)
        guard sqlite3_step(stmt) == SQLITE_DONE else { logError("resurface step"); return false }
        return true
    }

    private func insert(
        entry: Clipboard,
        hash: String,
        direction: ClipboardHistoryItem.Direction,
        at now: Date
    ) -> Bool {
        let sql = """
        INSERT OR REPLACE INTO \(Self.table)
          (profileHash, type, text, displayKind, dataName, size, fileUri,
           hasData, hasRemoteData, localClipboardHash, timestamp, lastAccessed,
           lastModified, useCount, starred, pinned, isDeleted, isLocalFileReady,
           syncStatus, version, "from", deviceName, synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0, ?, NULL, NULL)
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            logError("insert prepare"); return false
        }
        defer { sqlite3_finalize(stmt) }

        // Payload already in the App Group cache (share-extension uploads
        // write it there) → point the row straight at it, matching RN's
        // repairAppGroupPayloadUris. Metadata-only pulls have no local bytes.
        let payloadURL = entry.hasData ? payloadFileURL(type: entry.type, hash: hash) : nil

        let ms = Self.epochMs(now)
        bindText(stmt, 1, hash)
        bindText(stmt, 2, entry.type.rawValue)
        bindText(stmt, 3, entry.text)
        bindText(stmt, 4, Self.displayKind(for: entry))
        bindOptionalText(stmt, 5, entry.dataName)
        if let size = entry.size { sqlite3_bind_int64(stmt, 6, Int64(size)) } else { sqlite3_bind_null(stmt, 6) }
        bindOptionalText(stmt, 7, payloadURL?.absoluteString)
        sqlite3_bind_int(stmt, 8, entry.hasData ? 1 : 0)
        sqlite3_bind_int(stmt, 9, entry.hasData ? 1 : 0)
        sqlite3_bind_int64(stmt, 10, ms)
        sqlite3_bind_int64(stmt, 11, ms)
        sqlite3_bind_int64(stmt, 12, ms)
        sqlite3_bind_int(stmt, 13, entry.hasData ? (payloadURL != nil ? 1 : 0) : 1)
        sqlite3_bind_int(stmt, 14, direction == .local ? 0 : 1) // HistorySyncStatus: LocalOnly / Synced
        bindOptionalText(stmt, 15, direction == .pulled ? "server" : nil)

        guard sqlite3_step(stmt) == SQLITE_DONE else { logError("insert step"); return false }
        return true
    }

    // MARK: - Helpers

    /// `<AppGroup>/payloads/<Type>-<HASH>` — `PayloadCache`'s key scheme.
    /// Returns nil when no cached payload file exists.
    private func payloadFileURL(type: Clipboard.Kind, hash: String) -> URL? {
        let url = containerURL
            .appendingPathComponent("payloads", isDirectory: true)
            .appendingPathComponent("\(type.rawValue)-\(hash)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Mirrors RN's `getDisplayKind`: Text splits into url/text; the check
    /// approximates JS `new URL()` — single line, http(s), non-empty host.
    private static func displayKind(for entry: Clipboard) -> String {
        switch entry.type {
        case .image: return "image"
        case .file:  return "file"
        case .group: return "group"
        case .text:
            let trimmed = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.contains("\n"),
                  let url = URL(string: trimmed),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https",
                  let host = url.host, !host.isEmpty
            else { return "text" }
            return "url"
        }
    }

    /// Deterministic UUID from the row's profileHash (64-hex SHA-256) so
    /// SwiftUI identity is stable across reloads without storing a UUID.
    private static func stableUUID(fromHex hash: String) -> UUID {
        var bytes: [UInt8] = []
        bytes.reserveCapacity(16)
        var iter = hash.makeIterator()
        while bytes.count < 16, let hi = iter.next(), let lo = iter.next() {
            guard let h = hi.hexDigitValue, let l = lo.hexDigitValue else { break }
            bytes.append(UInt8(h << 4 | l))
        }
        guard bytes.count == 16 else { return UUID() }
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
                           bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]))
    }

    private static func epochMs(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    private func bindText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        sqlite3_bind_text(stmt, index, value, -1, sqliteTransient)
    }

    private func bindOptionalText(_ stmt: OpaquePointer?, _ index: Int32, _ value: String?) {
        if let value { bindText(stmt, index, value) } else { sqlite3_bind_null(stmt, index) }
    }

    private func columnText(_ stmt: OpaquePointer?, _ index: Int32) -> String? {
        sqlite3_column_text(stmt, index).map { String(cString: $0) }
    }

    private func logError(_ context: String) {
        log.error("\(context): \(String(cString: sqlite3_errmsg(self.db)))")
    }
}
