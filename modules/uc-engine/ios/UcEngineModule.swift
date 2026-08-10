import ExpoModulesCore
import Foundation
import OSLog
import UIKit
internal import UcEngineCore

public final class UcEngineModule: Module {
  private static let spaceReadLog = Logger(subsystem: "app.uniclipboard", category: "space-read")
  private static let startupLog = Logger(subsystem: "app.uniclipboard", category: "uc-startup")
  private let host = MainApplicationEngineHost()
  private lazy var lifecycle = NativeLifecycleHost(report: Self.reportLifecycleError)
  private lazy var lifecycleTransitions = NativeLifecycleTransitionCoordinator(
    lifecycle: lifecycle,
    queue: DispatchQueue(label: "app.uniclipboard.engine-lifecycle"),
    beginBackgroundActivity: Self.beginBackgroundActivity
  )
  private let engineOperationQueue = DispatchQueue(label: "app.uniclipboard.uc-engine")
  private let engineEventQueue = DispatchQueue(label: "app.uniclipboard.uc-engine-events")
  private let engines = NativeEngineRegistry<MobileEngine>()

  public func definition() -> ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { (config: [String: String]) in
      let startedAt = ProcessInfo.processInfo.systemUptime
      let appVersion = config["appVersion"] ?? "unknown"
      let profileId = config["profileId"] ?? "default"
      Self.startupLog.info("Native module start requested")
      let started = try self.host.start(appVersion: appVersion, profileId: profileId)
      Self.startupLog.info(
        "Engine host started in \(Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000))ms"
      )
      do {
        let installed = try self.engines.installBeforePreparing(started) { engine in
          let recoveryStartedAt = ProcessInfo.processInfo.systemUptime
          Self.startupLog.info("Recovering persisted session")
          try self.lifecycle.prepare(AppleEngineLifecycle(engine: engine, host: self.host))
          self.host.refreshAnalyticsContext(engine: engine)
          Self.startupLog.info(
            "Persisted session recovered in \(Int((ProcessInfo.processInfo.systemUptime - recoveryStartedAt) * 1_000))ms"
          )
        }
        guard installed else {
          throw UcEngineAlreadyStartedException()
        }
        Self.startupLog.info(
          "Native module ready in \(Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000))ms"
        )
      } catch {
        Self.startupLog.error("Native module start failed: \(String(describing: error))")
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
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("shutdown") { (deadlineMs: UInt64) in
      let active = self.engines.take()
      defer { self.host.releaseRuntimeOwnership() }
      try active?.shutdown(deadlineMs: deadlineMs)
      self.host.removeAllFileHandles()
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("suspend") {
      try self.lifecycle.suspendIfNeeded(
        AppleEngineLifecycle(engine: self.requireEngine(), host: self.host)
      )
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("resume") {
      try self.lifecycle.resumeIfNeeded(
        AppleEngineLifecycle(engine: self.requireEngine(), host: self.host)
      )
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("setBackgroundSyncEnabled") { (_: Bool, _: Bool) in }
      .runOnQueue(engineOperationQueue)

    AsyncFunction("getAnalyticsConsent") { try self.host.analyticsConsentEnabled() }
      .runOnQueue(engineOperationQueue)
    AsyncFunction("getAnalyticsState") { try self.host.getAnalyticsState() }
      .runOnQueue(engineOperationQueue)
    AsyncFunction("setAnalyticsConsent") { (enabled: Bool) in
      try self.host.setAnalyticsConsentEnabled(enabled)
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("resetAnalyticsIdentity") { try self.host.resetAnalyticsIdentity() }
      .runOnQueue(engineOperationQueue)

    AsyncFunction("createSpace") { (deviceName: String?, passphrase: String) -> [String: Any] in
      let engine = try self.requireEngine()
      let result = try engine.createSpace(
        deviceName: deviceName,
        passphrase: passphrase
      )
      self.host.refreshAnalyticsContext(engine: engine)
      return [
        "spaceId": result.spaceId,
        "selfDeviceId": result.selfDeviceId,
        "identityFingerprint": result.identityFingerprint,
      ]
    }.runOnQueue(engineOperationQueue)

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
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("joinSpace") {
      (
        invitationCode: String,
        deviceName: String?,
        passphrase: String,
        preserveUnreadableHistory: Bool
      ) -> [String: Any] in
      let engine = try self.requireEngine()
      let result = try engine.joinSpace(
        invitationCode: invitationCode,
        deviceName: deviceName,
        passphrase: passphrase,
        preserveUnreadableHistory: preserveUnreadableHistory
      )
      self.host.refreshAnalyticsContext(engine: engine)
      return [
        "sponsorDeviceId": result.sponsorDeviceId,
        "sponsorIdentityFingerprint": result.sponsorIdentityFingerprint,
        "spaceId": result.spaceId,
        "selfDeviceId": result.selfDeviceId,
        "selfIdentityFingerprint": result.selfIdentityFingerprint,
        "migratedRecords": result.migratedRecords ?? 0,
        "preservedUnreadableRecords": result.preservedUnreadableRecords ?? 0,
      ]
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("nextEvent") { (timeoutMs: UInt64) -> [String: Any?]? in
      try self.requireEngine().nextEvent(timeoutMs: timeoutMs).map(Self.eventMap)
    }.runOnQueue(engineEventQueue)

    AsyncFunction("refreshPeerConnections") { () -> [String: Any] in
      let result = try self.requireEngine().refreshPeerConnections()
      return [
        "total": result.total,
        "online": result.online,
        "offline": result.offline,
        "errors": result.errors,
      ]
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("saveCustomRelayNode") {
      (url: String, accessToken: String, previousUrl: String?) -> [String: Any] in
      let result = try self.requireEngine().saveCustomRelay(
        url: url,
        accessToken: accessToken,
        previousUrl: previousUrl
      )
      return ["configured": result.configured]
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("querySpaceState") { () -> [String: Any?] in
      let result = try self.runSpaceRead("querySpaceState") {
        try self.requireEngine().querySpaceState()
      }
      Self.spaceReadLog.info(
        "space_read operation=querySpaceState outcome=success hasCompleted=\(result.hasCompleted, privacy: .public) hasSpace=\(result.spaceId != nil, privacy: .public) hasInvitation=\(result.currentInvitation != nil, privacy: .public)"
      )
      return [
        "hasCompleted": result.hasCompleted,
        "spaceId": result.spaceId,
        "currentInvitation": result.currentInvitation.map {
          ["invitationCode": $0.invitationCode, "expiresAtMs": $0.expiresAtMs]
        },
        "deviceName": result.deviceName,
      ]
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("listDevices") { () -> [[String: Any]] in
      let engine = try self.requireEngine()
      let devices = try self.runSpaceRead("listDevices") {
        self.host.refreshAnalyticsContext(engine: engine)
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
      Self.spaceReadLog.info(
        "space_read operation=listDevices outcome=success deviceCount=\(devices.count, privacy: .public)"
      )
      return devices
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("removeMember") { (deviceId: String) -> [String: Any?] in
      let engine = try self.requireEngine()
      let result = try engine.removeMember(deviceId: deviceId)
      self.host.refreshAnalyticsContext(engine: engine)
      return Self.memberRevocationResultMap(result)
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("queryCurrentMemberRevocation") { () -> [String: Any?]? in
      let result = try self.runSpaceRead("queryCurrentMemberRevocation") {
        try self.requireEngine().queryCurrentMemberRevocation()
      }
      Self.spaceReadLog.info(
        "space_read operation=queryCurrentMemberRevocation outcome=success hasRevocation=\(result != nil, privacy: .public)"
      )
      return result.map(Self.memberRevocationResultMap)
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("continueMemberRevocation") {
      (revocationId: String, permanentlyLostDeviceIds: [String]) -> [String: Any?] in
      let engine = try self.requireEngine()
      let result = try engine.continueMemberRevocation(
        revocationId: revocationId,
        permanentlyLostDeviceIds: permanentlyLostDeviceIds
      )
      self.host.refreshAnalyticsContext(engine: engine)
      return Self.memberRevocationResultMap(result)
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("secureRemoveLegacyMember") { (deviceId: String) -> [String: Any?] in
      let engine = try self.requireEngine()
      let result = try engine.secureRemoveLegacyMember(deviceId: deviceId)
      self.host.refreshAnalyticsContext(engine: engine)
      return Self.legacyMemberRemovalResultMap(result)
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("resendEntry") {
      (entryId: String, targetDevices: [String]) -> [String: Any] in
      Self.resendOutcomeMap(
        try self.requireEngine().resendEntry(entryId: entryId, targetDevices: targetDevices)
      )
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("leaveSpace") {
      let engine = try self.requireEngine()
      try engine.leaveSpace()
      self.host.refreshAnalyticsContext(engine: engine)
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("sendText") { (text: String, targetDevices: [String]) -> [String: Any] in
      Self.sendReportMap(
        try self.requireEngine().sendText(text: text, targetDevices: targetDevices)
      )
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("sendImage") {
      (bytes: Data, mimeType: String, targetDevices: [String]) -> [String: Any] in
      Self.sendReportMap(
        try self.requireEngine().sendImage(
          bytes: bytes,
          mimeType: mimeType,
          targetDevices: targetDevices
        )
      )
    }.runOnQueue(engineOperationQueue)

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
    }.runOnQueue(engineOperationQueue)

    AsyncFunction("captureCurrentClipboard") { () -> String? in
      try self.requireEngine().captureCurrentClipboard()
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("observeClipboardChange") { (dispatch: Bool) -> [String: Any]? in
      try self.requireEngine().observeClipboardChange(dispatch: dispatch).map(Self.sendReportMap)
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("observeClipboardTextChange") { (text: String, dispatch: Bool) -> [String: Any]? in
      if dispatch {
        return Self.sendReportMap(try self.requireEngine().sendText(text: text, targetDevices: []))
      }
      return try self.requireEngine().observeClipboardChange(dispatch: false).map(Self.sendReportMap)
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("restoreClipboard") { (entryId: String, mode: String) -> String in
      let result = try self.requireEngine().restoreClipboard(
        entryId: entryId,
        mode: Self.restoreMode(mode)
      )
      return Self.restoreOutcome(result)
    }.runOnQueue(engineOperationQueue)
    AsyncFunction("exportEntry") { (entryId: String, destinationHandle: String) in
      try self.requireEngine().exportEntry(
        entryId: entryId,
        destinationHandle: destinationHandle
      )
    }.runOnQueue(engineOperationQueue)

    OnAppEntersBackground {
      self.lifecycleTransitions.enterBackground(
        self.currentEngine().map { AppleEngineLifecycle(engine: $0, host: self.host) }
      )
    }
    OnAppEntersForeground {
      self.lifecycleTransitions.enterForeground(
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

  private func runSpaceRead<T>(_ operation: String, read: () throws -> T) throws -> T {
    do {
      return try read()
    } catch {
      Self.reportSpaceReadError(operation, error: error)
      throw error
    }
  }

  private static func reportSpaceReadError(_ operation: String, error: Error) {
    if let bindingError = error as? BindingError,
       case let .Engine(code, category, retryable) = bindingError {
      spaceReadLog.error(
        "space_read operation=\(operation, privacy: .public) outcome=failure errorKind=engine errorCode=\(code, privacy: .public) errorCategory=\(String(describing: category), privacy: .public) retryable=\(retryable, privacy: .public)"
      )
      return
    }
    spaceReadLog.error(
      "space_read operation=\(operation, privacy: .public) outcome=failure errorKind=\(String(describing: type(of: error)), privacy: .public)"
    )
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
    Self.startupLog.error("UcEngine lifecycle transition failed: \(String(describing: error))")
  }

  private static func beginBackgroundActivity() -> @Sendable () -> Void {
    let activity = UIKitBackgroundActivity()
    activity.begin()
    return { activity.end() }
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
    case .memberRevocationChanged(let revocation):
      return ["type": "memberRevocationChanged", "revocation": memberRevocationResultMap(revocation)]
#if UC_ENGINE_LOCAL_CORE
    // The local Engine worktree still exposes the shared-device refresh event
    // with a progress payload. Translate it to a generic changed event; the
    // JavaScript device refresh policy keys off `pairing_completed` only.
    case .sharedDeviceRefreshChanged(refresh:):
      return ["type": "changed", "kind": "sharedDeviceRefreshChanged"]
#endif
    case .networkRecoveryChanged(let phase, let retryable, let nextRetryInMs):
      return [
        "type": "networkRecoveryChanged",
        "phase": phase,
        "retryable": retryable,
        "nextRetryInMs": nextRetryInMs,
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

  private static func memberRevocationResultMap(_ result: MemberRevocationResult) -> [String: Any?] {
    let outcome: String
    switch result.outcome {
    case .localOnly: outcome = "localOnly"
    case .recovering: outcome = "recovering"
    case .applied: outcome = "applied"
    case .complete: outcome = "complete"
    case .recoveryRequired: outcome = "recoveryRequired"
    }
    return [
      "revocationId": result.revocationId,
      "outcome": outcome,
      "pendingRecipients": result.pendingRecipients,
      "removedDeviceIds": result.removedDeviceIds,
      "pendingRecipientDeviceIds": result.pendingRecipientDeviceIds,
      "updatedAtMs": result.updatedAtMs,
    ]
  }

  private static func legacyMemberRemovalResultMap(
    _ result: LegacyMemberRemovalResult
  ) -> [String: Any?] {
    let outcome: String
    switch result.outcome {
    case .awaitingReadmission: outcome = "awaitingReadmission"
    case .complete: outcome = "complete"
    case .recoveryRequired: outcome = "recoveryRequired"
    }
    return [
      "bootstrapId": result.bootstrapId,
      "outcome": outcome,
      "pendingReadmission": result.pendingReadmission,
    ]
  }
}

private final class UIKitBackgroundActivity: @unchecked Sendable {
  private let lock = NSLock()
  private var identifier: UIBackgroundTaskIdentifier = .invalid

  func begin() {
    let identifier = UIApplication.shared.beginBackgroundTask(
      withName: "UniClip Engine Suspend",
      expirationHandler: { [weak self] in self?.end() }
    )
    lock.withLock { self.identifier = identifier }
  }

  func end() {
    let active = lock.withLock {
      defer { identifier = .invalid }
      return identifier
    }
    guard active != .invalid else { return }
    DispatchQueue.main.async {
      UIApplication.shared.endBackgroundTask(active)
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
