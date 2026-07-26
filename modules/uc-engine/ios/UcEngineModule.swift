import ExpoModulesCore
import Security
import UIKit
import UniformTypeIdentifiers

public final class UcEngineModule: Module {
  private let lock = NSLock()
  private let files = AppleFileHandleRegistry()
  private lazy var lifecycle = NativeLifecycleHost(report: Self.reportLifecycleError)
  private var engine: MobileEngine?

  public func definition() -> ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { (config: [String: String]) in
      let appVersion = config["appVersion"] ?? "unknown"
      let profileId = config["profileId"] ?? "default"
      let host = try AppleEngineHost(files: self.files, storageMode: .mainApplication)
      let started = try MobileEngine.start(
        config: BindingConfig(appVersion: appVersion, profileId: profileId),
        host: host
      )
      do {
        try self.lifecycle.prepare(AppleEngineLifecycle(engine: started))
      } catch {
        do {
          try started.shutdown(deadlineMs: 2_000)
        } catch {
          Self.reportLifecycleError(error)
        }
        throw error
      }
      let installed = self.lock.withLock {
        guard self.engine == nil else { return false }
        self.engine = started
        return true
      }
      guard installed else { throw UcEngineAlreadyStartedException() }
    }

    AsyncFunction("shutdown") { (deadlineMs: UInt64) in
      let active = self.lock.withLock { () -> MobileEngine? in
        defer { self.engine = nil }
        return self.engine
      }
      try active?.shutdown(deadlineMs: deadlineMs)
      self.files.removeAll()
    }

    AsyncFunction("suspend") { try self.requireEngine().suspend() }
    AsyncFunction("resume") { try self.requireEngine().resume() }

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
      try withHostBindingError {
        try self.files.register(uri: uri, writable: false, displayName: displayName)
      }
    }
    Function("registerOutputFile") { (uri: String) in
      try withHostBindingError { try self.files.register(uri: uri, writable: true) }
    }
    Function("releaseFileHandle") { (handle: String) in self.files.remove(handle) }

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
      self.lifecycle.enterBackground(self.currentEngine().map(AppleEngineLifecycle.init))
    }
    OnAppEntersForeground {
      self.lifecycle.enterForeground(self.currentEngine().map(AppleEngineLifecycle.init))
    }
    OnAppContextDestroys { self.shutdownForDestroy() }
  }

  private func currentEngine() -> MobileEngine? {
    lock.withLock { engine }
  }

  private func requireEngine() throws -> MobileEngine {
    guard let active = currentEngine() else { throw UcEngineNotStartedException() }
    return active
  }

  private func shutdownForDestroy() {
    let active = lock.withLock { () -> MobileEngine? in
      defer { engine = nil }
      return engine
    }
    do {
      try active?.shutdown(deadlineMs: 2_000)
    } catch {
      Self.reportLifecycleError(error)
    }
    files.removeAll()
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

/// Short-lived P2P sender for app extensions. The extensions have separate
/// processes, so they start their own engine against the same protected store
/// and shut it down as soon as the requested content has been queued.
public final class ExtensionP2pClient: @unchecked Sendable {
  private let files = AppleFileHandleRegistry()
  private let engine: MobileEngine

  public init(appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown") throws {
    let host = try AppleEngineHost(files: files, storageMode: .extensionHost)
    let engine = try MobileEngine.start(
      config: BindingConfig(appVersion: appVersion, profileId: "default"),
      host: host
    )
    do {
      _ = try engine.recoverSession(allowSecureStorageUnlock: true)
      guard try engine.querySpaceState().hasCompleted else {
        throw ExtensionP2pError.spaceUnavailable
      }
      self.engine = engine
    } catch {
      try? engine.shutdown(deadlineMs: 1_000)
      throw error
    }
  }

  deinit {
    try? engine.shutdown(deadlineMs: 1_000)
    files.removeAll()
  }

  public func sendText(_ text: String) throws -> SendReport {
    try engine.sendText(text: text, targetDevices: [])
  }

  public func sendImage(_ bytes: Data, mimeType: String) throws -> SendReport {
    try engine.sendImage(bytes: bytes, mimeType: mimeType, targetDevices: [])
  }

  public func sendFile(_ url: URL, displayName: String? = nil) throws -> SendReport {
    let handle = files.register(url: url, writable: false, displayName: displayName)
    defer { files.remove(handle) }
    return try engine.sendFiles(fileHandles: [handle], targetDevices: [])
  }
}

public enum ExtensionP2pError: LocalizedError {
  case sharedStoreUnavailable
  case spaceUnavailable

  public var errorDescription: String? {
    switch self {
    case .sharedStoreUnavailable:
      return "Open UniClip once to prepare P2P sharing for extensions."
    case .spaceUnavailable:
      return "No P2P space is available for this extension."
    }
  }
}

private enum P2pStorageMode: Equatable {
  case mainApplication
  case extensionHost
}

private enum P2pSharedStore {
  private static let rootName = "p2p"
  private static let readinessFilename = ".ready"
  private static let extensionSuffixes = [".Keyboard", ".Share"]

  static func sharedP2pDirectory(mode: P2pStorageMode) throws -> URL {
    guard let appGroupID = appGroupID(),
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupID
      )
    else {
      throw ExtensionP2pError.sharedStoreUnavailable
    }

    let root = container.appendingPathComponent(rootName, isDirectory: true)
    let ready = root.appendingPathComponent(readinessFilename, isDirectory: false)
    let fileManager = FileManager.default
    if mode == .extensionHost {
      guard fileManager.fileExists(atPath: ready.path) else {
        // An extension must never initialize an empty store before the main
        // app has had a chance to migrate its existing P2P identity.
        throw ExtensionP2pError.sharedStoreUnavailable
      }
      return root
    }

    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    if !fileManager.fileExists(atPath: ready.path) {
      try migrateLegacyDirectories(into: root)
      try Data("ready".utf8).write(to: ready, options: .atomic)
    }
    return root
  }

  static func sharedKeychainService() throws -> String {
    guard let appGroupID = appGroupID() else { throw ExtensionP2pError.sharedStoreUnavailable }
    return "\(appGroupID).uc-engine"
  }

  static func sharedKeychainAccessGroup() throws -> String {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "UCP2PKeychainAccessGroup") as? String,
      group.hasSuffix(".p2p"),
      !group.contains("$(")
    else {
      throw ExtensionP2pError.sharedStoreUnavailable
    }
    return group
  }

  static func legacyKeychainService() -> String? {
    guard var bundleID = Bundle.main.bundleIdentifier else { return nil }
    for suffix in extensionSuffixes where bundleID.hasSuffix(suffix) {
      bundleID.removeLast(suffix.count)
      break
    }
    return "\(bundleID).engine"
  }

  private static func appGroupID() -> String? {
    if let value = Bundle.main.object(forInfoDictionaryKey: "UCAppGroupIdentifier") as? String,
      !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return value
    }
    guard var bundleID = Bundle.main.bundleIdentifier else { return nil }
    for suffix in extensionSuffixes where bundleID.hasSuffix(suffix) {
      bundleID.removeLast(suffix.count)
      break
    }
    return "group.\(bundleID)"
  }

  private static func migrateLegacyDirectories(into root: URL) throws {
    let fileManager = FileManager.default
    let oldData = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("uc-engine", isDirectory: true)
    let oldCache = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("uc-engine", isDirectory: true)
    for (source, destination) in [
      (oldData, root.appendingPathComponent("data", isDirectory: true)),
      (oldCache, root.appendingPathComponent("cache", isDirectory: true)),
    ] where fileManager.fileExists(atPath: source.path)
      && !fileManager.fileExists(atPath: destination.path) {
      try fileManager.copyItem(at: source, to: destination)
    }
  }
}

