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
  func recoverSession() throws -> NativeSessionRecovery
  func lifecycleState() throws -> NativeEngineLifecycleState
  func suspend() throws
  func resume() throws
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

  func suspend() throws {
    try engine.suspend()
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
}

final class NativeLifecycleHost {
  private let report: (Error) -> Void

  init(report: @escaping (Error) -> Void) {
    self.report = report
  }

  func prepare(_ engine: any NativeEngineLifecycle) throws {
    let recovery = try engine.recoverSession()
    if recovery.unlocked && !recovery.resumed {
      throw NativeLifecycleError.incompleteRecovery
    }
  }

  func enterBackground(_ engine: (any NativeEngineLifecycle)?) {
    guard let engine else { return }
    do {
      switch try engine.lifecycleState() {
      case .running, .quiesced:
        try engine.suspend()
      case .quiescing, .suspended, .shuttingDown, .stopped:
        return
      }
    } catch {
      report(error)
    }
  }

  func enterForeground(_ engine: (any NativeEngineLifecycle)?) {
    guard let engine else { return }
    do {
      guard try engine.lifecycleState() == .suspended else { return }
      try engine.resume()
    } catch {
      report(error)
    }
  }
}
