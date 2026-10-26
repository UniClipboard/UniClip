import Foundation
import class AppGroupStore.SharedStorageAccess

// Fixed binding fields only; never serializes arbitrary errors or attributes.
public enum EngineDiagnosticBridge {
  private static let tokenLock = NSLock()
  private static var tokenGenerations: [String: UInt64] = [:]
  private static var source: BindingHostDiagnosticSource {
    Bundle.main.bundleIdentifier?.hasSuffix(".Keyboard") == true ? .keyboardExtension : .application
  }
  public static func register() {
    _ = try? SharedStorageAccess.shared.withAccess {
      try registerHostDiagnosticSource(source: source, capability: .partial)
    }
  }
  public static func record(_ event: BindingHostDiagnosticEvent, storageGeneration: UInt64? = nil) {
    _ = try? SharedStorageAccess.shared.withAccess(generation: storageGeneration) {
      try recordHostDiagnostic(source: source, event: event)
    }
  }
  public static func begin(_ action: BindingHostDiagnosticAction, storageGeneration: UInt64? = nil) -> String? {
    let generation = storageGeneration ?? SharedStorageAccess.shared.generation
    let token = try? SharedStorageAccess.shared.withAccess(generation: generation) {
      try recordHostDiagnostic(source: source, event: .begin(action: action)).token
    }
    if let token { tokenLock.withLock { tokenGenerations[token] = generation } }
    return token
  }
  public static func finish(_ token: String?, succeeded: Bool) {
    guard let token, let generation = tokenLock.withLock({ tokenGenerations.removeValue(forKey: token) }) else { return }
    _ = try? SharedStorageAccess.shared.withAccess(generation: generation) {
      try recordHostDiagnostic(source: source, event: .finish(token: token, outcome: succeeded ? .completed : .failed(reason: .unknown)))
    }
  }
  public static func observe<Result>(_ action: BindingHostDiagnosticAction, storageGeneration: UInt64? = nil, _ operation: () throws -> Result) rethrows -> Result {
    let token = begin(action, storageGeneration: storageGeneration)
    do { let result = try operation(); finish(token, succeeded: true); return result }
    catch { finish(token, succeeded: false); throw error }
  }

  public static func map(_ value: BindingLocalCaptureStatus) -> [String: Any] {
    [
      "mode": String(describing: value.mode),
      "captureId": value.captureId.map { $0 as Any } ?? NSNull(),
      "remainingMs": NSNumber(value: value.remainingMs),
      "startedAtUtc": value.startedAtUtc.map { $0 as Any } ?? NSNull(),
      "endReason": value.endReason.map { String(describing: $0) as Any } ?? NSNull(),
      "lastCaptureId": value.lastCaptureId.map { $0 as Any } ?? NSNull(),
      "revision": NSNumber(value: value.revision),
    ]
  }
  public static func map(_ value: BindingSourceCoverage) -> [String: Any] {
    [
      "source": String(describing: value.source),
      "capability": String(describing: value.capability),
      "collection": String(describing: value.collection),
      "observedCount": NSNumber(value: value.observedCount),
      "policyFilteredCount": NSNumber(value: value.policyFilteredCount),
    ]
  }
  public static func map(_ value: BindingFileSourceCounts) -> [String: Any] {
    [
      "source": String(describing: value.source),
      "acceptedCount": NSNumber(value: value.acceptedCount),
      "writtenCount": NSNumber(value: value.writtenCount),
      "queueDroppedCount": NSNumber(value: value.queueDroppedCount),
      "quotaDroppedCount": NSNumber(value: value.quotaDroppedCount),
      "writeFailedCount": NSNumber(value: value.writeFailedCount),
      "lastWrittenAtMs": value.lastWrittenAtMs.map { NSNumber(value: $0) } ?? NSNull(),
    ]
  }
  public static func map(_ value: BindingLocalDiagnosticStatus) -> [String: Any] {
    [
      "runId": value.runId,
      "capture": map(value.capture),
      "observedRecords": NSNumber(value: value.observedRecords),
      "policyFilteredRecords": NSNumber(value: value.policyFilteredRecords),
      "schemaRejectedRecords": NSNumber(value: value.schemaRejectedRecords),
      "correlationLimitedRecords": NSNumber(value: value.correlationLimitedRecords),
      "engineVersion": value.engineVersion,
      "sourceCommit": value.sourceCommit,
      "counterScope": value.counterScope,
      "sources": value.sources.map { map($0) },
      "localFile": String(describing: value.localFile),
      "closed": value.closed,
    ]
  }
  public static func map(_ value: BindingLocalDiagnosticExportReport) -> [String: Any] {
    [
      "flush": String(describing: value.flush),
      "status": map(value.status),
      "requestedAtUtc": value.requestedAtUtc,
      "completedAtUtc": value.completedAtUtc,
      "otherProcessesFlushed": value.otherProcessesFlushed,
      "files": value.files.map { map($0) },
    ]
  }
}
