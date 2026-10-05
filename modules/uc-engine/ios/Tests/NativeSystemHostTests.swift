import Foundation
import Security
import XCTest

@testable import UcEngineSystemHost

final class NativeSystemHostTests: XCTestCase {
  func testEngineIsVisibleWhileStartupPreparationRuns() throws {
    let engine = FakeRegisteredEngine()
    let registry = NativeEngineRegistry<FakeRegisteredEngine>()

    let installed = registry.installBeforePreparing(engine) { candidate in
      XCTAssertTrue(registry.current() === candidate)
    }

    XCTAssertTrue(installed)
    XCTAssertTrue(registry.current() === engine)
  }

  func testKeychainRoundTripUsesSystemKeychain() throws {
    let service = "app.uniclipboard.uc-engine.tests.\(UUID().uuidString)"
    let key = "identity"
    let value = Data("keychain-value".utf8)
    let storage = AppleSecureStorage(service: service)
    defer { try? storage.delete(key: key) }

    XCTAssertNil(try storage.get(key: key))
    try storage.set(key: key, value: value)
    XCTAssertEqual(try storage.get(key: key), value)
    try storage.delete(key: key)
    XCTAssertNil(try storage.get(key: key))
  }

  func testKeychainUnavailableReturnsStableFailure() throws {
    let storage = AppleSecureStorage(
      service: "app.uniclipboard.uc-engine.tests.unavailable",
      keychain: UnavailableKeychain()
    )

    XCTAssertThrowsError(try storage.get(key: "identity")) { error in
      XCTAssertEqual(error as? SystemHostError, .unavailable)
    }
  }

  func testOutputHandleWritesAndReadsBackIdenticalContent() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-host-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let destination = directory.appendingPathComponent("export.bin")
    let expected = Data((0..<32_769).map { UInt8($0 % 251) })
    let files = AppleFileHandleRegistry()
    let handle = files.register(url: destination, writable: true)

    try files.write(handle, offset: 0, bytes: expected.prefix(16_384))
    try files.write(handle, offset: 16_384, bytes: expected.dropFirst(16_384))
    try files.finishWrite(handle)

