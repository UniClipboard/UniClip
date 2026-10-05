import Foundation
#if canImport(UcEngineCore)
internal import UcEngineCore
#endif

final class NativeEngineRegistry<Engine: AnyObject> {
  private let lock = NSLock()
  private var engine: Engine?

  func installBeforePreparing(
    _ candidate: Engine,
    prepare: (Engine) throws -> Void
  ) rethrows -> Bool {
    let installed = lock.withLock {
      guard engine == nil else { return false }
      engine = candidate
      return true
    }
    guard installed else { return false }

    do {
      try prepare(candidate)
      return true
    } catch {
      remove(candidate)
      throw error
    }
  }

  func current() -> Engine? {
    lock.withLock { engine }
  }

  func take() -> Engine? {
    lock.withLock {
      defer { engine = nil }
      return engine
    }
  }

  private func remove(_ candidate: Engine) {
    lock.withLock {
      if engine === candidate {
        engine = nil
      }
    }
  }
}

enum NativeEngineLifecycleState: Equatable {
  case running
  case quiescing
  case quiesced
  case suspended
  case shuttingDown
  case stopped
}

struct NativeSessionRecovery: Equatable {
  let unlocked: Bool
  let resumed: Bool
}

protocol NativeEngineLifecycle {
  var isStartupLifecycle: Bool { get }
  func recoverSession() throws -> NativeSessionRecovery
  func lifecycleState() throws -> NativeEngineLifecycleState
  func suspend(deadlineMs: UInt64?) throws
  func resume() throws
  func notifyForegroundOpportunity() throws
}

extension NativeEngineLifecycle {
  var isStartupLifecycle: Bool { false }
}

enum NativeLifecycleError: Error, Equatable {
  case incompleteRecovery
  case runtimeOwnershipUnavailable
  /// A `suspend` attempt ran out of its deadline before the Engine reported
  /// completion. The Engine stays `.quiesced`, not `.suspended`, and may
  /// still be holding a lock; this does not mean the lock was released.
  case deadlineExceeded
}

final class RuntimeOwnedNativeLifecycle: NativeEngineLifecycle {
  private let engine: any NativeEngineLifecycle
  private let ownership: any NativeRuntimeOwnership
  private let acquisitionTimeoutMs: UInt64
  private let suspensionPollInterval: DispatchTimeInterval
  private let suspensionPollAttempts: Int
  private let pollQueue: DispatchQueue
  private let generationLock = NSLock()
  private var generation = 0
  /// Test-only seam: when set, called from inside `releaseIfCurrent`'s locked
  /// section, after the generation check passes and before `ownership.release()`.
  /// Lets a test hold that critical section open on purpose to prove, by
  /// forcing a concurrent `resume()` to actually block on `generationLock`,
  /// that the check and the release cannot be interleaved by anything else --
  /// not by observing that a race merely didn't happen to fire. `nil` in
  /// production; zero behavior change.
  var releaseIfCurrentHookForTesting: (() -> Void)?

  init(
    engine: any NativeEngineLifecycle,
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000,
    // Contract from t-0176 (engine fix 083fd0aa): an accepted suspend that
    // misses the caller's deadline keeps running and reaches `.suspended` by
    // itself. We confirm that by polling `lifecycleState()` rather than the
    // UniFFI event stream, because that stream already has a single JS-side
    // consumer (`nextEvent`) and a second native subscriber would race it for
    // the same events. 500ms x 120 is a 60s pragmatic ceiling: giving up just
    // leaves ownership held, which is always the safe direction.
    suspensionPollInterval: DispatchTimeInterval = .milliseconds(500),
    suspensionPollAttempts: Int = 120,
    pollQueue: DispatchQueue = DispatchQueue(label: "app.uniclipboard.engine-ownership-poll", qos: .utility)
  ) {
    self.engine = engine
    self.ownership = ownership
    self.acquisitionTimeoutMs = acquisitionTimeoutMs
    self.suspensionPollInterval = suspensionPollInterval
    self.suspensionPollAttempts = suspensionPollAttempts
    self.pollQueue = pollQueue
  }

  func recoverSession() throws -> NativeSessionRecovery {
    try engine.recoverSession()
  }

  func lifecycleState() throws -> NativeEngineLifecycleState {
    try engine.lifecycleState()
  }

  func suspend(deadlineMs: UInt64?) throws {
    let generation = beginTransition()
    do {
      try engine.suspend(deadlineMs: deadlineMs)
      ownership.release()
    } catch NativeLifecycleError.deadlineExceeded {
      // Our wait gave up; the Engine's own accepted suspend did not. Releasing
      // the App Group runtime ownership flock here -- before the Engine is
      // confirmed `.suspended` -- let an extension start a second runtime
      // while the first was still mid-transition (verified in t-0176's E2E
      // r15/r16). Keep it and watch for the real confirmation instead.
      watchForConfirmedSuspension(generation: generation, attemptsLeft: suspensionPollAttempts)
      throw NativeLifecycleError.deadlineExceeded
    }
  }

