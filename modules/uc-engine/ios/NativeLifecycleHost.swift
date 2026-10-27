import Foundation
#if canImport(AppGroupStore)
internal import class AppGroupStore.SharedStorageAccess
#elseif canImport(SharedStorageAccess)
import SharedStorageAccess
#endif
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
  func suspendOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome
  func shutdownOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome
  func prepareRelease(engineReleased: @escaping () -> Void) -> Int
  func invalidateReleaseForForeground()
  func confirmFile(_ owner: NativeReleaseFileOwner, generation: Int)
  func resume() throws
  func notifyForegroundOpportunity() throws
}

extension NativeEngineLifecycle {
  var isStartupLifecycle: Bool { false }
  func suspendOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome {
    do { try suspend(deadlineMs: deadlineMs); return .released(error: nil) }
    catch let outcome as NativeReleaseOutcome { return outcome }
    catch { return .failed(error: error) }
  }
  func shutdownOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome {
    .failed(error: NativeLifecycleError.releaseUnconfirmed)
  }
  func prepareRelease(engineReleased: @escaping () -> Void) -> Int { 0 }
  func invalidateReleaseForForeground() {}
  func confirmFile(_ owner: NativeReleaseFileOwner, generation: Int) {}
}

/// No Engine object/result is available. Do not fabricate an Engine state or receipt.
final class NativeUnconfirmedLifecycle: NativeEngineLifecycle {
  var isStartupLifecycle: Bool { true }
  func recoverSession() throws -> NativeSessionRecovery { throw NativeLifecycleError.releaseUnconfirmed }
  func lifecycleState() throws -> NativeEngineLifecycleState { throw NativeLifecycleError.releaseUnconfirmed }
  func suspend(deadlineMs: UInt64?) throws { throw NativeLifecycleError.releaseUnconfirmed }
  func resume() throws { throw NativeLifecycleError.releaseUnconfirmed }
  func notifyForegroundOpportunity() throws { throw NativeLifecycleError.releaseUnconfirmed }
}

enum NativeLifecycleError: Error, Equatable {
  case incompleteRecovery
  case runtimeOwnershipUnavailable
  /// The complete action remains Pending after this caller's wait.
  /// This result certifies neither release nor a particular lock state.
  case deadlineExceeded
  case transitionInProgress
  case releaseUnconfirmed
}

final class RuntimeOwnedNativeLifecycle: NativeEngineLifecycle {
  private let engine: any NativeEngineLifecycle
  private let ownership: any NativeRuntimeOwnership
  private let acquisitionTimeoutMs: UInt64
  private let report: (Error) -> Void
  var releaseIfCurrentHookForTesting: (() -> Void)?
  private lazy var owner = NativeReleaseOwner(
    requiredFiles: [.nativeFiles, .hostFiles, .processObservability],
    storageAccess: .shared,
    perform: { [engine] action, deadline in
      switch action {
      case .suspend: return engine.suspendOutcome(deadlineMs: deadline)
      case .shutdown: return engine.shutdownOutcome(deadlineMs: deadline)
      }
    }, release: { [weak self, ownership] in
      self?.releaseIfCurrentHookForTesting?()
      ownership.release()
    }, report: report)

  init(
    engine: any NativeEngineLifecycle,
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000,
    // Legacy fixture labels remain source-compatible; outcomes replace state polling.
    suspensionPollInterval: DispatchTimeInterval = .milliseconds(500),
    suspensionPollAttempts: Int = 120,
    pollQueue: DispatchQueue = DispatchQueue(label: "app.uniclipboard.engine-ownership-poll", qos: .utility),
    report: @escaping (Error) -> Void = { _ in }
  ) {
    self.engine = engine
    self.ownership = ownership
    self.acquisitionTimeoutMs = acquisitionTimeoutMs
    self.report = report
    _ = owner
  }

  func recoverSession() throws -> NativeSessionRecovery { try engine.recoverSession() }
  func lifecycleState() throws -> NativeEngineLifecycleState { try engine.lifecycleState() }

  func prepareRelease(engineReleased: @escaping () -> Void) -> Int {
    let generation = owner.prepare(action: .suspend)
    owner.observeEngineRelease(generation: generation, completion: engineReleased)
    return generation
  }

  func invalidateReleaseForForeground() { owner.invalidateForForeground() }

  func confirmFile(_ file: NativeReleaseFileOwner, generation: Int) {
    owner.confirm(file, generation: generation)
  }

  func suspendOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome {
    if !owner.hasAction { _ = owner.prepare(action: .suspend) }
    return owner.attempt(deadlineMs: min(deadlineMs, 1_000))
  }

