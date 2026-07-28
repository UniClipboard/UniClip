import ExpoModulesCore
import Foundation
internal import UcEngineCore

public final class UcEngineModule: Module {
  private let host = MainApplicationEngineHost()
  private lazy var lifecycle = NativeLifecycleHost(report: Self.reportLifecycleError)
  private let engines = NativeEngineRegistry<MobileEngine>()

  public func definition() -> ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { (config: [String: String]) in
      let appVersion = config["appVersion"] ?? "unknown"
      let profileId = config["profileId"] ?? "default"
      let started = try self.host.start(appVersion: appVersion, profileId: profileId)
      do {
        let installed = try self.engines.installBeforePreparing(started) { engine in
          try self.lifecycle.prepare(AppleEngineLifecycle(engine: engine, host: self.host))
        }
        guard installed else {
          throw UcEngineAlreadyStartedException()
        }
      } catch {
        do {
          try started.shutdown(deadlineMs: 2_000)
        } catch {
          Self.reportLifecycleError(error)
        }
        if self.currentEngine() == nil {
          self.host.releaseRuntimeOwnership()
        }
        throw error
      }
    }

    AsyncFunction("shutdown") { (deadlineMs: UInt64) in
      let active = self.engines.take()
      defer { self.host.releaseRuntimeOwnership() }
      try active?.shutdown(deadlineMs: deadlineMs)
      self.host.removeAllFileHandles()
    }

    AsyncFunction("suspend") {
      try AppleEngineLifecycle(engine: self.requireEngine(), host: self.host).suspend()
    }
    AsyncFunction("resume") {
      try AppleEngineLifecycle(engine: self.requireEngine(), host: self.host).resume()
    }

    AsyncFunction("createSpace") { (deviceName: String?, passphrase: String) -> [String: Any] in
      let result = try self.requireEngine().createSpace(
        deviceName: deviceName,
        passphrase: passphrase
      )
      return [
        "spaceId": result.spaceId,
        "selfDeviceId": result.selfDeviceId,
        "identityFingerprint": result.identityFingerprint,
      ]
    }

    AsyncFunction("issueInvitation") { () -> [String: Any] in
      let result = try self.requireEngine().issueInvitation()
      let availability = switch result.availability {
      case .crossNetwork: "crossNetwork"
      case .sameLocalNetwork: "sameLocalNetwork"
      }
      return [
        "invitationCode": result.invitationCode,
        "expiresAtMs": result.expiresAtMs,
        "availability": availability,
      ]
    }

    AsyncFunction("joinSpace") {
      (invitationCode: String, deviceName: String?, passphrase: String) -> [String: Any] in
      let result = try self.requireEngine().joinSpace(
        invitationCode: invitationCode,
        deviceName: deviceName,
        passphrase: passphrase
      )
      return [
        "sponsorDeviceId": result.sponsorDeviceId,
        "sponsorIdentityFingerprint": result.sponsorIdentityFingerprint,
        "spaceId": result.spaceId,
        "selfDeviceId": result.selfDeviceId,
        "selfIdentityFingerprint": result.selfIdentityFingerprint,
        "migratedRecords": result.migratedRecords ?? 0,
      ]
    }

    AsyncFunction("nextEvent") { (timeoutMs: UInt64) -> [String: Any?]? in
      try self.requireEngine().nextEvent(timeoutMs: timeoutMs).map(Self.eventMap)
    }

    AsyncFunction("refreshPeerConnections") { () -> [String: Any] in
      let result = try self.requireEngine().refreshPeerConnections()
      return [
        "total": result.total,
        "online": result.online,
        "offline": result.offline,
        "errors": result.errors,
      ]
    }

    AsyncFunction("querySpaceState") { () -> [String: Any?] in
      let result = try self.requireEngine().querySpaceState()
      return [
        "hasCompleted": result.hasCompleted,
        "spaceId": result.spaceId,
        "currentInvitation": result.currentInvitation.map {
          ["invitationCode": $0.invitationCode, "expiresAtMs": $0.expiresAtMs]
        },
        "deviceName": result.deviceName,
      ]
    }

