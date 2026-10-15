import Foundation

/// Native host side of the Engine's independent network-library log.
///
/// The network log has its own configuration, state, control and export source. Nothing here is
/// reached from, or fails, the business-log install: a configuration problem only changes what
/// `status()` reports.
public enum NetworkLogHost {
  /// Result of the pre-install configuration step in this process.
  public enum Configuration: Equatable, Sendable {
    case notAttempted
    /// No budget was supplied, so the Engine runs without a network log.
    case notConfigured
    case configured(role: String)
    case rejected(String)
  }

  private static let lock = NSLock()
  private static var configuration = Configuration.notAttempted

  public static func configurationSnapshot() -> Configuration {
    lock.withLock { configuration }
  }

  /// Release and debug builds use the same budget: 8 KiB per record, 1,024 queued records, 4 MiB per
  /// file, 16 MiB per run, 64 MiB for the root, 7 days. These are the recommended values from the
  /// network-log proposal, adopted because release builds need the log; change them here only.
  static func budget(role: BindingNetworkProcessRole) -> BindingNetworkLogConfig {
    BindingNetworkLogConfig(
      role: role, recordBytes: 8 * 1024, queueRecords: 1_024,
      fileBytes: 4 * 1024 * 1024, runBytes: 16 * 1024 * 1024,
      rootBytes: 64 * 1024 * 1024, retentionSeconds: 7 * 24 * 60 * 60
    )
  }

  /// Must run before `installProcessObservability` in every process that hosts an Engine.
  /// `explicit` replaces the built-in budget; it exists for real-process verification.
  @discardableResult
  public static func configureBeforeInstall(
    role: BindingNetworkProcessRole, explicit: BindingNetworkLogConfig? = nil
  ) -> Configuration {
    let outcome: Configuration
    let config = explicit ?? budget(role: role)
    do {
      try configureNetworkLog(config: config)
      outcome = .configured(role: roleName(config.role))
    } catch BindingNetworkLogError.AlreadyInstalled {
      // The process subscriber is already installed (the diagnostics start and the engine start
      // both pass through here); the first outcome stays authoritative for this process.
      return lock.withLock {
        // Nothing configured before the install means the call order was violated: say so.
        if configuration == .notAttempted { configuration = .rejected("alreadyInstalled") }
        return configuration
      }
    } catch {
      outcome = .rejected(errorName(error))
    }
    lock.withLock { configuration = outcome }
    return outcome
  }

  // MARK: Control

  public static func status() -> [String: Any] {
    do {
      return ok(map(try queryNetworkLogStatus()))
    } catch {
      return failure(error)
    }
  }

  public static func startCapture(durationMs: UInt64) -> [String: Any] {
    do {
      let capture = try startNetworkCapture(durationMs: durationMs)
      return ok([
        "captureId": capture.captureId, "startedAtUtc": capture.startedAtUtc,
        "durationMs": NSNumber(value: capture.durationMs), "alreadyActive": capture.alreadyActive,
      ])
    } catch {
      return failure(error)
    }
  }

  public static func stopCapture(captureId: String) -> [String: Any] {
    do {
      try stopNetworkCapture(captureId: captureId)
      return ok([:])
    } catch {
      return failure(error)
    }
  }

  // MARK: Export

