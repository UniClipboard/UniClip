import ExpoModulesCore
import Security
import UIKit
import UniformTypeIdentifiers

public final class UcEngineModule: Module {
  private let lock = NSLock()
  private let files = FileHandleRegistry()
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
      try self.files.register(uri: uri, writable: false)
    }
    Function("registerOutputFile") { (uri: String) in
      try self.files.register(uri: uri, writable: true)
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
  private let files: FileHandleRegistry
  private let keychainService: String

  init(files: FileHandleRegistry) {
    self.files = files
    self.keychainService = (Bundle.main.bundleIdentifier ?? "app.uniclipboard.mobile") + ".engine"
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
    let query = keychainQuery(key: key).merging([
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]) { _, new in new }
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else { throw keychainError(status) }
    return data
  }

  func secureStorageSet(key: String, value: Data) throws {
    let query = keychainQuery(key: key)
    let status = SecItemAdd(
      query.merging([kSecValueData as String: value]) { _, new in new } as CFDictionary,
      nil
    )
    if status == errSecDuplicateItem {
      let update = SecItemUpdate(
        query as CFDictionary,
        [kSecValueData as String: value] as CFDictionary
      )
      guard update == errSecSuccess else { throw keychainError(update) }
    } else if status != errSecSuccess {
      throw keychainError(status)
    }
  }

  func secureStorageDelete(key: String) throws {
    let status = SecItemDelete(keychainQuery(key: key) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw keychainError(status)
    }
  }

  func fileMetadata(handle: String) throws -> BindingFileMetadata {
    try files.metadata(handle)
  }

  func fileReadChunk(handle: String, offset: UInt64, maxBytes: UInt32) throws -> Data {
    try files.read(handle, offset: offset, maxBytes: maxBytes)
  }

  func fileWriteChunk(handle: String, offset: UInt64, bytes: Data) throws {
    try files.write(handle, offset: offset, bytes: bytes)
  }

  func fileFinishWrite(handle: String) throws {
    try files.finishWrite(handle)
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
        let metadata = try self.files.metadata(handle)
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
        UIPasteboard.general.url = try self.files.url(handle)
      }
    }
  }

  private func applicationSupportDirectory() throws -> URL {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let url = root.appendingPathComponent("uc-engine", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func keychainQuery(key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: key,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
  }

  private func keychainError(_ status: OSStatus) -> HostBindingError {
    switch status {
    case errSecInteractionNotAllowed, errSecNotAvailable: .Unavailable
    case errSecAuthFailed, errSecUserCanceled: .PermissionDenied
    default: .Io
    }
  }
}

private final class FileHandleRegistry: @unchecked Sendable {
  private struct Entry {
    let url: URL
    let writable: Bool
  }

  private let lock = NSLock()
  private var entries: [String: Entry] = [:]

  func register(uri: String, writable: Bool) throws -> String {
    let url: URL
    if let parsed = URL(string: uri), parsed.isFileURL {
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    return register(url: url, writable: writable)
  }

  func register(url: URL, writable: Bool) -> String {
    let handle = UUID().uuidString
    lock.withLock { entries[handle] = Entry(url: url, writable: writable) }
    return handle
  }

  func remove(_ handle: String) {
    _ = lock.withLock { entries.removeValue(forKey: handle) }
  }

  func removeAll() {
    lock.withLock { entries.removeAll() }
  }

  func url(_ handle: String) throws -> URL {
    guard let entry = lock.withLock({ entries[handle] }) else { throw HostBindingError.InvalidHandle }
    return entry.url
  }

  func metadata(_ handle: String) throws -> BindingFileMetadata {
    let target = try entry(handle)
    return try scoped(target.url) {
      let values = try target.url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
      return BindingFileMetadata(
        displayName: target.url.lastPathComponent,
        sizeBytes: UInt64(values.fileSize ?? 0),
        mimeType: values.contentType?.preferredMIMEType
      )
    }
  }

  func read(_ handle: String, offset: UInt64, maxBytes: UInt32) throws -> Data {
    let target = try entry(handle)
    return try scoped(target.url) {
      let file = try FileHandle(forReadingFrom: target.url)
      defer { try? file.close() }
      try file.seek(toOffset: offset)
      return try file.read(upToCount: Int(maxBytes)) ?? Data()
    }
  }

  func write(_ handle: String, offset: UInt64, bytes: Data) throws {
    let target = try entry(handle)
    guard target.writable else { throw HostBindingError.PermissionDenied }
    try scoped(target.url) {
      if !FileManager.default.fileExists(atPath: target.url.path) {
        FileManager.default.createFile(atPath: target.url.path, contents: nil)
      }
      let file = try FileHandle(forWritingTo: target.url)
      defer { try? file.close() }
      try file.seek(toOffset: offset)
      try file.write(contentsOf: bytes)
    }
  }

  func finishWrite(_ handle: String) throws {
    let target = try entry(handle)
    guard target.writable else { throw HostBindingError.PermissionDenied }
    guard FileManager.default.fileExists(atPath: target.url.path) else { throw HostBindingError.Io }
  }

  private func entry(_ handle: String) throws -> Entry {
    guard let value = lock.withLock({ entries[handle] }) else { throw HostBindingError.InvalidHandle }
    return value
  }

  private func scoped<T>(_ url: URL, operation: () throws -> T) throws -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do { return try operation() } catch { throw HostBindingError.Io }
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

private func onMain<T>(_ operation: @escaping () throws -> T) throws -> T {
  if Thread.isMainThread { return try operation() }
  return try DispatchQueue.main.sync(execute: operation)
}
