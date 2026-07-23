import Foundation

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

enum NativeLifecycleError: Error {
  case incompleteRecovery
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
