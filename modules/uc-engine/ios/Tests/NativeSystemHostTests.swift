import Foundation
import Security
import XCTest

@testable import UcEngineSystemHost

final class NativeSystemHostTests: XCTestCase {
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

  func testLifecycleHostReportsTransitionFailures() throws {
    let engine = FakeNativeEngineLifecycle(state: .running)
    engine.transitionError = TestLifecycleError.failed
    var reported: Error?
    let host = NativeLifecycleHost(report: { reported = $0 })

    host.enterBackground(engine)

    XCTAssertNotNil(reported)
  }
}

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
  }

  func resume() throws {
    resumeCalls += 1
    if let transitionError { throw transitionError }
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
