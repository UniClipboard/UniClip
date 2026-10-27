import Foundation
#if canImport(AppGroupStore)
internal import class AppGroupStore.SharedStorageAccess
#elseif canImport(SharedStorageAccess)
import SharedStorageAccess
#endif

enum ExtensionRuntimeLifecycleError: Error, Equatable {
  case runtimeOwnershipUnavailable
  case sessionClosed
  case filesUnconfirmed
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
  private let releaseEngine: (Engine) -> NativeReleaseOutcome
  private let closeFiles: (@escaping (Bool) -> Void) -> Void
  private let requiredFiles: Set<NativeReleaseFileOwner>
  private let storageAccess: SharedStorageAccess?
  private let report: (Error) -> Void
  private let startupLock = NSLock()
  private let stopLock = NSLock()
  private let stateLock = NSLock()
  private var state = State.starting
  private var engine: Engine?
  private var ownsRuntime = false
  private var activeOperationCount = 0
  private var operationsDrained: [() -> Void] = []
  private var releaseOwner: NativeReleaseOwner?
  private var retainedUntilClosed: ExtensionRuntimeLifecycle?

  init(
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000,
    shutdownQueue: DispatchQueue = DispatchQueue(label: "app.uniclipboard.extension-runtime-shutdown", qos: .utility),
    requiredFiles: Set<NativeReleaseFileOwner>,
    storageAccess: SharedStorageAccess? = nil,
    release: @escaping (Engine) -> NativeReleaseOutcome,
    closeFiles: @escaping (@escaping (Bool) -> Void) -> Void,
    report: @escaping (Error) -> Void
  ) {
    self.ownership = ownership
    self.acquisitionTimeoutMs = acquisitionTimeoutMs
    self.shutdownQueue = shutdownQueue
    self.requiredFiles = requiredFiles
    self.storageAccess = storageAccess
    releaseEngine = release
    self.closeFiles = closeFiles
    self.report = report
  }

  /// Compatibility for isolated callers with no declared external file owners.
  /// Only an explicit complete outcome can classify a thrown result as Pending.
  convenience init(
    ownership: any NativeRuntimeOwnership,
    acquisitionTimeoutMs: UInt64 = 1_000,
    shutdownQueue: DispatchQueue = DispatchQueue(label: "app.uniclipboard.extension-runtime-shutdown", qos: .utility),
    suspend: @escaping (Engine) throws -> Void,
    shutdown: @escaping (Engine) throws -> Void,
    flushLogs: @escaping () -> Void = {}
  ) {
    self.init(ownership: ownership, acquisitionTimeoutMs: acquisitionTimeoutMs, shutdownQueue: shutdownQueue,
      requiredFiles: [], release: { engine in
        do { try shutdown(engine); return .released(error: nil) }
        catch let outcome as NativeReleaseOutcome { return outcome }
        catch { return .failed(error: error) }
      }, closeFiles: { finish in flushLogs(); finish(true) }, report: { _ in })
  }

  func startEngine(_ create: () throws -> Engine) throws -> Engine {
    startupLock.lock()
    defer { startupLock.unlock() }

    guard stateLock.withLock({ state == .starting }) else {
      throw ExtensionRuntimeLifecycleError.sessionClosed
    }
    guard try ownership.acquire(timeoutMs: acquisitionTimeoutMs) else {
      throw ExtensionRuntimeLifecycleError.runtimeOwnershipUnavailable
    }
    stateLock.withLock { ownsRuntime = true; retainedUntilClosed = self }

    do {
      let started = try create()
      let stopping = stateLock.withLock { () -> Bool in
        engine = started
        return state == .stopping
      }
      if stopping { shutdownQueue.async { [self] in try? stopForSuspension() } }
      return started
    } catch {
      // No Engine object was returned. Its absence is not a release receipt.
      stateLock.withLock { state = .stopping }
      report(error)
      closeFiles { [self] closed in
        if !closed { report(ExtensionRuntimeLifecycleError.filesUnconfirmed) }
      }
      throw error
    }
  }

  func ensureStartupCanFinish() throws {
    guard stateLock.withLock({ state == .starting }) else {
      throw ExtensionRuntimeLifecycleError.sessionClosed
    }
  }

  func finishStartup() throws {
    try stateLock.withLock {
      guard state == .starting else {
        throw ExtensionRuntimeLifecycleError.sessionClosed
      }
      state = .active
    }
  }

  func withOperation<Result>(_ operation: () throws -> Result) throws -> Result {
    try stateLock.withLock {
      guard state == .active else {
        throw ExtensionRuntimeLifecycleError.sessionClosed
      }
      activeOperationCount += 1
    }
    defer {
      let ready = stateLock.withLock { () -> [() -> Void] in
        activeOperationCount -= 1
        guard activeOperationCount == 0 else { return [] }
        defer { operationsDrained.removeAll() }
        return operationsDrained
      }
      ready.forEach { $0() }
    }
    return try operation()
  }

  func stopForSuspension() throws {
    stopLock.lock()
    defer { stopLock.unlock() }
    let shouldStop = stateLock.withLock {
      guard state != .stopped else { return false }
      state = .stopping
      return true
    }
    guard shouldStop else { return }
    guard let currentEngine = stateLock.withLock({ engine }) else {
      closeFiles { [self] closed in
        if !closed { report(ExtensionRuntimeLifecycleError.filesUnconfirmed) }
      }
      throw ExtensionRuntimeLifecycleError.filesUnconfirmed
    }
    if releaseOwner == nil {
      releaseOwner = NativeReleaseOwner(requiredFiles: requiredFiles, storageAccess: storageAccess, queue: shutdownQueue,
        perform: { [releaseEngine] _, _ in releaseEngine(currentEngine) },
        release: { [weak self, ownership] in
          ownership.release()
          guard let self else { return }
          self.stateLock.withLock {
            self.ownsRuntime = false
            self.state = .stopped
            self.engine = nil
            self.retainedUntilClosed = nil
          }
        }, report: report)
    }
    let owner = releaseOwner!
    let generation = owner.hasAction ? owner.currentGeneration : owner.prepare(action: .shutdown)
    owner.observeEngineRelease(generation: generation) { [self, owner] in
      afterAcceptedOperations { [self, owner] in
        closeFiles { [self, owner] closed in
          guard closed else { report(ExtensionRuntimeLifecycleError.filesUnconfirmed); return }
          owner.confirm(.nativeFiles, generation: generation)
        }
      }
    }
    // Close admission immediately, in parallel with the accepted Engine action.
    // The completion is an actual file-owner result, not a timeout substitute.
    closeFiles { [self, owner] closed in
      if closed {
        afterAcceptedOperations { [owner] in owner.confirm(.nativeFiles, generation: generation) }
      } else { report(ExtensionRuntimeLifecycleError.filesUnconfirmed) }
    }
    // Extension sessions are one-shot. Confirm final worker destruction before
    // handing off, rather than dropping an unobserved final-shutdown task later.
    switch owner.attempt(deadlineMs: 1_000) {
    case .pending: throw NativeReleaseOutcome.pending
    case .failed(let error): throw error
    case .released:
      guard owner.isReleased else {
        report(ExtensionRuntimeLifecycleError.filesUnconfirmed)
        throw ExtensionRuntimeLifecycleError.filesUnconfirmed
      }

    }
  }

  private func afterAcceptedOperations(_ finish: @escaping () -> Void) {
    let ready = stateLock.withLock { () -> Bool in
      if activeOperationCount == 0 { return true }
      operationsDrained.append(finish)
      return false
    }
    if ready { finish() }
  }
}
