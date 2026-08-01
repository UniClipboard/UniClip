import Foundation
import XCTest

@testable import OutboundShareHandoffCore

final class OutboundShareHandoffTests: XCTestCase {
  private var containerURL: URL!
  private var store: OutboundShareStore!

  override func setUpWithError() throws {
    containerURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("outbound-share-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
    store = try OutboundShareStore(containerURL: containerURL)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: containerURL)
    store = nil
    containerURL = nil
  }

  func testDirectSendLimitIncludesExactlyOneHundredMiB() {
    let limit = Int64(100 * 1024 * 1024)
    XCTAssertTrue(OutboundShareStore.shouldSendDirectly(byteCount: limit))
    XCTAssertFalse(OutboundShareStore.shouldSendDirectly(byteCount: limit + 1))
  }

  func testConnectionTimeoutHandsOffOnlyFiles() {
    XCTAssertTrue(
      OutboundShareFallbackPolicy.shouldHandoff(
        itemIsFile: true,
        connectionTimedOut: true
      )
    )
    XCTAssertFalse(
      OutboundShareFallbackPolicy.shouldHandoff(
        itemIsFile: false,
        connectionTimedOut: true
      )
    )
    XCTAssertFalse(
      OutboundShareFallbackPolicy.shouldHandoff(
        itemIsFile: true,
        connectionTimedOut: false
      )
    )
  }

  func testStageFileCopiesEveryChunkAndPreservesContent() throws {
    let source = containerURL.appendingPathComponent("source.bin")
    let expected = Data((0..<(2 * 1024 * 1024 + 73)).map { UInt8($0 % 251) })
    try expected.write(to: source)

    let staged = try store.stageFile(at: source, displayName: "../archive.bin")

    XCTAssertEqual(staged.displayName, "archive.bin")
    XCTAssertEqual(staged.byteCount, Int64(expected.count))
    XCTAssertEqual(try Data(contentsOf: staged.url), expected)
  }

  func testPendingJobCanBeClaimedReleasedClaimedAndCompleted() throws {
    let staged = try store.stageData(
      Data("durable payload".utf8),
      displayName: "archive.zip",
      mimeType: "application/zip"
    )
    let job = try store.enqueue(staged)

    let firstClaim = try store.claimPendingJobs()
    XCTAssertEqual(firstClaim.map(\.job), [job])
    XCTAssertEqual(try Data(contentsOf: firstClaim[0].fileURL), Data("durable payload".utf8))

    try store.releaseJob(id: job.id)
    XCTAssertEqual(try store.claimPendingJobs().map(\.job), [job])

    try store.completeJob(id: job.id)
    XCTAssertTrue(try store.claimPendingJobs().isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: staged.url.path))
  }

  func testPendingJobPreservesTheSelectedTargetDevices() throws {
    let staged = try store.stageData(Data([1]), displayName: "selected.bin", mimeType: nil)
    let job = try store.enqueue(
      staged,
      targetDeviceIds: ["desktop-2", "desktop-1", "desktop-2"]
    )

    let claimed = try store.claimPendingJobs()

    XCTAssertEqual(job.targetDeviceIds, ["desktop-1", "desktop-2"])
    XCTAssertEqual(claimed.first?.job.targetDeviceIds, ["desktop-1", "desktop-2"])
  }

  func testExpiredJobRemovesRecordAndPayload() throws {
    let staged = try store.stageData(Data([1, 2, 3]), displayName: "old.bin", mimeType: nil)
    let job = try store.enqueue(staged)

    try store.removeExpiredJobs(nowMs: job.createdAtMs + Int64(8 * 24 * 60 * 60 * 1_000))

    XCTAssertTrue(try store.claimPendingJobs().isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: staged.url.path))
  }

  func testAbandonedProcessingJobReturnsToPending() throws {
    let staged = try store.stageData(Data([9, 8, 7]), displayName: "resume.bin", mimeType: nil)
    let job = try store.enqueue(staged)
    XCTAssertEqual(try store.claimPendingJobs().map(\.job), [job])

    let processingRecord = containerURL
      .appendingPathComponent("outbound-handoff/processing/\(job.id).json")
    try FileManager.default.setAttributes(
      [.modificationDate: Date(timeIntervalSinceNow: -(16 * 60))],
      ofItemAtPath: processingRecord.path
    )

    XCTAssertEqual(try store.claimPendingJobs().map(\.job), [job])
  }
}
