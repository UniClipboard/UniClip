import Foundation
#if canImport(AppGroupStore)
public import class AppGroupStore.SharedStorageAccess
#elseif canImport(SharedStorageAccess)
import SharedStorageAccess
#endif

/// A complete Engine action result, independent of its lifecycle state.
public enum NativeReleaseOutcome: Error {
  case pending
  case released(error: Error?)
  case failed(error: Error)
}

public enum NativeReleaseAction: Equatable { case suspend, shutdown }

public enum NativeReleaseFileOwner: Hashable {
  case nativeFiles
  case hostFiles
  case processObservability
}

/// Retains the complete owner until Engine and every declared file owner confirm.
/// The self-retention is deliberate: neither a timeout nor a terminal error owns
/// the authority to drop an Engine or unlock its runtime flock.
public final class NativeReleaseOwner: @unchecked Sendable {
  private let lock = NSRecursiveLock()
  private let queue: DispatchQueue
  private let storageAccess: SharedStorageAccess?
  private var storageGeneration: UInt64?
  private let requiredFiles: Set<NativeReleaseFileOwner>
  private let perform: (NativeReleaseAction, UInt64) -> NativeReleaseOutcome
  private let release: () -> Void
  private let report: (Error) -> Void
  private var retained: NativeReleaseOwner?
  private var generation = 0
  private var action: NativeReleaseAction?
  private var result: NativeReleaseOutcome?
  private var confirmedFiles: Set<NativeReleaseFileOwner> = []
  private var delayMs = 100
  private var scheduled = false
  private var performing = false
  private var engineCompletion: (() -> Void)?
  private var released = false
  private var savedError: Error?

  public init(
    requiredFiles: Set<NativeReleaseFileOwner>,
    storageAccess: SharedStorageAccess? = nil,
    queue: DispatchQueue = DispatchQueue(label: "app.uniclipboard.release-owner", qos: .utility),
    perform: @escaping (NativeReleaseAction, UInt64) -> NativeReleaseOutcome,
    release: @escaping () -> Void,
    report: @escaping (Error) -> Void
  ) {
    self.requiredFiles = requiredFiles
    self.storageAccess = storageAccess
    self.queue = queue
    self.perform = perform
    self.release = release
    self.report = report
    retained = self
  }

  public var hasAction: Bool { lock.withLock { action != nil } }
  public var failure: Error? { lock.withLock { if case .failed(let error) = result { return error }; return nil } }
  public var isReleased: Bool { lock.withLock { released } }
  public var isFinalAction: Bool { lock.withLock { action == .shutdown } }
  public var operationError: Error? { lock.withLock { savedError } }
  public var currentGeneration: Int { lock.withLock { generation } }

  /// A final action supersedes suspension; repeated waits otherwise join it.
  @discardableResult
  public func prepare(action requested: NativeReleaseAction, engineReleased: (() -> Void)? = nil) -> Int {
    lock.withLock {
      let next: NativeReleaseAction = action == .shutdown ? .shutdown : requested
      let failure: NativeReleaseOutcome?
      if action == next, case .failed = result { failure = result } else { failure = nil }
      generation += 1
      storageGeneration = storageAccess?.generation
      action = next
      result = failure
      confirmedFiles = []
      scheduled = false
      delayMs = 100
      released = false
      retained = self
      engineCompletion = engineReleased
      return generation
    }
  }

  public func observeEngineRelease(generation expected: Int, completion: @escaping () -> Void) {
    lock.withLock {
      guard generation == expected else { return }
      if case .released = result { completion() }
      else { engineCompletion = completion }
    }
  }

  @discardableResult
  public func attempt(deadlineMs: UInt64) -> NativeReleaseOutcome {
    var request: (generation: Int, action: NativeReleaseAction)?
    let cached: NativeReleaseOutcome? = lock.withLock {
      guard let action else { return .pending }
      if let result {
        switch result {
        case .released, .failed: return result
        case .pending: break
        }
      }
      guard !performing else {
        result = .pending
        schedule(deadlineMs: deadlineMs)
        return .pending
      }
      performing = true
      request = (generation, action)
      return nil
    }
    if let cached { return cached }
    guard let request else { return .pending }
    // The accepted Engine wait never holds the Mobile generation lock.
    // Foreground can invalidate release authority without cancelling cleanup.
    let outcome = perform(request.action, deadlineMs)
    return lock.withLock {
      performing = false
      switch outcome {
      case .released(let error):
        if let error { savedError = savedError ?? error; report(error) }
      case .failed(let error):
        savedError = savedError ?? error
        report(error)
      case .pending: break
      }
      guard generation == request.generation, action != nil else { return outcome }
      result = outcome
      switch outcome {
      case .pending: schedule(deadlineMs: deadlineMs)
      case .released:
        let completion = engineCompletion
        engineCompletion = nil
        completion?()
        finishIfConfirmed()
      case .failed: break
      }
      return outcome
    }
  }

  public func confirm(_ owner: NativeReleaseFileOwner, generation expected: Int) {
    lock.withLock {
      guard generation == expected, action != nil else { return }
      confirmedFiles.insert(owner)
      finishIfConfirmed()
    }
  }

  /// Invalidates Mobile release callbacks, not the accepted Engine cleanup.
  /// The Engine and runtime owner remain retained across a foreground race.
  public func invalidateForForeground() {
    lock.withLock {
      generation += 1
      if case .failed = result {
        // Failed is latched. Foreground is not proof that its cause recovered.
      } else {
        action = nil
        result = nil
      }
      scheduled = false
      engineCompletion = nil
      confirmedFiles = []
      retained = self
    }
  }

  private func finishIfConfirmed() {
    guard !released, case .released = result,
          requiredFiles.isSubset(of: confirmedFiles) else { return }
    if let storageAccess, let storageGeneration {
      guard storageAccess.releaseIfClosed(generation: storageGeneration, release) else { return }
    } else {
      release()
    }
    released = true
    retained = nil
  }

  private func schedule(deadlineMs: UInt64) {
    guard !scheduled else { return }
    scheduled = true
    let expected = generation
    let delay = delayMs
    delayMs = min(delayMs * 2, 5_000)
    queue.asyncAfter(deadline: .now() + .milliseconds(delay)) { [self] in
      let current = lock.withLock { () -> Bool in
        guard generation == expected, case .pending = result else { return false }
        scheduled = false
        return true
      }
      if current { _ = attempt(deadlineMs: deadlineMs) }
    }
  }
}
