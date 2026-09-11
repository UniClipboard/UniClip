import Foundation

// Fixed binding fields only; never serializes arbitrary errors or attributes.
public enum EngineDiagnosticBridge {
  private static var source: BindingHostDiagnosticSource {
    Bundle.main.bundleIdentifier?.hasSuffix(".Keyboard") == true ? .keyboardExtension : .application
  }
  public static func register() {
    try? registerHostDiagnosticSource(source: source, capability: .partial)
  }
  public static func record(_ event: BindingHostDiagnosticEvent) {
    _ = try? recordHostDiagnostic(source: source, event: event)
  }
  public static func begin(_ action: BindingHostDiagnosticAction) -> String? {
    (try? recordHostDiagnostic(source: source, event: .begin(action: action)))?.token
  }
  public static func finish(_ token: String?, succeeded: Bool) {
    guard let token else { return }
    record(.finish(token: token, outcome: succeeded ? .completed : .failed(reason: .unknown)))
  }
  public static func observe<Result>(_ action: BindingHostDiagnosticAction, _ operation: () throws -> Result) rethrows -> Result {
    let token = begin(action)
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
