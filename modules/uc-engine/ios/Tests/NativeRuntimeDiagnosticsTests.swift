import Foundation
import XCTest

@testable import UcEngineSystemHost

final class NativeRuntimeDiagnosticsTests: XCTestCase {
  func testRecordsCorrelatedBoundariesWithoutErrorText() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = NativeRuntimeDiagnostics(directory: root, role: .mainApplication)
    let operation = journal.begin(.engineStart, trigger: .appStartup)
    journal.finish(operation, outcome: .failed, failure: .init(reason: .engineFailure, code: 1214))
    XCTAssertTrue(journal.flush())
    let records = try readRecords(journal)
    let boundaries = records.filter { $0["event"] as? String == "engine.start" }
    XCTAssertEqual(boundaries.count, 2)
    XCTAssertEqual(boundaries[0]["operationId"] as? String, boundaries[1]["operationId"] as? String)
    XCTAssertEqual(boundaries[0]["sessionId"] as? String, boundaries[1]["sessionId"] as? String)
    XCTAssertEqual(boundaries[1]["outcome"] as? String, "failed")
    XCTAssertNotNil(boundaries[1]["durationMs"])
    XCTAssertEqual((boundaries[1]["failure"] as? [String: Any])?["code"] as? Int, 1214)
    XCTAssertFalse(String(describing: boundaries).contains(root.path))
  }

  func testRotationIsBoundedAndRetainsTheNewestEvent() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = NativeRuntimeDiagnostics(directory: root, role: .keyboardExtension, maxFileBytes: 1_200, maxFiles: 2)
    for _ in 0..<20 {
      journal.record(.appForeground, trigger: .appForeground)
      XCTAssertTrue(journal.flush())
    }
    journal.record(.appBackground, trigger: .appBackground)
    XCTAssertTrue(journal.flush())
    XCTAssertLessThanOrEqual(journal.fileURLs().count, 2)
    XCTAssertGreaterThan(journal.snapshot().prunedFiles, 0)
    XCTAssertTrue(try readRecords(journal).contains { $0["event"] as? String == "app.background" })
  }

  func testUnavailableDirectoryDoesNotThrowOrPretendToRecord() {
    let journal = NativeRuntimeDiagnostics(directory: nil, role: .shareExtension)
    journal.record(.shareHandoff, trigger: .userRequest)
    XCTAssertTrue(journal.flush())
    XCTAssertEqual(journal.snapshot().writerStatus, "unavailable")
    XCTAssertGreaterThan(journal.snapshot().droppedRecords, 0)
    XCTAssertTrue(journal.fileURLs().isEmpty)
  }

  func testRuntimeOwnershipRecordsContentionAndActualRelease() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let journal = NativeRuntimeDiagnostics(directory: root, role: .mainApplication)
    let owner = P2pRuntimeOwnership(lockURL: root.appendingPathComponent("runtime.lock"), diagnostics: journal)
    let contender = P2pRuntimeOwnership(lockURL: root.appendingPathComponent("runtime.lock"), diagnostics: journal)
    XCTAssertTrue(try owner.acquire(timeoutMs: 0))
    XCTAssertFalse(try contender.acquire(timeoutMs: 0))
    contender.release()
    owner.release()
    XCTAssertTrue(journal.flush())
    let records = try readRecords(journal)
    XCTAssertTrue(records.contains { $0["event"] as? String == "ownership.acquire" && $0["outcome"] as? String == "notAcquired" })
    XCTAssertEqual(records.filter { $0["event"] as? String == "ownership.release" }.count, 1)
  }

  private func readRecords(_ journal: NativeRuntimeDiagnostics) throws -> [[String: Any]] {
    try journal.fileURLs().flatMap { url in
      try String(contentsOf: url, encoding: .utf8).split(separator: "\n").map {
        try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any]
      }
    }
  }
}
