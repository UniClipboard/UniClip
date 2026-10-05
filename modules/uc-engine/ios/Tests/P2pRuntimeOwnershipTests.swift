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

    try lifecycle.suspend(deadlineMs: 1_000)
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

  func testSuspendDeadlineExceededReleasesOwnershipOnlyAfterConfirmedSuspended() throws {
    // New contract from t-0176 (verified in real two-Engine E2E r15/r16): the
    // Engine's accepted suspend keeps running after our wait gives up
    // (fix 083fd0aa), and eventually reaches `.suspended` by itself. Releasing
    // the App Group runtime ownership flock on the mere wait timeout -- before
    // that confirmation -- let an extension start a second runtime while the
    // Engine was still mid-transition. We must poll for confirmed `.suspended`
    // instead of trusting the timeout alone.
    let released = expectation(description: "ownership released after confirmed suspension")
    let events = LockedEventLog()
    let engine = FakeOwnedEngine(events: { events.append($0) })
    engine.suspendError = NativeLifecycleError.deadlineExceeded
    let ownership = FakeRuntimeOwnership(events: { event in
      events.append(event)
      if event == "ownership.release" { released.fulfill() }
    })
    let lifecycle = RuntimeOwnedNativeLifecycle(
      engine: engine,
      ownership: ownership,
      suspensionPollInterval: .milliseconds(5),
      suspensionPollAttempts: 200
    )

    XCTAssertThrowsError(try lifecycle.suspend(deadlineMs: 10)) { error in
      XCTAssertEqual(error as? NativeLifecycleError, .deadlineExceeded)
    }
    XCTAssertFalse(
      events.snapshot().contains("ownership.release"),
      "must not release on a mere wait timeout"
    )

    // Simulate the Engine's own accepted suspend finishing on its own later.
    engine.state = .suspended

    wait(for: [released], timeout: 1)
  }

  func testResumeErrorReleasesOwnershipOnlyWhenEngineIsConfirmedStoppedOrSuspended() throws {
    // New contract from t-0176: UniFFI `resume` can time out and return an
    // error while the Engine's queued resume keeps running and later reaches
    // `.running`. Releasing ownership on any resume error let a second
    // runtime start while the first was still live. Only release once the
    // Engine confirms it is actually `.suspended`/`.stopped`; if the state
    // query itself fails, keep ownership (the safe default).
    let stillRunningEvents = LockedEventLog()
    let engineStillRunning = FakeOwnedEngine(events: { stillRunningEvents.append($0) })
    engineStillRunning.resumeError = NativeLifecycleError.runtimeOwnershipUnavailable
    engineStillRunning.state = .running
    let ownership1 = FakeRuntimeOwnership(events: { stillRunningEvents.append($0) })
    let lifecycle1 = RuntimeOwnedNativeLifecycle(engine: engineStillRunning, ownership: ownership1)

    XCTAssertThrowsError(try lifecycle1.resume())
    XCTAssertFalse(
      stillRunningEvents.snapshot().contains("ownership.release"),
      "must not release while the engine might still be running"
    )

    let suspendedEvents = LockedEventLog()
    let engineSuspended = FakeOwnedEngine(events: { suspendedEvents.append($0) })
    engineSuspended.resumeError = NativeLifecycleError.runtimeOwnershipUnavailable
    engineSuspended.state = .suspended
    let ownership2 = FakeRuntimeOwnership(events: { suspendedEvents.append($0) })
    let lifecycle2 = RuntimeOwnedNativeLifecycle(engine: engineSuspended, ownership: ownership2)

    XCTAssertThrowsError(try lifecycle2.resume())
    XCTAssertTrue(
      suspendedEvents.snapshot().contains("ownership.release"),
      "must release once the engine confirms it is no longer running"
    )
  }

  func testStaleSuspensionWatcherDoesNotReleaseOwnershipAfterAResumeTookOver() throws {
    // Raised during t-0176's review: the confirmed-suspended watcher runs in
    // the background and can outlive the attempt that started it. If the app
    // resumes before the watcher ever fires, and a later, unrelated
    // background cycle happens to look "suspended" to a stale poll, the old
    // watcher must not release ownership a newer transition already owns.
    let events = LockedEventLog()
    let engine = FakeOwnedEngine(events: { events.append($0) })
    engine.suspendError = NativeLifecycleError.deadlineExceeded
    let ownership = FakeRuntimeOwnership(events: { events.append($0) })
    let lifecycle = RuntimeOwnedNativeLifecycle(
      engine: engine,
      ownership: ownership,
      suspensionPollInterval: .milliseconds(5),
      suspensionPollAttempts: 200
    )

    XCTAssertThrowsError(try lifecycle.suspend(deadlineMs: 10))
    XCTAssertFalse(events.snapshot().contains("ownership.release"))

    // What the stale watcher is polling for -- set as if the superseded
    // suspend attempt had just been confirmed -- then a resume takes over
    // before the watcher ever observes it.
    engine.state = .suspended
    try lifecycle.resume()
    XCTAssertTrue(events.snapshot().contains("ownership.acquire"), "resume must reacquire ownership")
    XCTAssertEqual(engine.state, .running, "a successful resume must leave the engine running")

    // Give the stale watcher, still polling in the background, a real chance
    // to fire and wrongly release the ownership this resume just reacquired.
    Thread.sleep(forTimeInterval: 0.1)
    XCTAssertEqual(
      events.snapshot().filter { $0 == "ownership.release" }.count, 0,
      "a confirmation from the superseded suspend attempt must not release ownership a later resume already reacquired"
    )
  }

  func testRealFlockStaysHeldForeverWithoutTheConfirmationWatcherThenIsFreedWithIt() throws {
    // Cross-layer E2E, not an isolated fake: this drives the real
    // `P2pRuntimeOwnership` flock (an actual file lock in a real temp
    // directory, probed from a second, independent instance exactly as a
    // Keyboard/Share extension would) through the real `RuntimeOwnedNativeLifecycle`.
    // Only the Rust Engine itself is a controllable stand-in -- its own real
    // behaviour (vault lease release, Quiesced->Suspended continuation after
    // 083fd0aa) is independently verified by t-0176's Rust-side E2E
    // (r12/r13/r15/r16), not re-proven here.
    //
    // Preserves the original failure mode: with the confirmation watcher
    // disabled (`suspensionPollAttempts: 0`, i.e. this class's behavior
    // before this fix), the flock stays held forever even after the Engine
    // reaches `.suspended` on its own -- nothing was ever watching for it.
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }

    // --- Pre-fix shape: watcher disabled ---
    do {
      let mainApplication = P2pRuntimeOwnership(lockURL: lockURL)
      let engine = FakeOwnedEngine(events: { _ in })
      engine.suspendError = NativeLifecycleError.deadlineExceeded
      let lifecycle = RuntimeOwnedNativeLifecycle(
        engine: engine,
        ownership: mainApplication,
        suspensionPollAttempts: 0 // the original failure mode
      )
      XCTAssertTrue(try mainApplication.acquire(timeoutMs: 0))
      XCTAssertThrowsError(try lifecycle.suspend(deadlineMs: 10))

      // The Engine confirms Suspended on its own (083fd0aa) ...
      engine.state = .suspended
      Thread.sleep(forTimeInterval: 0.05)

      // ... but with no watcher, an independent probe (an extension) still
      // cannot acquire the real flock. This is the preserved original failure.
      let extensionProbe = P2pRuntimeOwnership(lockURL: lockURL)
      XCTAssertFalse(
        try extensionProbe.acquire(timeoutMs: 0),
        "ORIGINAL FAILURE (expected here): without the watcher, the real flock stays held forever"
      )
    }

    // --- Fixed shape: watcher enabled (this class's actual default) ---
    do {
      let mainApplication = P2pRuntimeOwnership(lockURL: lockURL)
      let engine = FakeOwnedEngine(events: { _ in })
      engine.suspendError = NativeLifecycleError.deadlineExceeded
      let released = expectation(description: "real flock released after confirmed suspension")
      let lifecycle = RuntimeOwnedNativeLifecycle(
        engine: engine,
        ownership: mainApplication,
        suspensionPollInterval: .milliseconds(5),
        suspensionPollAttempts: 200
      )
      XCTAssertTrue(try mainApplication.acquire(timeoutMs: 0))
      XCTAssertThrowsError(try lifecycle.suspend(deadlineMs: 10))

      engine.state = .suspended

      // Poll the real flock from an independent instance, exactly as an
      // extension would, until the watcher releases it.
      let probeQueue = DispatchQueue(label: "extension-probe")
      @Sendable func probe() {
        probeQueue.asyncAfter(deadline: .now() + .milliseconds(5)) {
          let extensionProbe = P2pRuntimeOwnership(lockURL: lockURL)
          if (try? extensionProbe.acquire(timeoutMs: 0)) == true {
            extensionProbe.release()
            released.fulfill()
          } else {
            probe()
          }
        }
      }
      probe()
      wait(for: [released], timeout: 2)
    }
  }

  func testGenerationCheckAndRealFlockReleaseAreAtomicAgainstAConcurrentResume() throws {
    // t-0176's second review (reading the diff, not reproducing a flaky
    // failure) found that the watcher's generation check and its
    // `ownership.release()` were two separate steps, leaving a real window
    // for a concurrent `resume()` to land in between: bump the generation,
    // have its own `acquire()` be a same-process no-op (the real flock is
    // still held), and reach `Running` -- after which the stale watcher
    // would still release the real flock out from under it.
    //
    // Failure sequence this reproduces against real objects, planned before
    // writing the test:
    //   1. suspend() fails deadline-exceeded at generation N; watcher scheduled.
    //   2. Watcher's poll reads `.suspended` and passes the generation check.
    //   3. [race window[ before `ownership.release()`, a concurrent resume()
    //      bumps the generation to N+1, treats `acquire()` as a no-op
    //      (already held), and reaches Running.
    //   4. Watcher releases the real flock anyway -> Engine Running with no
    //      host flock -> an independent probe (an extension) can acquire it.
    //
    // This does not use `FakeRuntimeOwnership`: it drives the real
    // `P2pRuntimeOwnership` flock (an actual file lock), and proves the fix
    // by forcing step 3's `resume()` to attempt step 3 *while* the watcher is
    // deliberately held inside its locked section (via a test-only hook) --
    // if the fix is correct, `resume()` must actually block on
    // `generationLock` (not merely "not happen to run fast enough"), and
    // once it does, an independent probe must still find the real flock
    // held throughout, never transiently free.
    let lockURL = try makeLockURL()
    defer { try? FileManager.default.removeItem(at: lockURL.deletingLastPathComponent()) }
    let mainApplication = P2pRuntimeOwnership(lockURL: lockURL)
    let engine = FakeOwnedEngine(events: { _ in })
    engine.suspendError = NativeLifecycleError.deadlineExceeded
    let lifecycle = RuntimeOwnedNativeLifecycle(
      engine: engine,
      ownership: mainApplication,
      suspensionPollInterval: .milliseconds(5),
      suspensionPollAttempts: 200
    )

    XCTAssertTrue(try mainApplication.acquire(timeoutMs: 0))
    XCTAssertThrowsError(try lifecycle.suspend(deadlineMs: 10))
    engine.state = .suspended

    let watcherInsideLock = DispatchSemaphore(value: 0)
    let letWatcherFinish = DispatchSemaphore(value: 0)
    lifecycle.releaseIfCurrentHookForTesting = {
      watcherInsideLock.signal()
      letWatcherFinish.wait()
    }

    // Wait until the watcher's poll has passed the generation check and is
    // parked, by construction, still holding `generationLock`.
    watcherInsideLock.wait()

    // An independent probe must find the real flock still held while the
    // watcher is parked mid-release-decision.
    let probeDuringHold = P2pRuntimeOwnership(lockURL: lockURL)
    XCTAssertFalse(try probeDuringHold.acquire(timeoutMs: 0), "the real flock must still be held here")

    // Attempt the exact race: resume() concurrently, while the watcher holds
    // generationLock. If `beginTransition` and this locked section share the
    // same lock (the fix), resume() must genuinely block, not race ahead.
    let resumeReachedRunning = LockedFlag()
    let resumeThread = Thread {
      try? lifecycle.resume()
      resumeReachedRunning.set(true)
    }
    resumeThread.start()

    Thread.sleep(forTimeInterval: 0.1)
    XCTAssertFalse(
      resumeReachedRunning.get(),
      "resume() must actually block on generationLock while the watcher holds it, not race ahead of it"
    )
    // No lock-ordering hazard: the watcher's held section never itself waits
    // on the Engine or on `resumeThread` -- only `resumeThread` waits on the
    // lock the watcher holds, so releasing the watcher is always sufficient
    // to make progress (confirmed next).

    letWatcherFinish.signal()
    for _ in 0..<200 {
      if resumeReachedRunning.get() { break }
      Thread.sleep(forTimeInterval: 0.01)
    }
    XCTAssertTrue(resumeReachedRunning.get(), "resume() must complete once the watcher's lock is released")
    XCTAssertEqual(engine.state, .running)

    // The real flock must be held now (by `mainApplication`, via resume's
    // real re-acquire -- the watcher's release and resume's re-acquire are
    // serialized by the same lock, so this is never transiently free).
    let probeAfterResume = P2pRuntimeOwnership(lockURL: lockURL)
    XCTAssertFalse(
      try probeAfterResume.acquire(timeoutMs: 0),
      "the real flock must be held by the resumed engine's ownership, not transiently free"
    )
  }

  private func makeLockURL() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-ownership-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("runtime.lock")
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

private final class LockedEventLog: @unchecked Sendable {
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
  func notifyForegroundOpportunity() throws {}
  var state: NativeEngineLifecycleState = .running
  var suspendError: Error?
  var resumeError: Error?
  private(set) var resumeCalls = 0
  private let events: (String) -> Void

  init(events: @escaping (String) -> Void) {
    self.events = events
  }

  func recoverSession() throws -> NativeSessionRecovery {
    NativeSessionRecovery(unlocked: true, resumed: true)
  }

  func lifecycleState() throws -> NativeEngineLifecycleState { state }

  func suspend(deadlineMs _: UInt64?) throws {
    events("engine.suspend")
    if let suspendError { throw suspendError }
  }

  func resume() throws {
    resumeCalls += 1
    events("engine.resume")
    if let resumeError { throw resumeError }
    state = .running
  }
}
