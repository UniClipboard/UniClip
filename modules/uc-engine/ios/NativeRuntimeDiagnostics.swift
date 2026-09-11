import Foundation
import Darwin

@_silgen_name("flock")
private func diagnosticFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

public enum NativeDiagnosticRole: String, Sendable {
  case mainApplication = "main"
  case keyboardExtension = "keyboard"
  case shareExtension = "share"
}

public enum NativeDiagnosticEvent: String, Sendable {
  case captureStarted = "capture.started"
  case extensionVisible = "extension.visible"
  case extensionHidden = "extension.hidden"
  case appForeground = "app.foreground"
  case appBackground = "app.background"
  case engineStart = "engine.start"
  case engineSuspend = "engine.suspend"
  case engineResume = "engine.resume"
  case engineShutdown = "engine.shutdown"
  case secureStateRecovery = "security.recover"
  case ownershipAcquire = "ownership.acquire"
  case ownershipRelease = "ownership.release"
  case networkChanged = "network.path_observed"
  case networkObservation = "network.observation"
  case shareHandoff = "share.handoff"
  case exportFlush = "export.flush"
}

public enum NativeDiagnosticTrigger: String, Sendable {
  case appStartup, appForeground, appBackground, userRequest
  case extensionVisible, extensionHidden, runtimeHandoff, contextDestroyed
  case networkChange, exportRequested, unspecified
}

public enum NativeDiagnosticOutcome: String, Sendable {
  case observed, started, succeeded, failed, notAcquired
}

public struct NativeDiagnosticFailure: Encodable, Sendable {
  public enum Reason: String, Encodable, Sendable {
    case engineFailure, permissionDenied, storageUnavailable, runtimeBusy, spaceUnavailable
    case cancelled, nativeFailure
  }
  public let reason: Reason
  public let code: Int64?
  public let retryable: Bool?

  public init(reason: Reason, code: Int64? = nil, retryable: Bool? = nil) {
    self.reason = reason
    self.code = code
    self.retryable = retryable
  }
}

public struct NativeDiagnosticNetwork: Encodable, Equatable, Sendable {
  public enum Kind: String, Encodable, Sendable { case wifi, cellular, wired, other, none }
  public enum Change: String, Encodable, Sendable { case initial, pathUpdate, defaultNetwork, properties, capabilities }
  public let change: Change
  public let available: Bool
  public let kind: Kind
  public let expensive: Bool
  public let constrained: Bool

  public init(available: Bool, kind: Kind, expensive: Bool = false, constrained: Bool = false, change: Change = .capabilities) {
    self.change = change
    self.available = available
    self.kind = kind
    self.expensive = expensive
    self.constrained = constrained
  }
}

public struct NativeDiagnosticOperation: Sendable {
  fileprivate let id: String
  fileprivate let event: NativeDiagnosticEvent
  fileprivate let trigger: NativeDiagnosticTrigger
  fileprivate let startedAt: UInt64
  fileprivate let generation: UInt64
}

public struct NativeDiagnosticsSnapshot: Sendable {
  public let writerStatus: String
  public let droppedRecords: UInt64
  public let writeFailures: UInt64
  public let prunedFiles: UInt64
  public let sessionId: String
  public let role: String
  public let startedAt: String
  public let capturedAt: String
  public let maxFileBytes: Int
  public let maxFiles: Int

  public var dictionary: [String: Any] {
    [
      "writerStatus": writerStatus, "droppedRecords": NSNumber(value: droppedRecords),
      "writeFailures": NSNumber(value: writeFailures), "prunedFiles": NSNumber(value: prunedFiles),
      "sessionId": sessionId, "role": role, "startedAt": startedAt, "capturedAt": capturedAt,
      "policy": "native-runtime-boundaries-v1", "effectiveLevel": "info",
      "filteredRecordCount": NSNull(), "retentionDays": 3,
      "maxFileBytes": maxFileBytes, "maxFiles": maxFiles,
    ]
  }
}