  func shutdownOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome {
    if !owner.isFinalAction { _ = owner.prepare(action: .shutdown) }
    return owner.attempt(deadlineMs: deadlineMs)
  }

  func suspend(deadlineMs: UInt64?) throws {
    try consume(suspendOutcome(deadlineMs: deadlineMs ?? 1_000))
    if !owner.isReleased { throw NativeLifecycleError.releaseUnconfirmed }
  }

  func shutdown(deadlineMs: UInt64) throws {
    try consume(shutdownOutcome(deadlineMs: deadlineMs))
    // Engine completion is deliberately insufficient for whole-owner release.
    if !owner.isReleased { throw NativeLifecycleError.releaseUnconfirmed }
  }

  func prepareFinalRelease() { _ = owner.prepare(action: .shutdown) }

  private func consume(_ result: NativeReleaseOutcome) throws {
    switch result {
    case .pending: throw NativeLifecycleError.deadlineExceeded
    case .released: return
    case .failed(let error): throw error
    }
  }

  func resume() throws {
    if let error = owner.failure { throw error }
    guard !owner.isFinalAction else { throw NativeLifecycleError.transitionInProgress }
    owner.invalidateForForeground()
    guard try ownership.acquire(timeoutMs: acquisitionTimeoutMs) else {
      throw NativeLifecycleError.runtimeOwnershipUnavailable
    }
    // An arbitrary resume error cannot certify release of any owned resource.
    try engine.resume()
  }

  func notifyForegroundOpportunity() throws { try engine.notifyForegroundOpportunity() }
}

final class NativeLifecycleHost {
  private let report: (Error) -> Void
  private let flushObservability: () -> Void
  private let transitionLock = NSLock()

  init(
    report: @escaping (Error) -> Void,
    flushObservability: @escaping () -> Void = {}
  ) {
    self.report = report
    self.flushObservability = flushObservability
  }

  func prepare(_ engine: any NativeEngineLifecycle) throws {
    let recovery = try engine.recoverSession()
    if recovery.unlocked && !recovery.resumed {
      throw NativeLifecycleError.incompleteRecovery
    }
  }

  func enterBackground(_ engine: (any NativeEngineLifecycle)?, remainingTimeMs: @escaping () -> UInt64?) -> Bool {
    // The process can be suspended or killed while in the background, so buffered
    // log records are written out whether or not the suspend succeeded.
    defer { flushObservability() }
    guard let engine else { return true }
    do {
      try suspendIfNeeded(engine, remainingTimeMs: remainingTimeMs)
      return true
    } catch {
      report(error)
      return false
    }
  }

  @discardableResult
  func enterForeground(_ engine: (any NativeEngineLifecycle)?) -> Error? {
    guard let engine else { return nil }
    do {
      try resumeIfNeeded(engine)
      if try engine.lifecycleState() == .running { try engine.notifyForegroundOpportunity() }
      return nil
    } catch {
      report(error)
      return error
    }
  }

  func suspendIfNeeded(_ engine: any NativeEngineLifecycle, remainingTimeMs: () -> UInt64?) throws {
    try transitionLock.withLock {
      // The complete action handles Suspended, Stopped and late accepted work.
      // Lifecycle states do not certify ownership release.
      if engine.isStartupLifecycle {
        try engine.suspend(deadlineMs: remainingTimeMs())
        throw NativeLifecycleError.releaseUnconfirmed
      }
      try engine.suspend(deadlineMs: remainingTimeMs())
    }
  }

  func resumeIfNeeded(_ engine: any NativeEngineLifecycle) throws {
    try transitionLock.withLock {
      if engine.isStartupLifecycle {
        try engine.resume()
        return
      }
      switch try engine.lifecycleState() {
      case .suspended, .quiesced, .quiescing:
        try engine.resume()
      case .running:
        return
      case .shuttingDown, .stopped:
        throw NativeLifecycleError.transitionInProgress
      }
    }
  }
}

/// Owners outside the Engine whose App Group files must be closed before the
/// process may be suspended: the JS history database. The owner closes them
/// itself once its borrowed connections and in-flight writes finished; native
/// only keeps background time open until the owner reports back, and never
/// closes anything on its behalf.
final class NativeHostSuspension: @unchecked Sendable {
  private let lock = NSLock()
  private let send: @Sendable (_ phase: String, _ transitionId: Int) -> Void
  private var participating = false
  private var requiresRelease = false
  private var pending: (transitionId: Int, finish: () -> Void)?

