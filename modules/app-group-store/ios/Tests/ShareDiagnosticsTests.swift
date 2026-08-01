import Foundation
import XCTest

@testable import OutboundShareHandoffCore

final class ShareDiagnosticsTests: XCTestCase {
  private var containerURL: URL!

  override func setUpWithError() throws {
    containerURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("share-diagnostics-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: containerURL)
    containerURL = nil
  }

  func testAttemptPersistsOnlyTypedPrivacySafeEvents() throws {
    let store = try ShareDiagnosticsStore(containerURL: containerURL)
    let recorder = try store.startAttempt(
      id: "attempt-a",
      itemKind: .file,
      byteCount: 20 * 1024 * 1024,
      startedAtMs: 1_000
    )

    recorder.record(stage: .attemptStarted, timestampMs: 1_000)
    recorder.record(
      stage: .peerRefresh,
      peerRefresh: ShareDiagnosticPeerRefresh(total: 1, online: 0, offline: 1, errors: 0),
      timestampMs: 1_100
    )
    recorder.record(
      stage: .failed,
      error: ShareDiagnosticError(code: .receiverOffline),
      timestampMs: 1_120
    )

    let archive = store.loadArchive(nowMs: 1_200)
    let attempt = try XCTUnwrap(archive.attempts.first)
    XCTAssertEqual(archive.schemaVersion, 1)
    XCTAssertEqual(attempt.id, "attempt-a")
    XCTAssertEqual(attempt.itemKind, .file)
    XCTAssertEqual(attempt.byteCount, 20 * 1024 * 1024)
    XCTAssertEqual(attempt.events.map(\.elapsedMs), [0, 100, 120])
    XCTAssertEqual(attempt.events[1].peerRefresh?.online, 0)
    XCTAssertEqual(attempt.events[2].error?.code, .receiverOffline)

    let encoded = try JSONEncoder().encode(archive)
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: encoded) as? [String: Any]
    )
    let serialized = String(data: encoded, encoding: .utf8) ?? ""
    XCTAssertEqual(Set(object.keys), ["schemaVersion", "attempts"])
    XCTAssertFalse(serialized.contains("fields"))
    XCTAssertFalse(serialized.contains("message"))
    XCTAssertFalse(serialized.contains("url"))
    XCTAssertFalse(serialized.contains("path"))
    XCTAssertFalse(serialized.contains("peerId"))
  }

  func testRetentionKeepsNewestFiftyAttemptsFromLastThreeDays() throws {
    let dayMs: Int64 = 24 * 60 * 60 * 1_000
    let nowMs: Int64 = 10 * dayMs
    let store = try ShareDiagnosticsStore(containerURL: containerURL)

    _ = try store.startAttempt(
      id: "expired",
      itemKind: .text,
      byteCount: 1,
      startedAtMs: nowMs - 3 * dayMs - 1
    )
    for index in 0..<52 {
      _ = try store.startAttempt(
        id: "recent-\(index)",
        itemKind: .text,
        byteCount: index,
        startedAtMs: nowMs - Int64(52 - index)
      )
    }

    let archive = store.loadArchive(nowMs: nowMs)
    XCTAssertEqual(archive.attempts.count, 50)
    XCTAssertEqual(archive.attempts.first?.id, "recent-51")
    XCTAssertEqual(archive.attempts.last?.id, "recent-2")
    XCTAssertFalse(archive.attempts.contains(where: { $0.id == "expired" }))
    XCTAssertFalse(archive.attempts.contains(where: { $0.id == "recent-0" }))
    XCTAssertFalse(archive.attempts.contains(where: { $0.id == "recent-1" }))
  }
}
