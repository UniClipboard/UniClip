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
    host.enterBackground(engine)
    engine.state = .suspended
    host.enterForeground(engine)

    XCTAssertEqual(engine.suspendCalls, 1)
    XCTAssertEqual(engine.resumeCalls, 1)
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

    host.enterBackground(engine)

    XCTAssertNotNil(reported)
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
  var resumeCalls = 0

  init(state: NativeEngineLifecycleState) {
    self.state = state
  }

  func recoverSession() throws -> NativeSessionRecovery {
    recoverCalls += 1
    return recovery
  }

  func lifecycleState() throws -> NativeEngineLifecycleState { state }

  func suspend() throws {
    suspendCalls += 1
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
