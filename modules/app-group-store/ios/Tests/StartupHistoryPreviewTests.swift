import Foundation
import SQLite3
import XCTest

@testable import OutboundShareHandoffCore

final class StartupHistoryPreviewTests: XCTestCase {
  private var directoryURL: URL!
  private var databaseURL: URL!

  override func setUpWithError() throws {
    directoryURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("startup-history-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    databaseURL = directoryURL.appendingPathComponent("uniclipboard.db")
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directoryURL)
    databaseURL = nil
    directoryURL = nil
  }

  func testReadsOnlyTheFirstTwentyVisibleRowsFromOneThousand() throws {
    try seedHistoryDatabase(at: databaseURL, count: 1_000)

    let items = StartupHistoryPreviewReader(databaseURL: databaseURL).load()

    XCTAssertEqual(items.count, 20)
    XCTAssertEqual(items.prefix(4).map(\.profileHash), ["mock-20", "mock-10", "mock-998", "mock-997"])
    XCTAssertFalse(items.contains { $0.profileHash == "mock-999" })
    XCTAssertEqual(items.first?.text, "Mock history 20")
  }

  func testMissingDatabaseReturnsNoPreviewInsteadOfCreatingAFile() {
    let items = StartupHistoryPreviewReader(databaseURL: databaseURL).load()

    XCTAssertTrue(items.isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: databaseURL.path))
  }

  func testReadsWalDatabaseBeforeSidecarFilesExist() throws {
    try seedHistoryDatabase(at: databaseURL, count: 1_000)
    try enableWalAndClose(at: databaseURL)

    XCTAssertFalse(FileManager.default.fileExists(atPath: databaseURL.path + "-wal"))
    XCTAssertFalse(FileManager.default.fileExists(atPath: databaseURL.path + "-shm"))

    let items = StartupHistoryPreviewReader(databaseURL: databaseURL).load()

    XCTAssertEqual(items.count, 20)
    XCTAssertEqual(items.first?.profileHash, "mock-20")
  }

  private func seedHistoryDatabase(at url: URL, count: Int) throws {
    var database: OpaquePointer?
    XCTAssertEqual(sqlite3_open(url.path, &database), SQLITE_OK)
    guard let database else {
      XCTFail("SQLite did not open the fixture database")
      return
    }
    defer { sqlite3_close(database) }

    let schema = """
    CREATE TABLE clipboard_history (
      profileHash TEXT PRIMARY KEY COLLATE NOCASE,
      type TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      dataName TEXT,
      timestamp INTEGER NOT NULL DEFAULT 0,
      lastAccessed INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      isDeleted INTEGER NOT NULL DEFAULT 0
    );
    """
    XCTAssertEqual(sqlite3_exec(database, schema, nil, nil, nil), SQLITE_OK)

    let insert = """
    INSERT INTO clipboard_history
      (profileHash, type, text, dataName, timestamp, lastAccessed, pinned, isDeleted)
    VALUES (?, 'Text', ?, NULL, ?, ?, ?, ?)
    """
    var statement: OpaquePointer?
    XCTAssertEqual(sqlite3_prepare_v2(database, insert, -1, &statement, nil), SQLITE_OK)
    guard let statement else {
      XCTFail("SQLite did not prepare the fixture insert")
      return
    }
    defer { sqlite3_finalize(statement) }

    for index in 0..<count {
      sqlite3_reset(statement)
      sqlite3_clear_bindings(statement)
      sqlite3_bind_text(statement, 1, "mock-\(index)", -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 2, "Mock history \(index)", -1, SQLITE_TRANSIENT)
      sqlite3_bind_int64(statement, 3, sqlite3_int64(index))
      sqlite3_bind_int64(statement, 4, sqlite3_int64(index))
      sqlite3_bind_int(statement, 5, index == 10 || index == 20 || index == 999 ? 1 : 0)
      sqlite3_bind_int(statement, 6, index == 999 ? 1 : 0)
      XCTAssertEqual(sqlite3_step(statement), SQLITE_DONE)
    }
  }

  private func enableWalAndClose(at url: URL) throws {
    var database: OpaquePointer?
    XCTAssertEqual(sqlite3_open(url.path, &database), SQLITE_OK)
    guard let database else {
      XCTFail("SQLite did not reopen the fixture database")
      return
    }
    XCTAssertEqual(sqlite3_exec(database, "PRAGMA journal_mode = WAL", nil, nil, nil), SQLITE_OK)
    XCTAssertEqual(sqlite3_close(database), SQLITE_OK)
  }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