private final class AppleEngineHost: BindingHost, @unchecked Sendable {
  private let files: AppleFileHandleRegistry
  private let clipboardShares = AppleClipboardShareCache()
  private let secureStorage: AppleSecureStorage
  private let p2pDirectory: URL

  init(files: AppleFileHandleRegistry, storageMode: P2pStorageMode) throws {
    self.files = files
    self.p2pDirectory = try P2pSharedStore.sharedP2pDirectory(mode: storageMode)
    self.secureStorage = AppleSecureStorage(
      service: try P2pSharedStore.sharedKeychainService(),
      accessGroup: try P2pSharedStore.sharedKeychainAccessGroup(),
      legacyService: storageMode == .mainApplication ? P2pSharedStore.legacyKeychainService() : nil
    )
  }

  func privateDataDirectory() throws -> String {
    try applicationSupportDirectory().path
  }

  func cacheDirectory() throws -> String {
    let url = p2pDirectory.appendingPathComponent("cache", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url.path
  }

  func temporaryDirectory() throws -> String {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "uc-engine",
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url.path
  }

  func secureStorageGet(key: String) throws -> Data? {
    try withHostBindingError { try secureStorage.get(key: key) }
  }

  func secureStorageSet(key: String, value: Data) throws {
    try withHostBindingError { try secureStorage.set(key: key, value: value) }
  }

  func secureStorageDelete(key: String) throws {
    try withHostBindingError { try secureStorage.delete(key: key) }
  }

  func fileMetadata(handle: String) throws -> BindingFileMetadata {
    try withHostBindingError {
      let metadata = try files.metadata(handle)
      return BindingFileMetadata(
        displayName: metadata.displayName,
        sizeBytes: metadata.sizeBytes,
        mimeType: metadata.mimeType
      )
    }
  }

  func fileReadChunk(handle: String, offset: UInt64, maxBytes: UInt32) throws -> Data {
    try withHostBindingError { try files.read(handle, offset: offset, maxBytes: maxBytes) }
  }

  func fileWriteChunk(handle: String, offset: UInt64, bytes: Data) throws {
    try withHostBindingError { try files.write(handle, offset: offset, bytes: bytes) }
  }

  func fileFinishWrite(handle: String) throws {
    try withHostBindingError { try files.finishWrite(handle) }
  }

  func clipboardRead() throws -> BindingClipboardSnapshot {
    try onMain {
      let pasteboard = UIPasteboard.general
      var representations: [BindingClipboardRepresentation] = []
      if let text = pasteboard.string, let bytes = text.data(using: .utf8) {
        representations.append(.inline(format: "text/plain", mimeType: "text/plain", bytes: bytes))
      } else if let image = pasteboard.image, let bytes = image.pngData() {
        representations.append(.inline(format: "image/png", mimeType: "image/png", bytes: bytes))
      } else if let url = pasteboard.url, url.isFileURL {
        let handle = self.files.register(url: url, writable: false)
        let metadata = try withHostBindingError { try self.files.metadata(handle) }
        representations.append(
          .file(
            format: metadata.mimeType ?? "application/octet-stream",
            handle: handle,
            displayName: metadata.displayName,
            mimeType: metadata.mimeType,
            sizeBytes: metadata.sizeBytes
          )
        )
      }
      return BindingClipboardSnapshot(
        observedAtMs: Int64(Date().timeIntervalSince1970 * 1_000),
        representations: representations
      )
    }
  }

  func clipboardWrite(snapshot: BindingClipboardSnapshot) throws {
    try onMain {
      let metadata = snapshot.representations.lazy.compactMap { representation in
        guard case .inline(let format, let mimeType, let bytes) = representation,
          AppleClipboardDisplayMetadata.matches(format: format, mimeType: mimeType)
        else { return nil as AppleClipboardDisplayMetadata? }
        return try? AppleClipboardDisplayMetadata(data: bytes)
      }.first
      guard let first = snapshot.representations.first(where: { representation in
        guard case .inline(let format, let mimeType, _) = representation else { return true }
        return !AppleClipboardDisplayMetadata.matches(format: format, mimeType: mimeType)
      }) else {
        UIPasteboard.general.items = []
        return
      }
      switch first {
      case .inline(let format, let mimeType, let bytes):
        let fileSelection = AppleClipboardFileResolver.resolve(
          format: format,
          mimeType: mimeType,
          bytes: bytes,
          metadata: metadata,
          allowedRoots: [
          try self.applicationSupportDirectory(),
            self.p2pDirectory.appendingPathComponent("cache", isDirectory: true),
            FileManager.default.temporaryDirectory,
          ]
        )
        if let fileSelection {
          UIPasteboard.general.url = try withHostBindingError {
            try self.clipboardShares.create(displayName: fileSelection.displayName) { target in
              try FileManager.default.copyItem(at: fileSelection.sourceURL, to: target)
            }
          }
        } else if format == "text/plain", let text = String(data: bytes, encoding: .utf8) {
          UIPasteboard.general.string = text
        } else if let image = UIImage(data: bytes) {
          UIPasteboard.general.image = image
        } else {
          let type = mimeType.flatMap { UTType(mimeType: $0) }?.identifier ?? format
          UIPasteboard.general.setData(bytes, forPasteboardType: type)
        }
      case .file(_, let handle, let displayName, _, _):
        UIPasteboard.general.url = try withHostBindingError {
          try self.clipboardShares.create(displayName: displayName) { target in
            try self.files.copy(handle, to: target)
          }
        }
      }
    }
  }

  private func applicationSupportDirectory() throws -> URL {
    let url = p2pDirectory.appendingPathComponent("data", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
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

private func withHostBindingError<T>(_ operation: () throws -> T) throws -> T {
  do {
    return try operation()
  } catch let error as SystemHostError {
    switch error {
    case .unavailable: throw HostBindingError.Unavailable
    case .permissionDenied: throw HostBindingError.PermissionDenied
    case .invalidHandle: throw HostBindingError.InvalidHandle
    case .io: throw HostBindingError.Io
    }
  }
}

private func onMain<T>(_ operation: @escaping () throws -> T) throws -> T {
  if Thread.isMainThread { return try operation() }
  return try DispatchQueue.main.sync(execute: operation)
}