/// A closed event vocabulary deliberately excludes arbitrary messages and attributes.
/// Each process writes its own files; it never shares an open writer with an extension.
public final class NativeRuntimeDiagnostics: @unchecked Sendable {
  private let directory: URL?
  private let role: NativeDiagnosticRole
  private let sessionId = UUID().uuidString.lowercased()
  private let startedAt = Date()
  private let queue = DispatchQueue(label: "app.uniclipboard.native-diagnostics", qos: .utility)
  private let capacity = DispatchSemaphore(value: 128)
  private let state = NSLock()
  private let maxFileBytes: Int
  private let maxFiles: Int
  private var generation: UInt64 = 0
  private var droppedRecords: UInt64 = 0
  private var writeFailures: UInt64 = 0
  private var prunedFiles: UInt64 = 0
  private var writerReady = false
  private var fileIndex = 0
  private var fileBytes = 0

  public init(directory: URL?, role: NativeDiagnosticRole, maxFileBytes: Int = 256 * 1024, maxFiles: Int = 24) {
    self.directory = directory
    self.role = role
    self.maxFileBytes = max(1_024, maxFileBytes)
    self.maxFiles = max(1, maxFiles)
    record(.captureStarted, trigger: .unspecified)
  }

  public func begin(_ event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger) -> NativeDiagnosticOperation {
    let current = state.withLock {
      if event == .engineStart { generation += 1 }
      return generation
    }
    let operation = NativeDiagnosticOperation(
      id: UUID().uuidString.lowercased(), event: event, trigger: trigger,
      startedAt: DispatchTime.now().uptimeNanoseconds, generation: current
    )
    enqueue(event, trigger: trigger, outcome: .started, operation: operation)
    return operation
  }

  public func finish(_ operation: NativeDiagnosticOperation, outcome: NativeDiagnosticOutcome,
                     failure: NativeDiagnosticFailure? = nil) {
    enqueue(operation.event, trigger: operation.trigger, outcome: outcome, operation: operation, failure: failure)
  }

  public func record(_ event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger,
                     outcome: NativeDiagnosticOutcome = .observed,
                     failure: NativeDiagnosticFailure? = nil, network: NativeDiagnosticNetwork? = nil) {
    enqueue(event, trigger: trigger, outcome: outcome, failure: failure, network: network)
  }

  public func flush(deadlineMs: Int = 1_000) -> Bool {
    let completed = DispatchSemaphore(value: 0)
    queue.async { completed.signal() }
    return completed.wait(timeout: .now() + .milliseconds(max(0, deadlineMs))) == .success
  }

  public func snapshot() -> NativeDiagnosticsSnapshot {
    state.withLock {
      NativeDiagnosticsSnapshot(
        writerStatus: writerReady ? "ready" : "unavailable", droppedRecords: droppedRecords,
        writeFailures: writeFailures, prunedFiles: prunedFiles, sessionId: sessionId,
        role: role.rawValue, startedAt: Self.timestamp(startedAt), capturedAt: Self.timestamp(Date()),
        maxFileBytes: maxFileBytes, maxFiles: maxFiles
      )
    }
  }

  public func fileURLs() -> [URL] { fileDiscovery().files }

