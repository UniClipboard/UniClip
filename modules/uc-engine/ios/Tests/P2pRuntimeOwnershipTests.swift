import Foundation
import XCTest

@testable import UcEngineSystemHost

final class P2pRuntimeOwnershipTests: XCTestCase {
  func testOnlyOneOwnerCanAcquireTheSharedRuntime() throws {
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }
    let first = P2pRuntimeOwnership(lockURL: lockURL)
    let second = P2pRuntimeOwnership(lockURL: lockURL)

    XCTAssertTrue(try first.acquire(timeoutMs: 0))
    XCTAssertFalse(try second.acquire(timeoutMs: 0))
  }

  func testReleaseAllowsTheNextOwnerToAcquire() throws {
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }
    let first = P2pRuntimeOwnership(lockURL: lockURL)
    let second = P2pRuntimeOwnership(lockURL: lockURL)

    XCTAssertTrue(try first.acquire(timeoutMs: 0))
    first.release()

    XCTAssertTrue(try second.acquire(timeoutMs: 0))
  }

  func testMainApplicationWaitsForAnExtensionToFinishItsBoundedSession() throws {
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }
    let extensionOwner = P2pRuntimeOwnership(lockURL: lockURL)
    let mainApplicationOwner = P2pRuntimeOwnership(lockURL: lockURL)

    XCTAssertTrue(try extensionOwner.acquire(timeoutMs: 0))
    DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(50)) {
      extensionOwner.release()
    }

    XCTAssertTrue(try P2pRuntimeHandoff.acquireForMainApplication(mainApplicationOwner))
  }

  func testDestroyingTheOwnerAutomaticallyReleasesTheRuntime() throws {
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }
    var first: P2pRuntimeOwnership? = P2pRuntimeOwnership(lockURL: lockURL)
    let second = P2pRuntimeOwnership(lockURL: lockURL)

    XCTAssertTrue(try first?.acquire(timeoutMs: 0) == true)
    first = nil

    XCTAssertTrue(try second.acquire(timeoutMs: 0))
  }

  func testOwnedLifecycleReleasesAfterSuspendAndAcquiresBeforeResume() throws {
    var events: [String] = []
    let engine = FakeOwnedEngine(events: { events.append($0) })
    let ownership = FakeRuntimeOwnership(events: { events.append($0) })
    let lifecycle = RuntimeOwnedNativeLifecycle(engine: engine, ownership: ownership)

    try lifecycle.suspend()
    XCTAssertEqual(events, ["engine.suspend", "ownership.release"])

    events.removeAll()
    engine.state = .suspended
    try lifecycle.resume()
    XCTAssertEqual(events, ["ownership.acquire", "engine.resume"])
  }

  func testOwnedLifecycleDoesNotResumeWithoutOwnership() throws {
    let engine = FakeOwnedEngine(events: { _ in })
    let ownership = FakeRuntimeOwnership(events: { _ in })
    ownership.acquireResult = false
    let lifecycle = RuntimeOwnedNativeLifecycle(engine: engine, ownership: ownership)

    XCTAssertThrowsError(try lifecycle.resume()) { error in
      XCTAssertEqual(error as? NativeLifecycleError, .runtimeOwnershipUnavailable)
    }
    XCTAssertEqual(engine.resumeCalls, 0)
  }

  private func makeLockURL() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-ownership-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("runtime.lock")
  }
}

private final class FakeRuntimeOwnership: NativeRuntimeOwnership {
  var acquireResult = true
  private let events: (String) -> Void

  init(events: @escaping (String) -> Void) {
    self.events = events
  }

  func acquire(timeoutMs: UInt64) throws -> Bool {
    events("ownership.acquire")
    return acquireResult
  }

  func release() {
    events("ownership.release")
  }
}

private final class FakeOwnedEngine: NativeEngineLifecycle {
  var state: NativeEngineLifecycleState = .running
  private(set) var resumeCalls = 0
  private let events: (String) -> Void

  init(events: @escaping (String) -> Void) {
    self.events = events
  }

  func recoverSession() throws -> NativeSessionRecovery {
    NativeSessionRecovery(unlocked: true, resumed: true)
  }

  func lifecycleState() throws -> NativeEngineLifecycleState { state }

  func suspend() throws {
    events("engine.suspend")
  }

  func resume() throws {
    resumeCalls += 1
    events("engine.resume")
  }
}