  /// Flushes this process's network log, then stages the allowlisted files of every run found
  /// under the network log root. Other processes (the keyboard extension) are not flushed.
  /// `fallbackRoot` is where runs are discovered when the Engine cannot report its own directory.
  public static func prepareExport(deadlineMs: UInt64, stagingRoot: URL, fallbackRoot: URL?) -> [String: Any] {
    var engineReport: BindingNetworkLogExportReport?
    var engineError: String?
    do {
      engineReport = try prepareNetworkLogExport(deadlineMs: deadlineMs)
    } catch {
      engineError = errorName(error)
    }
    let currentRun = engineReport.map { URL(fileURLWithPath: $0.runDirectory, isDirectory: true) }
    // The Engine's own report names the root; the container is the fallback when it is not installed.
    let root = currentRun?.deletingLastPathComponent().deletingLastPathComponent() ?? fallbackRoot
    var isDirectory: ObjCBool = false
    guard let root, FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      return ok([
        "engine": engineReport.map(mapReport) ?? NSNull(), "engineError": engineError ?? NSNull(),
        "rootAvailable": false, "exportId": NSNull(), "files": [] as [Any],
        "discoveredRunCount": 0, "skippedEntryCount": 0, "unreadableFileCount": 0,
        "flushScope": "currentProcessOnly",
      ])
    }
    do {
      let staged = try NetworkLogExportStaging.stage(
        root: root, currentRunDirectory: currentRun,
        engineFiles: engineReport?.files.map { ($0.name, $0.bytes, $0.sha256) } ?? [],
        stagingRoot: stagingRoot
      )
      return ok([
        "engine": engineReport.map(mapReport) ?? NSNull(), "engineError": engineError ?? NSNull(),
        "rootAvailable": true, "exportId": staged.exportId,
        "files": staged.files.map(mapStaged),
        "discoveredRunCount": staged.discoveredRunCount,
        "skippedEntryCount": staged.skippedEntryCount,
        "unreadableFileCount": staged.unreadableFileCount,
        "flushScope": "currentProcessOnly",
      ])
    } catch {
      return ["ok": false, "error": "stagingFailed"]
    }
  }

  public static func releaseExport(exportId: String, stagingRoot: URL) {
    NetworkLogExportStaging.release(exportId: exportId, stagingRoot: stagingRoot)
  }

  /// Where earlier runs live when the Engine cannot name its own directory (the App Group container).
  public static func appGroupNetworkRoot() -> URL? { P2pSharedStore.networkLogRoot() }

  public static var defaultStagingRoot: URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("uc-network-log-export", isDirectory: true)
  }

  // MARK: Mapping

  private static func ok(_ value: [String: Any]) -> [String: Any] { ["ok": true, "value": value] }

  private static func failure(_ error: Error) -> [String: Any] {
    ["ok": false, "error": errorName(error), "configuration": configurationName(configurationSnapshot())]
  }

  static func configurationName(_ value: Configuration) -> String {
    switch value {
    case .notAttempted: return "notAttempted"
    case .notConfigured: return "notConfigured"
    case let .configured(role): return "configured:\(role)"
    case let .rejected(reason): return "rejected:\(reason)"
    }
  }

  static func errorName(_ error: Error) -> String {
    switch error as? BindingNetworkLogError {
    case .AlreadyInstalled: return "alreadyInstalled"
    case .InvalidConfig: return "invalidConfig"
    case .NotInstalled: return "notInstalled"
    case .NotConfigured: return "notConfigured"
    case .InvalidDuration: return "invalidDuration"
    case .CaptureMismatch: return "captureMismatch"
    case .AlreadyShutdown: return "alreadyShutdown"
    case .InvalidDeadline: return "invalidDeadline"
    case nil: return "internal"
    }
  }

  static func roleName(_ role: BindingNetworkProcessRole) -> String {
    switch role {
    case .daemon: return "daemon"
    case .mobileApp: return "mobile_app"
    case .keyboardExtension: return "keyboard_extension"
    case .shareExtension: return "share_extension"
    case .backgroundService: return "background_service"
    }
  }

  private static func map(_ status: BindingNetworkLogStatus) -> [String: Any] {
    let counters = status.counters
    return [
      "schemaVersion": status.schemaVersion,
      "state": { () -> String in
        switch status.state {
        case .starting: return "starting"
        case .ready: return "ready"
        case .unavailable: return "unavailable"
        case .closed: return "closed"
        }
      }(),
      "runId": status.runId, "role": roleName(status.role),
      "mode": status.mode == .detailed ? "detailed" : "standard",
      "detailedRemainingMs": status.detailedRemainingMs.map { NSNumber(value: $0) as Any } ?? NSNull(),
      "counters": [
        "accepted": NSNumber(value: counters.accepted), "written": NSNumber(value: counters.written),
        "policyFiltered": NSNumber(value: counters.policyFiltered),
        "rateLimited": NSNumber(value: counters.rateLimited),
        "oversized": NSNumber(value: counters.oversized),
        "queueDropped": NSNumber(value: counters.queueDropped),
        "closedDropped": NSNumber(value: counters.closedDropped),
        "writeFailed": NSNumber(value: counters.writeFailed),
        "rotatedOutFiles": NSNumber(value: counters.rotatedOutFiles),
        "pathRecovered": NSNumber(value: counters.pathRecovered),
        "unreviewedCallsites": NSNumber(value: counters.unreviewedCallsites),
      ],
      "libraries": status.libraries.map {
        [
          "library": $0.library, "versionDir": $0.versionDir.map { $0 as Any } ?? NSNull(),
          "approvedRules": NSNumber(value: $0.approvedRules),
          "observedRecords": NSNumber(value: $0.observedRecords),
        ] as [String: Any]
      },
      "sampledAtUtc": status.sampledAtUtc,
    ]
  }

  private static func mapReport(_ report: BindingNetworkLogExportReport) -> [String: Any] {
    [
      "flush": { () -> String in
        switch report.flush {
        case .completed: return "completed"
        case .failed: return "failed"
        case .timedOut: return "timedOut"
        case .alreadyShutdown: return "alreadyShutdown"
        }
      }(),
      "status": map(report.status), "requestedAtUtc": report.requestedAtUtc,
      "completedAtUtc": report.completedAtUtc, "otherProcessesFlushed": report.otherProcessesFlushed,
      "files": report.files.map {
        ["name": $0.name, "bytes": NSNumber(value: $0.bytes), "sha256": $0.sha256] as [String: Any]
      },
    ]
  }

  private static func mapStaged(_ file: NetworkLogStagedFile) -> [String: Any] {
    [
      "role": file.role, "runId": file.runId, "name": file.name,
      "bytes": NSNumber(value: file.bytes), "sha256": file.sha256,
      "uri": URL(fileURLWithPath: file.stagedPath).absoluteString,
      "isCurrentRun": file.isCurrentRun, "engineCheck": file.engineCheck.rawValue,
    ]
  }
}
