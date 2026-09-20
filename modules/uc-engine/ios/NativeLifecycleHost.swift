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
}

final class RuntimeOwnedNativeLifecycle: NativeEngineLifecycle {
  private let engine: any NativeEngineLifecycle
  private let ownership: any NativeRuntimeOwnership
  private let acquisitionTimeoutMs: UInt64

  init(
    engine: any NativeEngineLifecycle,
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000
  ) {
    self.engine = engine
    self.ownership = ownership
    self.acquisitionTimeoutMs = acquisitionTimeoutMs
  }

  func recoverSession() throws -> NativeSessionRecovery {
    try engine.recoverSession()
  }

  func lifecycleState() throws -> NativeEngineLifecycleState {
    try engine.lifecycleState()
  }

  func suspend(deadlineMs: UInt64?) throws {
    try engine.suspend(deadlineMs: deadlineMs)
    ownership.release()
  }

  func resume() throws {
    guard try ownership.acquire(timeoutMs: acquisitionTimeoutMs) else {
      throw NativeLifecycleError.runtimeOwnershipUnavailable
    }
    do {
      try engine.resume()
    } catch {
      ownership.release()
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

  func enterBackground(_ engine: (any NativeEngineLifecycle)?, deadlineMs: UInt64?) -> Bool {
    guard let engine else { return true }
    do {
      try suspendIfNeeded(engine, deadlineMs: deadlineMs)
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

  func suspendIfNeeded(_ engine: any NativeEngineLifecycle, deadlineMs: UInt64?) throws {
    try transitionLock.withLock {
      if engine.isStartupLifecycle {
        try engine.suspend(deadlineMs: deadlineMs)
        return
      }
      switch try engine.lifecycleState() {
      case .running, .quiesced:
        try engine.suspend(deadlineMs: deadlineMs)
      case .quiescing, .suspended, .shuttingDown, .stopped:
        return
      }
    }
  }

  func resumeIfNeeded(_ engine: any NativeEngineLifecycle) throws {
    try transitionLock.withLock {
      if engine.isStartupLifecycle {
        try engine.resume()
        return
      }
      guard try engine.lifecycleState() == .suspended else { return }
      try engine.resume()
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
      deadlineMs: activity.remainingTimeMs,
      finish: { activity.end() }
    )
    queue.async { transition.enterBackground() }
  }

  func enterForeground(_ engine: (any NativeEngineLifecycle)?) {
    let transition = NativeLifecycleTransition(
      lifecycle: lifecycle,
      engine: engine,
      deadlineMs: 0,
      finish: {}
    )
    queue.async { transition.enterForeground() }
  }
}

private final class NativeLifecycleTransition: @unchecked Sendable {
  private let lifecycle: NativeLifecycleHost
  private let engine: (any NativeEngineLifecycle)?
  private let deadlineMs: UInt64?
  private let finish: @Sendable () -> Void

  init(
    lifecycle: NativeLifecycleHost,
    engine: (any NativeEngineLifecycle)?,
    deadlineMs: UInt64?,
    finish: @escaping @Sendable () -> Void
  ) {
    self.lifecycle = lifecycle
    self.engine = engine
    self.deadlineMs = deadlineMs
    self.finish = finish
  }

  func enterBackground() {
    if lifecycle.enterBackground(engine, deadlineMs: deadlineMs) {
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
