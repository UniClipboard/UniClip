import Darwin
import Foundation

@_silgen_name("flock")
private func systemFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

public protocol NativeRuntimeOwnership: AnyObject {
  func acquire(timeoutMs: UInt64) throws -> Bool
  func release()
}

enum P2pRuntimeHandoff {
  private static let mainApplicationAcquisitionTimeoutMs: UInt64 = 5_000
  private static let extensionAcquisitionTimeoutMs: UInt64 = 1_000

  static func acquireForMainApplication(_ ownership: any NativeRuntimeOwnership) throws -> Bool {
    try ownership.acquire(timeoutMs: mainApplicationAcquisitionTimeoutMs)
  }

  static func acquireForExtension(_ ownership: any NativeRuntimeOwnership) throws -> Bool {
    try ownership.acquire(timeoutMs: extensionAcquisitionTimeoutMs)
  }
}

public final class P2pRuntimeOwnership: NativeRuntimeOwnership, @unchecked Sendable {
  private let lockURL: URL
  private let stateLock = NSLock()
  private let diagnostics: NativeRuntimeDiagnostics?
  private var descriptor: Int32 = -1

  public init(lockURL: URL, diagnostics: NativeRuntimeDiagnostics? = nil) {
    self.lockURL = lockURL
    self.diagnostics = diagnostics
  }

  deinit {
    release()
  }

  public func acquire(timeoutMs: UInt64) throws -> Bool {
    if stateLock.withLock({ descriptor >= 0 }) { return true }

    let observation = diagnostics?.begin(.ownershipAcquire, trigger: .runtimeHandoff)
    do {
      let acquired = try acquireUnobserved(timeoutMs: timeoutMs)
      if let observation { diagnostics?.finish(observation, outcome: acquired ? .succeeded : .notAcquired) }
      return acquired
    } catch {
      if let observation {
        diagnostics?.finish(observation, outcome: .failed, failure: .init(
          reason: .nativeFailure, code: (error as? POSIXError).map { Int64($0.code.rawValue) }
        ))
      }
      throw error
    }
  }

  private func acquireUnobserved(timeoutMs: UInt64) throws -> Bool {

    let candidate = Darwin.open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard candidate >= 0 else { throw currentPOSIXError() }

    let start = DispatchTime.now().uptimeNanoseconds
    let timeout = timeoutMs.multipliedReportingOverflow(by: 1_000_000)
    let budget = timeout.overflow ? UInt64.max : timeout.partialValue
    while systemFlock(candidate, LOCK_EX | LOCK_NB) != 0 {
      let failure = errno
      guard failure == EWOULDBLOCK || failure == EAGAIN else {
        Darwin.close(candidate)
        throw POSIXError(POSIXErrorCode(rawValue: failure) ?? .EIO)
      }
      let elapsed = DispatchTime.now().uptimeNanoseconds - start
      guard elapsed < budget else {
        Darwin.close(candidate)
        return false
      }
      let remainingMicroseconds = min((budget - elapsed) / 1_000, 20_000)
      usleep(useconds_t(max(1, remainingMicroseconds)))
    }

    let installed = stateLock.withLock {
      guard descriptor < 0 else { return false }
      descriptor = candidate
      return true
    }
    if !installed {
      _ = systemFlock(candidate, LOCK_UN)
      Darwin.close(candidate)
    }
    return true
  }

  public func release() {
    let active = stateLock.withLock {
      defer { descriptor = -1 }
      return descriptor
    }
    guard active >= 0 else { return }
    _ = systemFlock(active, LOCK_UN)
    Darwin.close(active)
    diagnostics?.record(.ownershipRelease, trigger: .runtimeHandoff)
  }

  private func currentPOSIXError() -> POSIXError {
    POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