  /// A new `suspend` or `resume` call invalidates any watcher left running by
  /// an earlier, superseded transition -- otherwise a late confirmation from
  /// the old attempt could release ownership a later `resume` already
  /// reacquired, or that a later, unrelated background cycle's suspend is
  /// relying on.
  private func beginTransition() -> Int {
    generationLock.withLock {
      generation += 1
      return generation
    }
  }

  private func isCurrent(_ generation: Int) -> Bool {
    generationLock.withLock { self.generation == generation }
  }

  /// Releases ownership only if `generation` is still current, as one atomic
  /// step under the same lock `beginTransition` uses. Caught by t-0176's
  /// review: checking `isCurrent` and then calling `release()` as two
  /// separate statements left a real (if narrow) window for a concurrent
  /// `resume()` to land in between -- incrementing the generation and making
  /// its own `acquire()` a same-process no-op -- so the stale watcher could
  /// still release the ownership that resume had just (implicitly) reacquired,
  /// leaving the Engine `Running` without the host flock.
  private func releaseIfCurrent(_ generation: Int) {
    generationLock.withLock {
      guard self.generation == generation else { return }
      releaseIfCurrentHookForTesting?()
      ownership.release()
    }
  }

  private func watchForConfirmedSuspension(generation: Int, attemptsLeft: Int) {
    guard attemptsLeft > 0 else { return }
    pollQueue.asyncAfter(deadline: .now() + suspensionPollInterval) { [weak self] in
      guard let self, self.isCurrent(generation) else { return }
      guard let state = try? self.engine.lifecycleState() else {
        self.watchForConfirmedSuspension(generation: generation, attemptsLeft: attemptsLeft - 1)
        return
      }
      if state == .suspended {
        self.releaseIfCurrent(generation)
        return
      }
      self.watchForConfirmedSuspension(generation: generation, attemptsLeft: attemptsLeft - 1)
    }
  }

  func resume() throws {
    _ = beginTransition()
    guard try ownership.acquire(timeoutMs: acquisitionTimeoutMs) else {
      throw NativeLifecycleError.runtimeOwnershipUnavailable
    }
    do {
      try engine.resume()
    } catch {
      // Contract from t-0176: UniFFI `resume` can time out and return an
      // error while the Engine's own queued resume keeps running and later
      // reaches `.running`. Releasing ownership on any resume error let a
      // second runtime start while the first was still live. Only release
      // once the Engine confirms it is actually done; if the state query
      // itself fails, keep ownership -- the safe default.
      if let state = try? engine.lifecycleState(), state == .suspended || state == .stopped {
        ownership.release()
      }
      throw error
    }
  }
  func notifyForegroundOpportunity() throws {
    try engine.notifyForegroundOpportunity()
  }

}

final class NativeLifecycleHost {
  private let report: (Error) -> Void
  private let transitionLock = NSLock()

  init(report: @escaping (Error) -> Void) {
    self.report = report
  }

  func prepare(_ engine: any NativeEngineLifecycle) throws {
    let recovery = try engine.recoverSession()
    if recovery.unlocked && !recovery.resumed {
      throw NativeLifecycleError.incompleteRecovery
    }
  }

  /// The smallest real background time, in milliseconds, worth attempting
  /// another suspend for. Below this there isn't enough of the UIKit-granted
  /// budget left for a further round trip, so one more attempt would just
  /// race the OS suspending the process mid-call. This is a best-effort
  /// cutoff, not a safety guarantee: no margin can promise iOS will not
  /// terminate the process while a lock is still held.
  private static let minimumRetryBudgetMs: UInt64 = 250

  func enterBackground(_ engine: (any NativeEngineLifecycle)?, remainingTimeMs: @escaping () -> UInt64?) -> Bool {
    guard let engine else { return true }
    do {
      try suspendIfNeeded(engine, remainingTimeMs: remainingTimeMs)
      return true
    } catch {
      report(error)
      return false
    }
  }

  func enterForeground(_ engine: (any NativeEngineLifecycle)?) {
    guard let engine else { return }
    do {
      try resumeIfNeeded(engine)
      if try engine.lifecycleState() == .running { try engine.notifyForegroundOpportunity() }
    } catch {
      report(error)
    }
  }

  func suspendIfNeeded(_ engine: any NativeEngineLifecycle, remainingTimeMs: () -> UInt64?) throws {
    try transitionLock.withLock {
      if engine.isStartupLifecycle {
        try engine.suspend(deadlineMs: remainingTimeMs())
        return
      }
      switch try engine.lifecycleState() {
      case .running, .quiesced:
        try suspendRetryingWhileBudgetRemains(engine, remainingTimeMs: remainingTimeMs)
      case .quiescing, .suspended, .shuttingDown, .stopped:
        return
      }
    }
  }