    AsyncFunction("listDevices") { () -> [[String: Any]] in
      let engine = try self.requireEngine()
      let localDeviceId = try engine.queryLocalDevice().deviceId
      return try engine.listDevices().map {
        [
          "deviceId": $0.deviceId,
          "displayName": $0.displayName,
          "isLocal": $0.deviceId == localDeviceId,
          "online": $0.online,
        ]
      }
    }

    AsyncFunction("removeMember") { (deviceId: String) in
      try self.requireEngine().removeMember(deviceId: deviceId)
    }

    AsyncFunction("resendEntry") {
      (entryId: String, targetDevices: [String]) -> [String: Any] in
      Self.resendOutcomeMap(
        try self.requireEngine().resendEntry(entryId: entryId, targetDevices: targetDevices)
      )
    }

    AsyncFunction("leaveSpace") {
      try self.requireEngine().leaveSpace()
    }

    AsyncFunction("sendText") { (text: String, targetDevices: [String]) -> [String: Any] in
      Self.sendReportMap(
        try self.requireEngine().sendText(text: text, targetDevices: targetDevices)
      )
    }

    AsyncFunction("sendImage") {
      (bytes: Data, mimeType: String, targetDevices: [String]) -> [String: Any] in
      Self.sendReportMap(
        try self.requireEngine().sendImage(
          bytes: bytes,
          mimeType: mimeType,
          targetDevices: targetDevices
        )
      )
    }

    Function("registerInputFile") { (uri: String, displayName: String?) in
      try self.host.registerInputFile(uri: uri, displayName: displayName)
    }
    Function("registerOutputFile") { (uri: String) in
      try self.host.registerOutputFile(uri: uri)
    }
    Function("releaseFileHandle") { (handle: String) in self.host.releaseFileHandle(handle) }

    AsyncFunction("sendFiles") {
      (fileHandles: [String], targetDevices: [String]) -> [String: Any] in
      Self.sendReportMap(
        try self.requireEngine().sendFiles(
          fileHandles: fileHandles,
          targetDevices: targetDevices
        )
      )
    }

    AsyncFunction("captureCurrentClipboard") { () -> String? in
      try self.requireEngine().captureCurrentClipboard()
    }
    AsyncFunction("observeClipboardChange") { (dispatch: Bool) -> [String: Any]? in
      try self.requireEngine().observeClipboardChange(dispatch: dispatch).map(Self.sendReportMap)
    }
    AsyncFunction("restoreClipboard") { (entryId: String, mode: String) -> String in
      let result = try self.requireEngine().restoreClipboard(
        entryId: entryId,
        mode: Self.restoreMode(mode)
      )
      return Self.restoreOutcome(result)
    }
    AsyncFunction("exportEntry") { (entryId: String, destinationHandle: String) in
      try self.requireEngine().exportEntry(
        entryId: entryId,
        destinationHandle: destinationHandle
      )
    }