    let actual = try files.read(handle, offset: 0, maxBytes: UInt32(expected.count + 1))
    XCTAssertEqual(actual, expected)
    XCTAssertEqual(try Data(contentsOf: destination), expected)
    XCTAssertFalse(handle.contains(destination.path))
  }

  func testInputHandleReadsTwentyMegabytesAcrossAllChunks() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-large-host-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("twenty-megabytes.bin")
    let expected = Data(repeating: 0xA5, count: 20 * 1024 * 1024)
    try expected.write(to: source)
    let files = AppleFileHandleRegistry()
    let handle = files.register(url: source, writable: false)
    var actual = Data()
    var offset: UInt64 = 0

    while offset < UInt64(expected.count) {
      let chunk = try files.read(handle, offset: offset, maxBytes: 64 * 1024)
      XCTAssertFalse(chunk.isEmpty)
      actual.append(chunk)
      offset += UInt64(chunk.count)
    }

    XCTAssertEqual(actual, expected)
  }

  func testTransientHostFileReadRetriesBeforeSurfacingFailure() throws {
    var attempts = 0

    let result: Data = try AppleFileReadRetry.run(beforeRetry: {}) {
      attempts += 1
      if attempts == 1 { throw SystemHostError.io }
      return Data("recovered".utf8)
    }

    XCTAssertEqual(result, Data("recovered".utf8))
    XCTAssertEqual(attempts, 2)
  }

  func testDeferredInputHandleRemainsReadableUntilSessionCleanup() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-retained-host-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("deferred.bin")
    let expected = Data(repeating: 0x5A, count: 128 * 1024)
    try expected.write(to: source)
    let files = AppleFileHandleRegistry()

    let handle = try files.withRetainedInputFile(url: source, displayName: "deferred.bin") {
      XCTAssertEqual(try files.metadata($0).sizeBytes, UInt64(expected.count))
      return $0
    }

    XCTAssertEqual(
      try files.read(handle, offset: 64 * 1024, maxBytes: 64 * 1024),
      expected.suffix(64 * 1024)
    )
    files.removeAll()
    XCTAssertThrowsError(try files.read(handle, offset: 0, maxBytes: 1)) { error in
      XCTAssertEqual(error as? SystemHostError, .invalidHandle)
    }
  }

  func testRetainedInputFailureReportsPrivacySafeReadProgress() throws {
    struct ProbeFailure: Error {}

    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-diagnostic-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("private-name.bin")
    try Data(repeating: 0x33, count: 128 * 1024).write(to: source)
    let files = AppleFileHandleRegistry()

    XCTAssertThrowsError(
      try files.withRetainedInputFile(url: source, displayName: "private-name.bin") { handle in
        _ = try files.metadata(handle)
        _ = try files.read(handle, offset: 0, maxBytes: 64 * 1024)
        throw ProbeFailure()
      }
    ) { error in
      let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
      XCTAssertTrue(message.contains("file-stage=read-ok"))
      XCTAssertTrue(message.contains("file-size=131072"))
      XCTAssertTrue(message.contains("file-read-end=65536"))
      XCTAssertTrue(message.contains("file-read-calls=1"))
      XCTAssertFalse(message.contains("private-name.bin"))
      XCTAssertFalse(message.contains(directory.path))
    }
  }

  func testFileReadFailureReportsOffsetWithoutPath() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-read-failure-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("private-missing.bin")
    try Data(repeating: 0x44, count: 128 * 1024).write(to: source)
    let files = AppleFileHandleRegistry()

    XCTAssertThrowsError(
      try files.withRetainedInputFile(url: source, displayName: "private-missing.bin") { handle in
        _ = try files.metadata(handle)
        try FileManager.default.removeItem(at: source)
        return try files.read(handle, offset: 64 * 1024, maxBytes: 64 * 1024)
      }
    ) { error in
      let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
      XCTAssertTrue(message.contains("file-stage=read-failed"))
      XCTAssertTrue(message.contains("file-offset=65536"))
      XCTAssertTrue(message.contains("file-requested=65536"))
      XCTAssertTrue(message.contains("file-error=io"))
      XCTAssertFalse(message.contains("private-missing.bin"))
      XCTAssertFalse(message.contains(directory.path))
    }
  }

  func testClipboardSharePreservesDisplayNameAndContent() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-clipboard-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("00000000")
    let expected = Data((0..<99).map { UInt8($0 % 73) })
    try expected.write(to: source)
    let cache = AppleClipboardShareCache(root: directory.appendingPathComponent("shares"))

    let shared = try cache.create(displayName: "plan006-original-name.txt") {
      try FileManager.default.copyItem(at: source, to: $0)
    }

    XCTAssertEqual(shared.lastPathComponent, "plan006-original-name.txt")
    XCTAssertEqual(try Data(contentsOf: shared), expected)
  }

  func testClipboardDisplayMetadataRestoresTheOriginalName() throws {
    let metadata = Data(
      #"{"files":[{"storage_name":"00000000","display_name":"plan006-original-name.txt"}]}"#
        .utf8
    )

    XCTAssertEqual(
      try AppleClipboardDisplayMetadata(data: metadata).displayName(for: "00000000"),
      "plan006-original-name.txt"
    )
  }

  func testClipboardFileResolverCombinesOpaquePathWithOriginalName() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-clipboard-resolver-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let source = directory.appendingPathComponent("00000000")
    try Data("file content".utf8).write(to: source)
    let metadata = try AppleClipboardDisplayMetadata(
      data: Data(
        #"{"files":[{"storage_name":"00000000","display_name":"plan006-original-name.txt"}]}"#
          .utf8
      )
    )

    let selection = AppleClipboardFileResolver.resolve(
      format: "files",
      mimeType: "text/uri-list",
      bytes: Data("\(source.absoluteString)\n".utf8),
      metadata: metadata,
      allowedRoots: [directory]
    )

    XCTAssertEqual(selection?.sourceURL, source)
    XCTAssertEqual(selection?.displayName, "plan006-original-name.txt")
  }

  func testClipboardShareRemovesUnsafePathComponents() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-clipboard-tests-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = AppleClipboardShareCache(root: directory)

    let shared = try cache.create(displayName: "../../unsafe/report.txt") {
      try Data("safe content".utf8).write(to: $0)
    }

    XCTAssertEqual(shared.lastPathComponent, "report.txt")
    XCTAssertEqual(shared.deletingLastPathComponent().deletingLastPathComponent(), directory)
  }

  func testClipboardShareCacheRemovesExpiredAndOverflowEntries() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-clipboard-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let now = Date()
    for index in 0..<66 {
      let entry = directory.appendingPathComponent(String(index), isDirectory: true)
      try FileManager.default.createDirectory(at: entry, withIntermediateDirectories: true)
      try FileManager.default.setAttributes(
        [.modificationDate: now.addingTimeInterval(-TimeInterval(index))],
        ofItemAtPath: entry.path
      )
    }
    let expired = directory.appendingPathComponent("expired", isDirectory: true)
    try FileManager.default.createDirectory(at: expired, withIntermediateDirectories: true)
    try FileManager.default.setAttributes(
      [.modificationDate: now.addingTimeInterval(-8 * 24 * 60 * 60)],
      ofItemAtPath: expired.path
    )

    try AppleClipboardShareCache(root: directory).prune(now: now)

    XCTAssertFalse(FileManager.default.fileExists(atPath: expired.path))
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).count, 64)
  }

  func testLifecycleHostRecoversPersistedSessionBeforeUse() throws {
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.recovery = NativeSessionRecovery(unlocked: true, resumed: true)
    let host = NativeLifecycleHost(report: { _ in XCTFail("Recovery must not be reported") })

    try host.prepare(engine)

    XCTAssertEqual(engine.recoverCalls, 1)
  }

  func testLifecycleHostForwardsOnlyLegalSystemTransitions() throws {
    let engine = FakeNativeEngineLifecycle(state: .running)
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })

    host.enterForeground(engine)
    _ = host.enterBackground(engine, remainingTimeMs: { 1_000 })
    engine.state = .suspended
    host.enterForeground(engine)

    XCTAssertEqual(engine.suspendCalls, 1)
    XCTAssertEqual(engine.resumeCalls, 1)
    XCTAssertEqual(engine.foregroundOpportunities, 2)
  }

  func testLifecycleHostMakesRepeatedForegroundRecoveryIdempotent() throws {
    let engine = FakeNativeEngineLifecycle(state: .suspended)
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })

    try host.resumeIfNeeded(engine)
    try host.resumeIfNeeded(engine)

    XCTAssertEqual(engine.resumeCalls, 1)
    XCTAssertEqual(engine.state, .running)
  }

  func testLifecycleHostReportsTransitionFailures() throws {
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.transitionError = TestLifecycleError.failed
    var reported: Error?
    let host = NativeLifecycleHost(report: { reported = $0 })

    _ = host.enterBackground(engine, remainingTimeMs: { 1_000 })

    XCTAssertNotNil(reported)
  }

  func testBackgroundDeadlineDefinesSafeBoundaryBehavior() {
    let largestSafeSystemTime = Double(UInt64.max).nextDown / 1_000 + 0.1

    XCTAssertEqual(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: 10.1),
      10_000,
      "Ordinary system time should preserve the 100 ms completion margin"
    )
    XCTAssertEqual(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: 0),
      0,
      "Zero system time should produce an immediate deadline"
    )
    XCTAssertEqual(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: 0.05),
      0,
      "System time shorter than the completion margin should produce an immediate deadline"
    )
    XCTAssertEqual(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: -1),
      0,
      "Negative system time should produce an immediate deadline"
    )
    XCTAssertEqual(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: largestSafeSystemTime),
      18_446_744_073_709_547_520,
      "The largest representable deadline below the rounded UInt64 boundary should be accepted"
    )
    XCTAssertNil(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: Double(UInt64.max)),
      "The rounded UInt64 boundary must not be converted"
    )
    XCTAssertNil(
      NativeBackgroundDeadline.remainingTimeMs(
        systemRemainingSeconds: Double.greatestFiniteMagnitude
      ),
      "The largest finite system time must not be converted"
    )
    XCTAssertNil(
      NativeBackgroundDeadline.remainingTimeMs(systemRemainingSeconds: .infinity),
      "Infinite system time means no usable deadline"
    )
  }

  func testBackgroundTransitionSurvivesTestFlightCrashSystemTime() {
    let systemRemainingSeconds = Double.greatestFiniteMagnitude
    let legacyMilliseconds = min(
      systemRemainingSeconds * 1_000,
      Double(UInt64.max)
    )
    XCTAssertNil(
      UInt64(exactly: legacyMilliseconds),
      "The TestFlight implementation tried to convert this unrepresentable value"
    )

    let suspended = expectation(description: "engine suspended")
    let activityEnded = expectation(description: "background activity ended")
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.onSuspend = { suspended.fulfill() }
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })
    let coordinator = NativeLifecycleTransitionCoordinator(
      lifecycle: host,
      queue: DispatchQueue(label: "TestFlightCrashRegression"),
      beginBackgroundActivity: {
        TestBackgroundActivity(systemRemainingSeconds: systemRemainingSeconds) {
          activityEnded.fulfill()
        }
      }
    )

    coordinator.enterBackground(engine)

    wait(for: [suspended, activityEnded], timeout: 1)
    XCTAssertEqual(engine.suspendCalls, 1)
    XCTAssertNil(
      engine.lastSuspendDeadlineMs,
      "An unrepresentable system time should suspend without inventing a deadline"
    )
  }

  func testBackgroundTransitionLeavesTheActivityOpenWhenSuspendNeverSucceeds() throws {
    // Corrected during review: ending the background task immediately on a
    // budget-exhausted failure would surrender whatever real time iOS already
    // granted, right when the Engine's own detached in-flight operation (the
    // one that caused the deadline-exceeded failure) most needs it to finish
    // and release its lock before suspension. On failure the task must be
    // left running — it is still ended reliably later, just not by this path.
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.transitionError = NativeLifecycleError.deadlineExceeded
    var reported: Error?
    let activityEnded = LockedFlag()
    let reportedExpectation = expectation(description: "failure reported")
    let host = NativeLifecycleHost(report: {
      reported = $0
      reportedExpectation.fulfill()
    })
    let queue = DispatchQueue(label: "LeavesActivityOpenOnFailureTests")
    let coordinator = NativeLifecycleTransitionCoordinator(
      lifecycle: host,
      queue: queue,
      beginBackgroundActivity: {
        TestBackgroundActivity(remainingTimeMs: 0) {
          activityEnded.set(true)
        }
      }
    )

    coordinator.enterBackground(engine)

    wait(for: [reportedExpectation], timeout: 1)
    // `report(error)` runs just before `enterBackground()` decides whether to
    // call `finish()`, on the same serial queue with no further async hop in
    // between — flush that queue so the decision has definitely happened
    // before asserting on it.
    queue.sync {}
    XCTAssertNotNil(reported, "A permanent deadline-exceeded failure must still be reported")
    XCTAssertEqual(
      engine.suspendCalls, 1,
      "With no real budget left for a retry, suspend must be attempted exactly once, not looped forever"
    )
    XCTAssertFalse(
      activityEnded.get(),
      "The background task must stay open on failure so the OS-granted time isn't surrendered early"
    )
  }

  func testBackgroundTransitionRetriesSuspendWhileRealBudgetRemains() throws {
    // The deadline passed to the Engine must be read fresh on every attempt
    // (not the single value captured before the lifecycle queue even ran),
    // and a deadline-exceeded failure must be retried as long as the system
    // still reports real background time left.
    let activityEnded = expectation(description: "background activity ended")
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.failuresBeforeSuccess = 2
    var reported: Error?
    let host = NativeLifecycleHost(report: { reported = $0 })
    let coordinator = NativeLifecycleTransitionCoordinator(
      lifecycle: host,
      queue: DispatchQueue(label: "RetriesWhileBudgetRemainsTests"),
      beginBackgroundActivity: {
        TestBackgroundActivity(remainingTimeMsSequence: [5_000, 4_000, 3_000]) {
          activityEnded.fulfill()
        }
      }
    )

    coordinator.enterBackground(engine)

    wait(for: [activityEnded], timeout: 1)
    XCTAssertNil(reported)
    XCTAssertEqual(engine.suspendCalls, 3)
    XCTAssertEqual(
      engine.lastSuspendDeadlineMs, 3_000,
      "The final attempt must use a freshly read deadline, not the value captured before the first attempt"
    )
    XCTAssertEqual(engine.state, .suspended)
  }

  func testForegroundResumesFromQuiescedJustLikeSuspended() throws {
    // t-0176's real Engine E2E showed that after a deadline-exceeded suspend
    // the Engine settles in `.quiesced`, not `.suspended`, and that Engine's
    // own `resume()` already accepts being called from `.quiesced`. The host
    // must actually call it from there instead of waiting for the next
    // background/foreground cycle (which is what produced the observed
    // `1001 invalid_state` failures).
    let engine = FakeNativeEngineLifecycle(state: .quiesced)
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })

    try host.resumeIfNeeded(engine)

    XCTAssertEqual(engine.resumeCalls, 1)
    XCTAssertEqual(engine.state, .running)
  }

  func testForegroundDoesNotResumeAMidTransitionEngine() throws {
    let engine = FakeNativeEngineLifecycle(state: .quiescing)
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })

    try host.resumeIfNeeded(engine)

    XCTAssertEqual(engine.resumeCalls, 0, "A quiesce still in flight must not be raced by a resume")
  }

  func testBackgroundTransitionReturnsBeforeSuspendAndEndsActivityAfterCleanup() throws {
    let suspendStarted = expectation(description: "suspend started")
    let activityEnded = expectation(description: "background activity ended")
    let continueSuspend = DispatchSemaphore(value: 0)
    let events = LockedStringEvents()
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.onSuspend = {
      suspendStarted.fulfill()
      continueSuspend.wait()
    }
    let host = NativeLifecycleHost(report: { _ in XCTFail("Transition must not fail") })
    let coordinator = NativeLifecycleTransitionCoordinator(
      lifecycle: host,
      queue: DispatchQueue(label: "NativeLifecycleTransitionCoordinatorTests"),
      beginBackgroundActivity: {
        events.append("begin")
        return TestBackgroundActivity(remainingTimeMs: 1_234) {
          events.append("end")
          activityEnded.fulfill()
        }
      }
    )

    coordinator.enterBackground(engine)

    XCTAssertEqual(events.snapshot(), ["begin"])
    wait(for: [suspendStarted], timeout: 1)
    XCTAssertEqual(events.snapshot(), ["begin"])
    XCTAssertEqual(engine.lastSuspendDeadlineMs, 1_234)
    continueSuspend.signal()
    wait(for: [activityEnded], timeout: 1)
    XCTAssertEqual(events.snapshot(), ["begin", "end"])
  }
}