  public func fileDiscovery() -> (files: [URL], status: String, skippedFiles: Int) {
    guard let directory else { return ([], "unavailable", 0) }
    do {
      let candidates = try FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
        options: [.skipsHiddenFiles]
      ).filter { Self.isJournalFile($0.lastPathComponent) }
      var skipped = 0
      let files = candidates.filter { url in
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else {
          skipped += 1
          return false
        }
        if values.isSymbolicLink == true { skipped += 1; return false }
        if values.isRegularFile != true { skipped += 1; return false }
        return true
      }.sorted { $0.lastPathComponent < $1.lastPathComponent }
      return (files, skipped == 0 ? "completed" : "partial", skipped)
    } catch { return ([], "unavailable", 0) }
  }

  private func enqueue(_ event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger,
                       outcome: NativeDiagnosticOutcome, operation: NativeDiagnosticOperation? = nil,
                       failure: NativeDiagnosticFailure? = nil, network: NativeDiagnosticNetwork? = nil) {
    guard capacity.wait(timeout: .now()) == .success else {
      state.withLock { droppedRecords += 1 }
      return
    }
    let capturedAt = Date()
    let uptime = DispatchTime.now().uptimeNanoseconds
    let currentGeneration = operation?.generation ?? state.withLock { generation }
    queue.async { [self] in
      defer { capacity.signal() }
      do {
        guard let directory else { throw CocoaError(.fileNoSuchFile) }
        let health = snapshot()
        var record: [String: Any] = [
          "schemaVersion": 1, "policy": "native-runtime-boundaries-v1",
          "timestamp": Self.timestamp(capturedAt), "monotonicMs": uptime / 1_000_000,
          "role": role.rawValue, "sessionId": sessionId, "startAttempt": currentGeneration,
          "processId": ProcessInfo.processInfo.processIdentifier,
          "event": event.rawValue, "trigger": trigger.rawValue, "outcome": outcome.rawValue,
          "level": outcome == .failed ? "ERROR" : "INFO",
          "appVersion": Self.buildValue("CFBundleShortVersionString"),
          "appBuild": Self.buildValue("CFBundleVersion"),
          "droppedRecords": health.droppedRecords, "writeFailures": health.writeFailures,
          "prunedFiles": health.prunedFiles,
        ]
        if let operation {
          record["operationId"] = operation.id
          if outcome != .started { record["durationMs"] = (uptime - operation.startedAt) / 1_000_000 }
        }
        if let failure { record["failure"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(failure)) }
        if let network { record["network"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(network)) }
        var bytes = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        bytes.append(0x0a)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try withDirectoryLock(directory) {
          if fileBytes > 0 && fileBytes + bytes.count > maxFileBytes { fileIndex += 1; fileBytes = 0 }
          let url = directory.appendingPathComponent("native-runtime.\(role.rawValue).\(sessionId).\(fileIndex).jsonl")
          try prune(excluding: url)
          if !FileManager.default.fileExists(atPath: url.path) {
            var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o600]
            #if os(iOS)
            attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
            #endif
            guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: attributes) else {
              throw CocoaError(.fileWriteUnknown)
            }
          }
          let file = try FileHandle(forWritingTo: url)
          defer { try? file.close() }
          try file.seekToEnd()
          try file.write(contentsOf: bytes)
          fileBytes += bytes.count
          state.withLock { writerReady = true }
        }
      } catch {
        state.withLock { droppedRecords += 1; writeFailures += 1; writerReady = false }
      }
    }
  }

  private func prune(excluding current: URL) throws {
    let cutoff = Date().addingTimeInterval(-3 * 24 * 60 * 60)
    let discovery = fileDiscovery()
    guard discovery.status != "unavailable" else { throw CocoaError(.fileReadUnknown) }
    let files = discovery.files.map { url in
      (url, (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
    }.sorted { $0.1 < $1.1 }
    var remaining = files.count + discovery.skippedFiles + (files.contains { $0.0 == current } ? 0 : 1)
    for (url, modifiedAt) in files where url != current {
      if modifiedAt < cutoff || remaining > maxFiles {
        try FileManager.default.removeItem(at: url)
        remaining -= 1
        state.withLock { prunedFiles += 1 }
      }
    }
    guard remaining <= maxFiles else { throw CocoaError(.fileWriteUnknown) }
  }

  private func withDirectoryLock(_ directory: URL, operation: () throws -> Void) throws {
    let descriptor = Darwin.open(directory.appendingPathComponent(".native-runtime.lock").path,
      O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    defer { Darwin.close(descriptor) }
    let deadline = DispatchTime.now().uptimeNanoseconds + 100_000_000
    while diagnosticFlock(descriptor, LOCK_EX | LOCK_NB) != 0 {
      guard (errno == EWOULDBLOCK || errno == EAGAIN),
            DispatchTime.now().uptimeNanoseconds < deadline else { throw CocoaError(.fileWriteUnknown) }
      usleep(1_000)
    }
    defer { _ = diagnosticFlock(descriptor, LOCK_UN) }
    try operation()
  }

  private static func isJournalFile(_ name: String) -> Bool {
    name.range(of: #"^native-runtime\.(main|keyboard|share)\.[0-9a-f-]{36}\.[0-9]+\.jsonl$"#, options: .regularExpression) != nil
  }

  private static func timestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }

  private static func buildValue(_ key: String) -> String {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
          value.range(of: #"^[0-9A-Za-z.+-]{1,80}$"#, options: .regularExpression) != nil else { return "unknown" }
    return value
  }
}