    OnAppEntersBackground {
      self.lifecycle.enterBackground(
        self.currentEngine().map { AppleEngineLifecycle(engine: $0, host: self.host) }
      )
    }
    OnAppEntersForeground {
      self.lifecycle.enterForeground(
        self.currentEngine().map { AppleEngineLifecycle(engine: $0, host: self.host) }
      )
    }
    OnAppContextDestroys { self.shutdownForDestroy() }
  }

  private func currentEngine() -> MobileEngine? {
    engines.current()
  }

  private func requireEngine() throws -> MobileEngine {
    guard let active = currentEngine() else { throw UcEngineNotStartedException() }
    return active
  }

  private func shutdownForDestroy() {
    let active = engines.take()
    defer { host.releaseRuntimeOwnership() }
    do {
      try active?.shutdown(deadlineMs: 2_000)
    } catch {
      Self.reportLifecycleError(error)
    }
    host.removeAllFileHandles()
  }

  private static func reportLifecycleError(_ error: Error) {
    NSLog("UcEngine lifecycle transition failed: %@", String(describing: error))
  }

  private static func sendReportMap(_ report: SendReport) -> [String: Any] {
    [
      "entryId": report.entryId,
      "atMs": report.atMs,
      "totalAccepted": report.totalAccepted,
      "totalDuplicate": report.totalDuplicate,
      "totalOffline": report.totalOffline,
      "totalErrored": report.totalErrored,
      "totalPending": report.totalPending,
    ]
  }

  private static func resendOutcomeMap(_ outcome: ResendEntryOutcome) -> [String: Any] {
    switch outcome {
    case .completed(let accepted, let duplicate, let offline, let errored, let pending):
      return [
        "kind": "completed",
        "accepted": accepted,
        "duplicate": duplicate,
        "offline": offline,
        "errored": errored,
        "pending": pending,
      ]
    case .entryNotFound(let entryId):
      return ["kind": "entryNotFound", "entryId": entryId]
    case .entryNotResendable(let entryId, let reason):
      let reasonName = switch reason {
      case .remoteOrigin: "remoteOrigin"
      case .payloadLost: "payloadLost"
      }
      return ["kind": "entryNotResendable", "entryId": entryId, "reason": reasonName]
    case .targetNotTrusted(let deviceId):
      return ["kind": "targetNotTrusted", "deviceId": deviceId]
    case .noEligibleTargets:
      return ["kind": "noEligibleTargets"]
    }
  }

  private static func failureMap(_ failure: BindingFailure) -> [String: Any] {
    [
      "code": failure.code,
      "category": String(describing: failure.category),
      "retryable": failure.retryable,
    ]
  }

  private static func eventMap(_ event: BindingEvent) -> [String: Any?] {
    switch event {
    case .stateChanged(let state):
      return ["type": "stateChanged", "state": stateName(state)]
    case .operationFinished(let operationId, let terminal, let failure):
      return [
        "type": "operationFinished",
        "operationId": operationId,
        "terminal": String(describing: terminal),
        "failure": failure.map(failureMap),
      ]
    case .lifecycleFailed(let action, let failure):
      return [
        "type": "lifecycleFailed",
        "action": lifecycleActionName(action),
        "failure": failureMap(failure),
      ]
    case .refreshRequired(let reason):
      return ["type": "refreshRequired", "reason": String(describing: reason)]
    case .fatal(let failure):
      return ["type": "fatal", "failure": failureMap(failure)]
    case .incomingEntry(let entryId, let attemptId, let preview, let origin):
      return [
        "type": "incomingEntry",
        "entryId": entryId,
        "attemptId": attemptId,
        "preview": preview,
        "origin": String(describing: origin),
      ]
    case .incomingPending(let entryId, let attemptId, let fromDevice, let totalBytes, let filenames):
      return [
        "type": "incomingPending",
        "entryId": entryId,
        "attemptId": attemptId,
        "fromDevice": fromDevice,
        "totalBytes": totalBytes,
        "filenames": filenames,
      ]
    case .receiveAttemptStateChanged(let entryId, let attemptId, let state):
      return [
        "type": "receiveAttemptStateChanged",
        "entryId": entryId,
        "attemptId": attemptId,
        "state": state,
      ]
    case .deliveryStatusChanged(let entryId, let targetDeviceId):
      return [
        "type": "deliveryStatusChanged",
        "entryId": entryId,
        "targetDeviceId": targetDeviceId,
      ]
    case .peerPresenceChanged(let deviceId, let state, let atMs):
      return [
        "type": "peerPresenceChanged",
        "deviceId": deviceId,
        "state": state,
        "atMs": atMs,
      ]
    case .transferProgress(
      let transferId,
      let entryId,
      let attemptId,
      let peerId,
      let direction,
      let completedBytes,
      let totalBytes
    ):
      return [
        "type": "transferProgress",
        "transferId": transferId,
        "entryId": entryId,
        "attemptId": attemptId,
        "peerId": peerId,
        "direction": String(describing: direction),
        "completedBytes": completedBytes,
        "totalBytes": totalBytes,
      ]
    case .transferStatusChanged(
      let transferId,
      let entryId,
      let attemptId,
      let status,
      let reason
    ):
      return [
        "type": "transferStatusChanged",
        "transferId": transferId,
        "entryId": entryId,
        "attemptId": attemptId,
        "status": status,
        "reason": reason,
      ]
    case .activeClipboardChanged(let snapshotHash, let entryId, let activatedAtMs, let activatedBy):
      return [
        "type": "activeClipboardChanged",
        "snapshotHash": snapshotHash,
        "entryId": entryId,
        "activatedAtMs": activatedAtMs,
        "activatedBy": activatedBy,
      ]
    case .changed(let kind):
      return ["type": "changed", "kind": kind]
    }
  }

  private static func lifecycleActionName(_ action: BindingLifecycleAction) -> String {
    switch action {
    case .suspend: "suspend"
    case .resume: "resume"
    }
  }

  private static func stateName(_ state: BindingEngineState) -> String {
    switch state {
    case .running: "running"
    case .quiescing: "quiescing"
    case .quiesced: "quiesced"
    case .suspended: "suspended"
    case .shuttingDown: "shuttingDown"
    case .stopped: "stopped"
    }
  }

  private static func restoreMode(_ value: String) -> BindingClipboardRestoreMode {
    switch value {
    case "plainText": .plainText
    case "filePaths": .filePaths
    default: .standard
    }
  }

  private static func restoreOutcome(_ value: BindingClipboardRestoreOutcome) -> String {
    switch value {
    case .restored: "restored"
    case .payloadUnavailable: "payloadUnavailable"
    case .notApplicable: "notApplicable"
    }
  }
}