private final class TestBackgroundActivity: NativeBackgroundActivity, @unchecked Sendable {
  private let remainingTime: @Sendable () -> UInt64?
  private let onEnd: @Sendable () -> Void

  init(remainingTimeMs: UInt64, onEnd: @escaping @Sendable () -> Void) {
    remainingTime = { remainingTimeMs }
    self.onEnd = onEnd
  }

  init(systemRemainingSeconds: TimeInterval, onEnd: @escaping @Sendable () -> Void) {
    remainingTime = {
      NativeBackgroundDeadline.remainingTimeMs(
        systemRemainingSeconds: systemRemainingSeconds
      )
    }
    self.onEnd = onEnd
  }

  /// Simulates a live, shrinking background budget: each read consumes the
  /// next value, standing in for `UIApplication.backgroundTimeRemaining`
  /// actually decreasing between retry attempts. The last value repeats once
  /// the sequence is exhausted.
  init(remainingTimeMsSequence: [UInt64], onEnd: @escaping @Sendable () -> Void) {
    let box = LockedSequenceCursor(remainingTimeMsSequence)
    remainingTime = { box.next() }
    self.onEnd = onEnd
  }

  var remainingTimeMs: UInt64? { remainingTime() }

  func end() { onEnd() }
}

private final class LockedSequenceCursor: @unchecked Sendable {
  private let lock = NSLock()
  private let values: [UInt64]
  private var index = 0