  init(send: @escaping @Sendable (_ phase: String, _ transitionId: Int) -> Void) {
    self.send = send
  }

  /// Removing a listener does not prove that its files closed.
  func setParticipating(_ value: Bool) {
    lock.withLock {
      participating = value
      if value { requiresRelease = true }
    }
  }

  /// Asks the owner to close its files; `finish` runs once it reports back.
  func suspend(transitionId: Int, finish: @escaping () -> Void) {
    let (asked, waiting) = lock.withLock { () -> (Bool, Bool) in
      let earlier = pending?.finish
      let waiting = participating || requiresRelease
      pending = waiting ? (transitionId, { earlier?(); finish() }) : nil
      return (participating, waiting)
    }
    if asked { send("suspend", transitionId) }
    if !waiting { finish() }
  }

  /// The owner's report for one transition. A late report for an earlier
  /// transition must not finish a later one.
  @discardableResult
  func complete(transitionId: Int, released: Bool = true) -> Bool {
    guard released else { return false }
    let finish = lock.withLock { () -> (() -> Void)? in
      guard let current = pending, current.transitionId == transitionId else { return nil }
      pending = nil
      requiresRelease = false
      return current.finish
    }
    finish?()
    return finish != nil
  }

  /// Back in the foreground the process cannot be suspended, so a close cut
  /// short by this resume no longer needs to hold background time.
  func resume(transitionId: Int) {
    let (finish, asked) = lock.withLock { () -> ((() -> Void)?, Bool) in
      defer { pending = nil }
      if participating { requiresRelease = true }
      return (pending?.finish, participating)
    }
    finish?()
    if asked { send("resume", transitionId) }
  }
}

/// Reports one background transition right before its activity ends: which
/// owners still had App Group files open (`pending`), and whether the system's
/// grant expired first. Nothing may write after the activity ended.
typealias NativeBackgroundReport = (_ pending: [NativeDiagnosticOwner], _ expired: Bool) -> Void

final class NativeLifecycleTransitionCoordinator {
  typealias BeginBackgroundActivity = () -> any NativeBackgroundActivity

  private let lifecycle: NativeLifecycleHost
  private let queue: DispatchQueue
  private let beginBackgroundActivity: BeginBackgroundActivity
  private let hostSuspension: NativeHostSuspension?
  private let storageAccess: SharedStorageAccess
  private let reportBackground: NativeBackgroundReport
  private let lock = NSLock()
  private var transitionId = 0
  private var lifecycleGeneration = 0
  private var preparedActivity: (any NativeBackgroundActivity)?

  init(
    lifecycle: NativeLifecycleHost,
    queue: DispatchQueue,
    beginBackgroundActivity: @escaping BeginBackgroundActivity,
    hostSuspension: NativeHostSuspension? = nil,
    reportBackground: @escaping NativeBackgroundReport = { _, _ in },
    storageAccess: SharedStorageAccess = .shared
  ) {
    self.lifecycle = lifecycle
    self.queue = queue
    self.beginBackgroundActivity = beginBackgroundActivity
    self.hostSuspension = hostSuspension
    self.reportBackground = reportBackground
    self.storageAccess = storageAccess
  }

  /// Apple: begin the task "preferably before your app actually enters the
  /// background". Resign-active also fires for Control Center and the app
  /// switcher, so this only takes the assertion; files close on background.
  func prepareForBackground() {
    lock.withLock {
      if preparedActivity == nil { preparedActivity = beginBackgroundActivity() }
    }
  }

  /// Active again without entering the background: give the assertion back.
  func cancelBackgroundPreparation() {
    lock.withLock {
      defer { preparedActivity = nil }
      return preparedActivity
    }?.end()
  }

