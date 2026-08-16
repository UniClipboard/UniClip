import XCTest

@testable import UcEngineSystemHost

final class ExtensionRuntimeLifecycleTests: XCTestCase {
  func testStopSuspendsAndReleasesBeforeSlowFinalShutdownFinishes() throws {
    let shutdownStarted = expectation(description: "final shutdown started")
    let allowShutdownToFinish = DispatchSemaphore(value: 0)
    let recorder = LockedEventRecorder()
    let engine = FakeExtensionRuntimeEngine(
      suspend: { recorder.append("engine.suspend") },
      shutdown: {
        recorder.append("engine.shutdown.start")
        shutdownStarted.fulfill()
        allowShutdownToFinish.wait()
        recorder.append("engine.shutdown.finish")
      }
    )
    let ownership = FakeExtensionRuntimeOwnership(events: recorder)
    let lifecycle = ExtensionRuntimeLifecycle<FakeExtensionRuntimeEngine>(
      ownership: ownership,
      shutdownQueue: DispatchQueue(label: "ExtensionRuntimeLifecycleTests.shutdown"),
      suspend: { try $0.suspend() },
      shutdown: { $0.shutdown() }
    )

    _ = try lifecycle.startEngine { engine }
    try lifecycle.finishStartup()
    try lifecycle.stopForSuspension()

    wait(for: [shutdownStarted], timeout: 1)
    XCTAssertEqual(
      recorder.snapshot(),
      ["ownership.acquire", "engine.suspend", "ownership.release", "engine.shutdown.start"]
    )
    allowShutdownToFinish.signal()
  }

  func testStopRejectsOperationsImmediately() throws {
    let engine = FakeExtensionRuntimeEngine()
    let ownership = FakeExtensionRuntimeOwnership(events: LockedEventRecorder())
    let lifecycle = ExtensionRuntimeLifecycle<FakeExtensionRuntimeEngine>(
      ownership: ownership,
      suspend: { try $0.suspend() },
      shutdown: { $0.shutdown() }
    )

    _ = try lifecycle.startEngine { engine }
    try lifecycle.finishStartup()
    try lifecycle.stopForSuspension()

    XCTAssertThrowsError(try lifecycle.withOperation { "unexpected" }) { error in
      XCTAssertEqual(error as? ExtensionRuntimeLifecycleError, .sessionClosed)
    }
  }

  func testStopWaitsForAcceptedOperationBeforeReleasingOwnership() throws {
    let operationStarted = DispatchSemaphore(value: 0)
    let allowOperationToFinish = DispatchSemaphore(value: 0)
    let operationFinished = DispatchSemaphore(value: 0)
    let suspendFinished = DispatchSemaphore(value: 0)
    let stopFinished = DispatchSemaphore(value: 0)
    let recorder = LockedEventRecorder()
    let engine = FakeExtensionRuntimeEngine(
      suspend: {
        recorder.append("engine.suspend")
        suspendFinished.signal()
      }
    )
    let ownership = FakeExtensionRuntimeOwnership(events: recorder)
    let lifecycle = ExtensionRuntimeLifecycle<FakeExtensionRuntimeEngine>(
      ownership: ownership,
      suspend: { try $0.suspend() },
      shutdown: { $0.shutdown() }
    )

    _ = try lifecycle.startEngine { engine }
    try lifecycle.finishStartup()

    DispatchQueue.global().async {
      try? lifecycle.withOperation {
        operationStarted.signal()
        allowOperationToFinish.wait()
        recorder.append("operation.finish")
      }
      operationFinished.signal()
    }
    XCTAssertEqual(operationStarted.wait(timeout: .now() + 1), .success)

    DispatchQueue.global().async {
      try? lifecycle.stopForSuspension()
      stopFinished.signal()
    }
    XCTAssertEqual(suspendFinished.wait(timeout: .now() + 1), .success)
    XCTAssertEqual(stopFinished.wait(timeout: .now() + 0.1), .timedOut)
    XCTAssertFalse(recorder.snapshot().contains("ownership.release"))

    allowOperationToFinish.signal()
    XCTAssertEqual(operationFinished.wait(timeout: .now() + 1), .success)
    XCTAssertEqual(stopFinished.wait(timeout: .now() + 1), .success)
    XCTAssertEqual(
      Array(recorder.snapshot().prefix(4)),
      ["ownership.acquire", "engine.suspend", "operation.finish", "ownership.release"]
    )
  }

  func testStopDuringRecoverySuspendsEngineAndReleasesOwnership() throws {
    let recoveryStarted = expectation(description: "recovery started")
    let recoveryFinished = expectation(description: "recovery finished")
    let suspendFinished = expectation(description: "suspend finished")
    let recorder = LockedEventRecorder()
    let engine = FakeExtensionRuntimeEngine(
      suspend: {
        recorder.append("engine.suspend")
        suspendFinished.fulfill()
      }
    )
    let ownership = FakeExtensionRuntimeOwnership(events: recorder)
    let lifecycle = ExtensionRuntimeLifecycle<FakeExtensionRuntimeEngine>(
      ownership: ownership,
      suspend: { try $0.suspend() },
      shutdown: { $0.shutdown() }
    )

    _ = try lifecycle.startEngine { engine }
    let releaseRecovery = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
      recoveryStarted.fulfill()
      releaseRecovery.wait()
      recoveryFinished.fulfill()
    }
    wait(for: [recoveryStarted], timeout: 1)

    try lifecycle.stopForSuspension()
    releaseRecovery.signal()
    wait(for: [suspendFinished, recoveryFinished], timeout: 1)

    XCTAssertEqual(
      Array(recorder.snapshot().prefix(3)),
      ["ownership.acquire", "engine.suspend", "ownership.release"]
    )
    XCTAssertThrowsError(try lifecycle.ensureStartupCanFinish()) { error in
      XCTAssertEqual(error as? ExtensionRuntimeLifecycleError, .sessionClosed)
    }
  }

  func testNewLifecycleAcquiresOwnershipBeforeStartingEngine() throws {
    let recorder = LockedEventRecorder()
    let ownership = FakeExtensionRuntimeOwnership(events: recorder)
    let lifecycle = ExtensionRuntimeLifecycle<FakeExtensionRuntimeEngine>(
      ownership: ownership,
      suspend: { try $0.suspend() },
      shutdown: { $0.shutdown() }
    )

    _ = try lifecycle.startEngine {
      recorder.append("engine.start")
      return FakeExtensionRuntimeEngine()
    }

    XCTAssertEqual(recorder.snapshot(), ["ownership.acquire", "engine.start"])
  }
}

private final class LockedEventRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var events: [String] = []

  func append(_ event: String) {
    lock.withLock { events.append(event) }
  }

  func snapshot() -> [String] {
    lock.withLock { events }
  }
}

private final class FakeExtensionRuntimeOwnership: NativeRuntimeOwnership {
  private let events: LockedEventRecorder

  init(events: LockedEventRecorder) {
    self.events = events
  }

  func acquire(timeoutMs: UInt64) throws -> Bool {
    events.append("ownership.acquire")
    return true
  }

  func release() {
    events.append("ownership.release")
  }
}

private final class FakeExtensionRuntimeEngine: @unchecked Sendable {
  private let suspendAction: () throws -> Void
  private let shutdownAction: () -> Void

  init(
    suspend: @escaping () throws -> Void = {},
    shutdown: @escaping () -> Void = {}
  ) {
    suspendAction = suspend
    shutdownAction = shutdown
  }

  func suspend() throws {
    try suspendAction()
  }

  func shutdown() {
    shutdownAction()
  }
}
