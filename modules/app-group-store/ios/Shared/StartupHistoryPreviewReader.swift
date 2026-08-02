import Foundation
import SQLite3

public struct StartupHistoryPreviewItem: Equatable, Sendable {
  public let profileHash: String
  public let type: String
  public let text: String
  public let dataName: String?
  public let timestampMs: Int64
  public let pinned: Bool
}

public struct StartupHistoryPreviewReader: Sendable {
  public static let itemLimit = 20

  private let databaseURL: URL

  public init(databaseURL: URL) {
    self.databaseURL = databaseURL
  }

  public func load() -> [StartupHistoryPreviewItem] {
    guard FileManager.default.fileExists(atPath: databaseURL.path) else {
      return []
    }

    let walPath = databaseURL.path + "-wal"
    let useImmutableSnapshot = !FileManager.default.fileExists(atPath: walPath)
    let filename = useImmutableSnapshot
      ? databaseURL.absoluteString + "?immutable=1"
      : databaseURL.path
    var database: OpaquePointer?
    let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
      | (useImmutableSnapshot ? SQLITE_OPEN_URI : 0)
    let openResult = sqlite3_open_v2(filename, &database, flags, nil)
    guard openResult == SQLITE_OK,
          let database
    else {
      if let database { sqlite3_close(database) }
      return []
    }
    defer { sqlite3_close(database) }

    sqlite3_busy_timeout(database, 25)

    let query = """
    SELECT profileHash, type, text, dataName,
           COALESCE(NULLIF(lastAccessed, 0), timestamp) AS previewTimestamp,
           pinned
    FROM clipboard_history
    WHERE isDeleted = 0
    ORDER BY pinned DESC, previewTimestamp DESC
    LIMIT ?
    """
    var statement: OpaquePointer?
    let prepareResult = sqlite3_prepare_v2(database, query, -1, &statement, nil)
    guard prepareResult == SQLITE_OK,
          let statement
    else {
      if let statement { sqlite3_finalize(statement) }
      return []
    }
    defer { sqlite3_finalize(statement) }

    sqlite3_bind_int(statement, 1, Int32(Self.itemLimit))

    var items: [StartupHistoryPreviewItem] = []
    items.reserveCapacity(Self.itemLimit)
    var stepResult = sqlite3_step(statement)
    while stepResult == SQLITE_ROW {
      items.append(
        StartupHistoryPreviewItem(
          profileHash: Self.text(in: statement, column: 0),
          type: Self.text(in: statement, column: 1),
          text: Self.text(in: statement, column: 2),
          dataName: Self.optionalText(in: statement, column: 3),
          timestampMs: sqlite3_column_int64(statement, 4),
          pinned: sqlite3_column_int(statement, 5) != 0
        )
      )
      stepResult = sqlite3_step(statement)
    }
    return items
  }

  private static func text(in statement: OpaquePointer, column: Int32) -> String {
    optionalText(in: statement, column: column) ?? ""
  }

  private static func optionalText(in statement: OpaquePointer, column: Int32) -> String? {
    guard let value = sqlite3_column_text(statement, column) else { return nil }
    return String(cString: value)
  }
}