  func enterBackground(_ engine: (any NativeEngineLifecycle)?) {
    lock.lock()
    defer { lock.unlock() }
    let activity = preparedActivity ?? beginBackgroundActivity()
    preparedActivity = nil
    transitionId += 1
    lifecycleGeneration += 1
    let id = transitionId
    let lifecycleToken = lifecycleGeneration
    let generation = storageAccess.generation
    let parts = NativeBackgroundParts(activity: activity, report: reportBackground, expire: { [storageAccess] in
      storageAccess.suspend(ifGeneration: generation)
    })
    let ownerGeneration = engine?.prepareRelease { parts.complete(.engine) } ?? 0
    storageAccess.suspend(ifGeneration: generation) { [storageAccess] in
      guard storageAccess.closeRegisteredFiles(generation: generation) else { return }
      engine?.confirmFile(.nativeFiles, generation: ownerGeneration)
      parts.complete(.nativeFiles)
    }
    let transition = NativeLifecycleTransition(
      lifecycle: lifecycle,
      engine: engine,
      // Read live, not once at dispatch time: this value is consulted again
      // on every retry, and must reflect the system's actual remaining
      // background time at the moment of each attempt, not a value that was
      // already stale by the time this queue got scheduled.
      remainingTimeMs: { activity.remainingTimeMs },
      finish: { parts.complete(.engine) }
    )
    // The JS database and the Engine share no file, so both close at once.
    if let hostSuspension {
      hostSuspension.suspend(transitionId: id) {
        engine?.confirmFile(.hostFiles, generation: ownerGeneration)
        parts.complete(.hostFiles)
      }
    } else {
      engine?.confirmFile(.hostFiles, generation: ownerGeneration)
      parts.complete(.hostFiles)
    }
    queue.async { [self] in
      guard lock.withLock({ lifecycleGeneration == lifecycleToken }) else { return }
      transition.enterBackground()
    }
  }

  func enterForeground(_ engine: (any NativeEngineLifecycle)?, completion: @escaping (Error?) -> Void = { _ in }) {
    lock.lock()
    defer { lock.unlock() }
    lifecycleGeneration += 1
    let id = transitionId
    let lifecycleToken = lifecycleGeneration
    engine?.invalidateReleaseForForeground()
    storageAccess.resume()
    hostSuspension?.resume(transitionId: id)
    let transition = NativeLifecycleTransition(
      lifecycle: lifecycle,
      engine: engine,
      remainingTimeMs: { 0 },
      finish: {},
      completion: completion
    )
    queue.async { [self] in
      guard lock.withLock({ lifecycleGeneration == lifecycleToken }) else {
        transition.superseded()
        return
      }
      transition.enterForeground { [self] in lock.withLock { lifecycleGeneration == lifecycleToken } }
    }
  }
}

/// Ends one background transition's activity only after every owner closed
/// its App Group files. On expiry it reports the owners still open, then lets
/// the activity end; it never releases anything for them.
private final class NativeBackgroundParts: @unchecked Sendable {
  private let lock = NSLock()
  private let activity: any NativeBackgroundActivity
  private let report: NativeBackgroundReport
  private var open = Set(NativeDiagnosticOwner.allCases)
  private var ended = false

  init(activity: any NativeBackgroundActivity, report: @escaping NativeBackgroundReport, expire: @escaping @Sendable () -> Void) {
    self.activity = activity
    self.report = report
    activity.onExpiration { [self] in
      expire()
      let pending = lock.withLock { () -> [NativeDiagnosticOwner]? in
        guard !ended else { return nil }
        ended = true
        return NativeDiagnosticOwner.allCases.filter(open.contains)
      }
      if let pending { self.report(pending, true) }
    }
  }

  func complete(_ owner: NativeDiagnosticOwner) {
    let finished = lock.withLock { () -> Bool in
      open.remove(owner)
      guard open.isEmpty, !ended else { return false }
      ended = true
      return true
    }
    guard finished else { return }
    report([], false)
    activity.end()
  }
}

private final class NativeLifecycleTransition: @unchecked Sendable {
  private let lifecycle: NativeLifecycleHost
  private let engine: (any NativeEngineLifecycle)?
  private let remainingTimeMs: @Sendable () -> UInt64?
  private let finish: @Sendable () -> Void
  private let completion: (Error?) -> Void

  init(
    lifecycle: NativeLifecycleHost,
    engine: (any NativeEngineLifecycle)?,
    remainingTimeMs: @escaping @Sendable () -> UInt64?,
    finish: @escaping @Sendable () -> Void,
    completion: @escaping (Error?) -> Void = { _ in }
  ) {
    self.lifecycle = lifecycle
    self.engine = engine
    self.remainingTimeMs = remainingTimeMs
    self.finish = finish
    self.completion = completion
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

  func enterForeground(isCurrent: () -> Bool) {
    let error = lifecycle.enterForeground(engine)
    finish()
    completion(isCurrent() ? error : NativeLifecycleError.transitionInProgress)
  }

  func superseded() { completion(NativeLifecycleError.transitionInProgress) }
}

protocol NativeBackgroundActivity: AnyObject, Sendable {
  var remainingTimeMs: UInt64? { get }
  func end()
  /// `handler` runs inside the system's expiration callback, before the
  /// activity ends there.
  func onExpiration(_ handler: @escaping @Sendable () -> Void)
}

extension NativeBackgroundActivity {
  func onExpiration(_ handler: @escaping @Sendable () -> Void) {}
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