private final class AppleEngineLifecycle: NativeEngineLifecycle {
  private let owned: RuntimeOwnedNativeLifecycle

  init(engine: MobileEngine, host: MainApplicationEngineHost) {
    owned = RuntimeOwnedNativeLifecycle(
      engine: AppleMobileEngineLifecycle(engine: engine),
      ownership: MainApplicationRuntimeOwnership(host: host)
    )
  }

  func recoverSession() throws -> NativeSessionRecovery {
    try owned.recoverSession()
  }

  func lifecycleState() throws -> NativeEngineLifecycleState {
    try owned.lifecycleState()
  }

  func suspend() throws {
    try owned.suspend()
  }

  func resume() throws {
    try owned.resume()
  }
}

private final class AppleMobileEngineLifecycle: NativeEngineLifecycle {
  private let engine: MobileEngine

  init(engine: MobileEngine) {
    self.engine = engine
  }

  func recoverSession() throws -> NativeSessionRecovery {
    let recovery = try engine.recoverSession(allowSecureStorageUnlock: true)
    return NativeSessionRecovery(unlocked: recovery.unlocked, resumed: recovery.resumed)
  }

  func lifecycleState() throws -> NativeEngineLifecycleState {
    switch try engine.lifecycleState() {
    case .running: .running
    case .quiescing: .quiescing
    case .quiesced: .quiesced
    case .suspended: .suspended
    case .shuttingDown: .shuttingDown
    case .stopped: .stopped
    }
  }

  func suspend() throws {
    try engine.suspend()
  }

  func resume() throws {
    try engine.resume()
  }
}

private final class MainApplicationRuntimeOwnership: NativeRuntimeOwnership {
  private let host: MainApplicationEngineHost

  init(host: MainApplicationEngineHost) {
    self.host = host
  }

  func acquire(timeoutMs: UInt64) throws -> Bool {
    try host.acquireRuntimeOwnership(timeoutMs: timeoutMs)
  }

  func release() {
    host.releaseRuntimeOwnership()
  }
}

private final class UcEngineNotStartedException: Exception, @unchecked Sendable {
  override var reason: String { "The shared P2P engine has not been started" }
}

private final class UcEngineAlreadyStartedException: Exception, @unchecked Sendable {
  override var reason: String { "The shared P2P engine is already running" }
}

private extension NSLock {
  func withLock<T>(_ operation: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try operation()
  }
}
