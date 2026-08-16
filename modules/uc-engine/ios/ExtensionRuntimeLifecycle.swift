import Foundation

enum ExtensionRuntimeLifecycleError: Error, Equatable {
  case runtimeOwnershipUnavailable
  case sessionClosed
}

final class ExtensionRuntimeLifecycle<Engine: AnyObject>: @unchecked Sendable {
  private enum State {
    case starting
    case active
    case stopping
    case stopped
  }

  private let ownership: any NativeRuntimeOwnership
  private let acquisitionTimeoutMs: UInt64
  private let shutdownQueue: DispatchQueue
  private let suspendEngine: (Engine) throws -> Void
  private let shutdownEngine: (Engine) -> Void
  private let startupLock = NSLock()
  private let stopLock = NSLock()
  private let stateCondition = NSCondition()
  private var state = State.starting
  private var engine: Engine?
  private var ownsRuntime = false
  private var activeOperationCount = 0

  init(
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000,
    shutdownQueue: DispatchQueue = DispatchQueue(
      label: "app.uniclipboard.extension-runtime-shutdown",
      qos: .utility
    ),
    suspend: @escaping (Engine) throws -> Void,
    shutdown: @escaping (Engine) -> Void
  ) {
    self.ownership = ownership
    self.acquisitionTimeoutMs = acquisitionTimeoutMs
    self.shutdownQueue = shutdownQueue
    suspendEngine = suspend
    shutdownEngine = shutdown
  }

  func startEngine(_ create: () throws -> Engine) throws -> Engine {
    startupLock.lock()
    defer { startupLock.unlock() }

    guard stateCondition.withLock({ state == .starting }) else {
      throw ExtensionRuntimeLifecycleError.sessionClosed
    }
    guard try ownership.acquire(timeoutMs: acquisitionTimeoutMs) else {
      throw ExtensionRuntimeLifecycleError.runtimeOwnershipUnavailable
    }
    stateCondition.withLock { ownsRuntime = true }

    do {
      let started = try create()
      stateCondition.withLock { engine = started }
      return started
    } catch {
      releaseRuntimeOwnership()
      throw error
    }
  }

  func ensureStartupCanFinish() throws {
    guard stateCondition.withLock({ state == .starting }) else {
      throw ExtensionRuntimeLifecycleError.sessionClosed
    }
  }

  func finishStartup() throws {
    try stateCondition.withLock {
      guard state == .starting else {
        throw ExtensionRuntimeLifecycleError.sessionClosed
      }
      state = .active
    }
  }

  func withOperation<Result>(_ operation: () throws -> Result) throws -> Result {
    try stateCondition.withLock {
      guard state == .active else {
        throw ExtensionRuntimeLifecycleError.sessionClosed
      }
      activeOperationCount += 1
    }
    defer {
      stateCondition.withLock {
        activeOperationCount -= 1
        if activeOperationCount == 0 {
          stateCondition.broadcast()
        }
      }
    }
    return try operation()
  }

  func stopForSuspension() throws {
    stopLock.lock()
    defer { stopLock.unlock() }

    let shouldStop = stateCondition.withLock {
      guard state != .stopping, state != .stopped else { return false }
      state = .stopping
      return true
    }
    guard shouldStop else { return }

    // Do not release ownership while engine creation can still begin touching
    // the shared store. Recovery runs after this critical section and is
    // interruptible through suspend.
    startupLock.lock()
    startupLock.unlock()

    let currentEngine = stateCondition.withLock { engine }
    if let currentEngine {
      do {
        try suspendEngine(currentEngine)
      } catch {
        shutdownEngine(currentEngine)
        waitForAcceptedOperationsToFinish()
        releaseRuntimeOwnership()
        stateCondition.withLock { state = .stopped }
        throw error
      }
    }

    waitForAcceptedOperationsToFinish()
    releaseRuntimeOwnership()
    stateCondition.withLock { state = .stopped }

    if let currentEngine {
      let finalShutdown = ExtensionRuntimeFinalShutdown(
        engine: currentEngine,
        shutdown: shutdownEngine
      )
      shutdownQueue.async { finalShutdown.run() }
    }
  }

  private func releaseRuntimeOwnership() {
    let shouldRelease = stateCondition.withLock {
      guard ownsRuntime else { return false }
      ownsRuntime = false
      return true
    }
    if shouldRelease { ownership.release() }
  }

  private func waitForAcceptedOperationsToFinish() {
    stateCondition.lock()
    while activeOperationCount > 0 {
      stateCondition.wait()
    }
    stateCondition.unlock()
  }
}

private final class ExtensionRuntimeFinalShutdown<Engine: AnyObject>: @unchecked Sendable {
  private let engine: Engine
  private let shutdown: (Engine) -> Void

  init(engine: Engine, shutdown: @escaping (Engine) -> Void) {
    self.engine = engine
    self.shutdown = shutdown
  }

  func run() {
    shutdown(engine)
  }
}
