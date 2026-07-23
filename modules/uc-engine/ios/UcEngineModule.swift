import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

public final class UcEngineModule: Module {
  private let lock = NSLock()
  private let files = AppleFileHandleRegistry()
  private var engine: MobileEngine?

  public func definition() -> ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { (config: [String: String]) in
      let appVersion = config["appVersion"] ?? "unknown"
      let profileId = config["profileId"] ?? "default"
      let host = AppleEngineHost(files: self.files)
      let started = try MobileEngine.start(
        config: BindingConfig(appVersion: appVersion, profileId: profileId),
        host: host
      )
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

    Function("registerInputFile") { (uri: String) in
      try withHostBindingError { try self.files.register(uri: uri, writable: false) }
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

    OnAppEntersBackground { try? self.currentEngine()?.suspend() }
    OnAppEntersForeground { try? self.currentEngine()?.resume() }
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
    try? active?.shutdown(deadlineMs: 2_000)
    files.removeAll()
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
    case .refreshRequired(let reason):
      return ["type": "refreshRequired", "reason": String(describing: reason)]
    case .fatal(let failure):
      return ["type": "fatal", "failure": failureMap(failure)]
    case .changed(let kind):
      return ["type": "changed", "kind": kind]
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

private final class AppleEngineHost: BindingHost, @unchecked Sendable {
  private let files: AppleFileHandleRegistry
  private let secureStorage: AppleSecureStorage

  init(files: AppleFileHandleRegistry) {
    self.files = files
    let service = (Bundle.main.bundleIdentifier ?? "app.uniclipboard.mobile") + ".engine"
    self.secureStorage = AppleSecureStorage(service: service)
  }

  func privateDataDirectory() throws -> String {
    try applicationSupportDirectory().path
  }

  func cacheDirectory() throws -> String {
    let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("uc-engine", isDirectory: true)
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
      guard let first = snapshot.representations.first else {
        UIPasteboard.general.items = []
        return
      }
      switch first {
      case .inline(let format, let mimeType, let bytes):
        if format == "text/plain", let text = String(data: bytes, encoding: .utf8) {
          UIPasteboard.general.string = text
        } else if let image = UIImage(data: bytes) {
          UIPasteboard.general.image = image
        } else {
          let type = mimeType.flatMap { UTType(mimeType: $0) }?.identifier ?? format
          UIPasteboard.general.setData(bytes, forPasteboardType: type)
        }
      case .file(_, let handle, _, _, _):
        UIPasteboard.general.url = try withHostBindingError { try self.files.url(handle) }
      }
    }
  }

  private func applicationSupportDirectory() throws -> URL {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let url = root.appendingPathComponent("uc-engine", isDirectory: true)
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