  init(_ values: [UInt64]) {
    self.values = values
  }

  func next() -> UInt64? {
    lock.lock()
    defer { lock.unlock() }
    guard !values.isEmpty else { return nil }
    let value = values[min(index, values.count - 1)]
    index += 1
    return value
  }
}

private final class LockedFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false

  func set(_ newValue: Bool) {
    lock.lock()
    value = newValue
    lock.unlock()
  }

  func get() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

private final class LockedStringEvents: @unchecked Sendable {
  private let lock = NSLock()
  private var events: [String] = []

  func append(_ event: String) {
    lock.lock()
    events.append(event)
    lock.unlock()
  }

  func snapshot() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return events
  }
}

private final class FakeRegisteredEngine {}

private enum TestLifecycleError: Error {
  case failed
}

private final class FakeNativeEngineLifecycle: NativeEngineLifecycle {
  var state: NativeEngineLifecycleState
  var recovery = NativeSessionRecovery(unlocked: false, resumed: false)
  var transitionError: Error?
  var recoverCalls = 0
  var suspendCalls = 0
  var lastSuspendDeadlineMs: UInt64?
  var resumeCalls = 0
  var foregroundOpportunities = 0
  /// Number of leading `suspend` calls that throw `.deadlineExceeded` before
  /// one finally succeeds, standing in for a transaction that is still
  /// in flight on the first attempts and finishes by the last one.
  var failuresBeforeSuccess = 0
  func notifyForegroundOpportunity() throws { foregroundOpportunities += 1 }
  var onSuspend: (() -> Void)?

  init(state: NativeEngineLifecycleState) {
    self.state = state
  }

  func recoverSession() throws -> NativeSessionRecovery {
    recoverCalls += 1
    return recovery
  }

  func lifecycleState() throws -> NativeEngineLifecycleState { state }

  func suspend(deadlineMs: UInt64?) throws {
    suspendCalls += 1
    lastSuspendDeadlineMs = deadlineMs
    onSuspend?()
    if suspendCalls <= failuresBeforeSuccess {
      throw NativeLifecycleError.deadlineExceeded
    }
    if let transitionError { throw transitionError }
    state = .suspended
  }

  func resume() throws {
    resumeCalls += 1
    if let transitionError { throw transitionError }
    state = .running
  }
}

private struct UnavailableKeychain: KeychainAccessing {
  func copy(query: [String: Any]) -> KeychainCopyResult {
    .failure(errSecNotAvailable)
  }

  func add(attributes: [String: Any]) -> OSStatus { errSecNotAvailable }
  func update(query: [String: Any], attributes: [String: Any]) -> OSStatus { errSecNotAvailable }
  func delete(query: [String: Any]) -> OSStatus { errSecNotAvailable }
}
