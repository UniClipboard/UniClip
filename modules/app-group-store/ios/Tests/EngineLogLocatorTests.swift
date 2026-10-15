import Foundation
import XCTest

@testable import OutboundShareHandoffCore

final class EngineLogLocatorTests: XCTestCase {
  private var container: URL!

  override func setUpWithError() throws {
    container = FileManager.default.temporaryDirectory
      .appendingPathComponent("engine-log-locator-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: container)
  }

  private func write(_ relative: String) throws {
    let url = container.appendingPathComponent(relative)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("x".utf8).write(to: url)
  }

  func testPrivateDataLogsComeBeforeLegacyCacheLogs() throws {
    try write("p2p/cache/logs/engine.2026-10-13.jsonl")
    try write("p2p/data/logs/engine.2026-10-14.jsonl")

    let files = EngineLogLocator.logFiles(in: container)

    XCTAssertEqual(
      files.map { "\($0.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent)/\($0.lastPathComponent)" },
      ["data/engine.2026-10-14.jsonl", "cache/engine.2026-10-13.jsonl"])
  }

  func testSameNameInBothDirectoriesIsKeptTwice() throws {
    try write("p2p/cache/logs/engine.2026-10-14.jsonl")
    try write("p2p/data/logs/engine.2026-10-14.jsonl")

    XCTAssertEqual(EngineLogLocator.logFiles(in: container).count, 2)
  }

  func testIgnoresUnrelatedFilesAndMissingDirectories() throws {
    try write("p2p/data/logs/notes.md")
    try write("p2p/data/logs/engine.2026-10-14.jsonl")

    XCTAssertEqual(
      EngineLogLocator.logFiles(in: container).map(\.lastPathComponent),
      ["engine.2026-10-14.jsonl"])
    XCTAssertEqual(EngineLogLocator.logFiles(in: container.appendingPathComponent("none")), [])
  }
}
