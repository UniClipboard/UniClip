import Foundation
#if canImport(AppGroupStore)
internal import class AppGroupStore.SharedStorageAccess
public import protocol AppGroupStore.SharedStorageFileOwner
#elseif canImport(SharedStorageAccess)
import SharedStorageAccess
#endif

/// Owns the extension history connection and its legacy fallback.
/// Suspension closes the connection and denies both database and fallback work.
public final class HistoryLog: SharedStorageFileOwner {
    private let store: SettingsStore
    private let containerURL: URL?
    private let lock = NSLock()
    private var db: HistoryDatabase?
    private var opened = false
    private var suspended = false
    private var retainedUntilClosed: HistoryLog?

    public init(store: SettingsStore, containerURL: URL? = nil) {
        self.store = store
        self.containerURL = containerURL
        SharedStorageAccess.shared.registerFileOwner(self)
    }

    /// Close only after the current synchronous history operation returns.
    /// Keep a failed close owned; never report it as a successful release.
    @discardableResult
    public func suspend() -> Bool {
        lock.withLock {
            suspended = true
            return closeDatabase()
        }
    }

    /// Global admission owns permission; close the file without changing the
    /// component's explicit suspend/resume state (including LAN history owners).
    @discardableResult
    public func closeStorageFiles() -> Bool { lock.withLock { closeDatabase() } }

    private func closeDatabase() -> Bool {
        guard db?.close() ?? true else { return false }
        db = nil
        opened = false
        retainedUntilClosed = nil
        return true
    }

    public func resume() { lock.withLock { suspended = false } }

    public var usesSharedDatabase: Bool { withHistory(fallback: false) { database != nil } }

    public func loadRecent(limit: Int = 200) -> [ClipboardHistoryItem] {
        withHistory(fallback: []) {
            if let database { return database.loadRecent(limit: limit) }
            return Array(store.loadHistory().sorted { $0.timestamp > $1.timestamp }.prefix(limit))
        }
    }

    public func headHash() -> String? {
        withHistory(fallback: nil) {
            if let database { return database.headHash() }
            return store.loadHistory().first?.entry.hash
        }
    }

    @discardableResult
    public func append(entry: Clipboard, direction: ClipboardHistoryItem.Direction, at now: Date = Date()) -> Bool {
        withHistory(fallback: false) {
            if let database { return database.record(entry: entry, direction: direction, at: now) }
            store.appendHistory(entry: entry, direction: direction, at: now)
            return true
        }
    }

    public func touch(hash: String?, legacyID: UUID, at now: Date = Date()) {
        withHistory(fallback: ()) {
            if let database {
                guard let hash, !hash.isEmpty else { return }
                database.touch(profileHash: hash, at: now)
            } else {
                store.touchHistoryItem(id: legacyID)
            }
        }
    }

    private var database: HistoryDatabase? {
        if !opened {
            retainedUntilClosed = self
            db = HistoryDatabase(containerURL: containerURL)
            opened = true
        }
        return db
    }

    private func withHistory<T>(fallback: T, _ work: () -> T) -> T {
        (try? SharedStorageAccess.shared.withAccess {
            lock.withLock {
                guard !suspended else { return fallback }
                return work()
            }
        }) ?? fallback
    }
}