  /// Retries a deadline-exceeded suspend as long as the system still reports
  /// real background time left, reading that time fresh before every attempt
  /// instead of reusing a value captured before this call was even
  /// scheduled. This narrows, but does not close, the window in which the
  /// process can be suspended while the Engine still holds a lock: the
  /// Engine's own contract does not shorten an in-flight transaction, cancel
  /// it, or guarantee completion within any budget.
  private func suspendRetryingWhileBudgetRemains(
    _ engine: any NativeEngineLifecycle,
    remainingTimeMs: () -> UInt64?
  ) throws {
    while true {
      do {
        try engine.suspend(deadlineMs: remainingTimeMs())
        return
      } catch NativeLifecycleError.deadlineExceeded {
        guard let remaining = remainingTimeMs(), remaining > Self.minimumRetryBudgetMs else {
          throw NativeLifecycleError.deadlineExceeded
        }
      }
    }
  }

  func resumeIfNeeded(_ engine: any NativeEngineLifecycle) throws {
    try transitionLock.withLock {
      if engine.isStartupLifecycle {
        try engine.resume()
        return
      }
      switch try engine.lifecycleState() {
      case .suspended, .quiesced:
        try engine.resume()
      case .running, .quiescing, .shuttingDown, .stopped:
        return
      }
    }
  }
}

final class NativeLifecycleTransitionCoordinator {
  typealias BeginBackgroundActivity = () -> any NativeBackgroundActivity

  private let lifecycle: NativeLifecycleHost
  private let queue: DispatchQueue
  private let beginBackgroundActivity: BeginBackgroundActivity

  init(
    lifecycle: NativeLifecycleHost,
    queue: DispatchQueue,
    beginBackgroundActivity: @escaping BeginBackgroundActivity
  ) {
    self.lifecycle = lifecycle
    self.queue = queue
    self.beginBackgroundActivity = beginBackgroundActivity
  }

  func enterBackground(_ engine: (any NativeEngineLifecycle)?) {
    let activity = beginBackgroundActivity()
    let transition = NativeLifecycleTransition(
      lifecycle: lifecycle,
      engine: engine,
      // Read live, not once at dispatch time: this value is consulted again
      // on every retry, and must reflect the system's actual remaining
      // background time at the moment of each attempt, not a value that was
      // already stale by the time this queue got scheduled.
      remainingTimeMs: { activity.remainingTimeMs },
      finish: { activity.end() }
    )
    queue.async { transition.enterBackground() }
  }

  func enterForeground(_ engine: (any NativeEngineLifecycle)?) {
    let transition = NativeLifecycleTransition(
      lifecycle: lifecycle,
      engine: engine,
      remainingTimeMs: { 0 },
      finish: {}
    )
    queue.async { transition.enterForeground() }
  }
}

private final class NativeLifecycleTransition: @unchecked Sendable {
  private let lifecycle: NativeLifecycleHost
  private let engine: (any NativeEngineLifecycle)?
  private let remainingTimeMs: @Sendable () -> UInt64?
  private let finish: @Sendable () -> Void

  init(
    lifecycle: NativeLifecycleHost,
    engine: (any NativeEngineLifecycle)?,
    remainingTimeMs: @escaping @Sendable () -> UInt64?,
    finish: @escaping @Sendable () -> Void
  ) {
    self.lifecycle = lifecycle
    self.engine = engine
    self.remainingTimeMs = remainingTimeMs
    self.finish = finish
  }

  func enterBackground() {
    // Corrected design (flagged during review): only end the background task
    // on success. The in-flight Engine operation that caused a
    // deadline-exceeded failure keeps running in its own detached task after
    // this call returns — our wait gave up, but the transaction/lock release
    // did not stop. Calling `endBackgroundTask` immediately on failure would
    // surrender whatever real time iOS already granted, right when that
    // detached operation most needs it to finish and release the lock before
    // suspension. On failure we deliberately leave the task running: it is
    // still ended reliably, either by a later successful transition or by
    // `UIKitBackgroundActivity.expire()` when the OS's own grant truly runs
    // out — never left open indefinitely.
    if lifecycle.enterBackground(engine, remainingTimeMs: remainingTimeMs) {
      finish()
    }
  }

  func enterForeground() {
    lifecycle.enterForeground(engine)
    finish()
  }
}

protocol NativeBackgroundActivity: AnyObject, Sendable {
  var remainingTimeMs: UInt64? { get }
  func end()
}

enum NativeBackgroundDeadline {
  private static let completionMargin: TimeInterval = 0.1

  static func remainingTimeMs(systemRemainingSeconds: TimeInterval) -> UInt64? {
    guard systemRemainingSeconds.isFinite else { return nil }
    let milliseconds = max(0, systemRemainingSeconds - completionMargin) * 1_000
    guard milliseconds.isFinite, milliseconds < Double(UInt64.max) else { return nil }
    return UInt64(milliseconds)
  }
}
