import Foundation
import OSLog
import UIKit
import UniformTypeIdentifiers

private let startupLog = Logger(subsystem: "app.uniclipboard", category: "uc-startup")

private func analyticsContext() -> BindingAnalyticsContext {
  var system = utsname()
  uname(&system)
  let machineSize = MemoryLayout.size(ofValue: system.machine)
  let architecture = withUnsafePointer(to: &system.machine) {
    $0.withMemoryRebound(to: CChar.self, capacity: machineSize) {
      String(cString: $0)
    }
  }
  #if DEBUG
    let appChannel = "development"
  #else
    let appChannel = "production"
  #endif
  return BindingAnalyticsContext(
    os: .ios,
    osVersion: UIDevice.current.systemVersion,
    deviceType: .mobile,
    arch: architecture,
    appChannel: appChannel
  )
}

public final class MainApplicationEngineHost: @unchecked Sendable {
  private let files = AppleFileHandleRegistry()
  private let ownershipStateLock = NSLock()
  private let analyticsStateLock = NSLock()
  private var ownership: P2pRuntimeOwnership?
  private var analytics: ApplePostHogAnalyticsHost?

  public init() {}

  public func start(appVersion: String, profileId: String) throws -> MobileEngine {
    let startedAt = ProcessInfo.processInfo.systemUptime
    startupLog.info("Waiting for shared runtime ownership")
    guard try P2pRuntimeHandoff.acquireForMainApplication(runtimeOwnership()) else {
      throw ExtensionP2pError.runtimeBusy
    }
    startupLog.info(
      "Shared runtime ownership acquired in \(Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000))ms"
    )
    do {
      let host = try AppleEngineHost(files: files, storageMode: .mainApplication)
      startupLog.info("Starting core engine")
      let analytics = try analyticsHost(appVersion: appVersion)
      let engine = try MobileEngine.startWithAnalytics(
        config: BindingConfig(appVersion: appVersion, profileId: profileId),
        host: host,
        analytics: analytics,
        context: analyticsContext()
      )
      startupLog.info(
        "Core engine started in \(Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000))ms"
      )
      return engine
    } catch {
      startupLog.error("Engine host start failed: \(String(describing: error))")
      releaseRuntimeOwnership()
      throw error
    }
  }

  public func acquireRuntimeOwnership(timeoutMs: UInt64) throws -> Bool {
    try runtimeOwnership().acquire(timeoutMs: timeoutMs)
  }

  public func releaseRuntimeOwnership() {
    ownershipStateLock.lock()
    let current = ownership
    ownershipStateLock.unlock()
    current?.release()
  }

  public func registerInputFile(uri: String, displayName: String?) throws -> String {
    try withHostBindingError {
      try files.register(uri: uri, writable: false, displayName: displayName)
    }
  }

  public func registerOutputFile(uri: String) throws -> String {
    try withHostBindingError { try files.register(uri: uri, writable: true) }
  }

  public func releaseFileHandle(_ handle: String) {
    files.remove(handle)
  }

  public func removeAllFileHandles() {
    files.removeAll()
  }

  public func refreshAnalyticsContext(engine: MobileEngine) {
    guard let analytics = try? analyticsHost(appVersion: nil) else { return }
    let count = (try? engine.listDevices().count) ?? 0
    analytics.updateApplicationContext(appVersion: currentAppVersion(), activeDeviceCount: count)
    let spaceID = try? engine.querySpaceState().spaceId
    try? analytics.ensureSpaceContext(spaceID: spaceID ?? nil, activeDeviceCount: count)
  }

  public func analyticsConsentEnabled() throws -> Bool {
    try analyticsHost(appVersion: nil).consentEnabled()
  }

  public func getAnalyticsState() throws -> [String: Any?] {
    try analyticsHost(appVersion: nil).getAnalyticsState()
  }

  public func setAnalyticsConsentEnabled(_ enabled: Bool) throws {
    try analyticsHost(appVersion: nil).setConsentEnabled(enabled)
  }

  public func resetAnalyticsIdentity() throws {
    try analyticsHost(appVersion: nil).resetAndIdentify()
  }

  private func analyticsHost(appVersion: String?) throws -> ApplePostHogAnalyticsHost {
    analyticsStateLock.lock()
    defer { analyticsStateLock.unlock() }
    if let analytics {
      if let appVersion { analytics.updateApplicationContext(appVersion: appVersion, activeDeviceCount: 0) }
      return analytics
    }
    let created = try ApplePostHogAnalyticsHost(appVersion: appVersion ?? "unknown")
    analytics = created
    return created
  }

  private func currentAppVersion() -> String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
  }

  private func runtimeOwnership() throws -> P2pRuntimeOwnership {
    ownershipStateLock.lock()
    defer { ownershipStateLock.unlock() }
    if let ownership { return ownership }
    let created = P2pRuntimeOwnership(
      lockURL: try P2pSharedStore.runtimeLockURL(mode: .mainApplication)
    )
    ownership = created
    return created
  }
}

public struct ExtensionP2pRecipient: Equatable, Sendable {
  public let deviceId: String
  public let displayName: String
  public let wasLastKnownOnline: Bool

  public init(deviceId: String, displayName: String, wasLastKnownOnline: Bool) {
    self.deviceId = deviceId
    self.displayName = displayName
    self.wasLastKnownOnline = wasLastKnownOnline
  }
}

/// P2P session for app extensions. Short-lived callers release it after one
/// operation; the keyboard may retain it only while its input view is visible.
public final class ExtensionP2pClientController: @unchecked Sendable {
  fileprivate let lifecycle: ExtensionRuntimeLifecycle<MobileEngine>

  public init() throws {
    let ownership = P2pRuntimeOwnership(
      lockURL: try P2pSharedStore.runtimeLockURL(mode: .extensionHost)
    )
    lifecycle = ExtensionRuntimeLifecycle(
      ownership: ownership,
      suspend: { try $0.suspend() },
      shutdown: { try? $0.shutdown(deadlineMs: 1_000) }
    )
  }

  public func stopForSuspension() {
    try? lifecycle.stopForSuspension()
  }
}

public final class ExtensionP2pClient: @unchecked Sendable {
  private let files: AppleFileHandleRegistry
  private let engine: MobileEngine
  private let controller: ExtensionP2pClientController
  private let localDeviceId: String
  private let operationLock = NSLock()
  private let coordinator: ExtensionSyncCoordinator

  public convenience init(
    appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
      as? String ?? "unknown"
  ) throws {
    try self.init(appVersion: appVersion, controller: ExtensionP2pClientController())
  }

  public init(
    appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
      as? String ?? "unknown",
    controller: ExtensionP2pClientController
  ) throws {
    let files = AppleFileHandleRegistry()
    do {
      var analytics: ApplePostHogAnalyticsHost?
      let engine = try controller.lifecycle.startEngine {
        let host = try AppleEngineHost(files: files, storageMode: .extensionHost)
        let createdAnalytics = try ApplePostHogAnalyticsHost(appVersion: appVersion)
        analytics = createdAnalytics
        return try MobileEngine.startWithAnalytics(
          config: BindingConfig(appVersion: appVersion, profileId: "default"),
          host: host,
          analytics: createdAnalytics,
          context: analyticsContext()
        )
      }
      _ = try engine.recoverSession(allowSecureStorageUnlock: true)
      try controller.lifecycle.ensureStartupCanFinish()
      guard try engine.querySpaceState().hasCompleted else {
        throw ExtensionP2pError.spaceUnavailable
      }
      let localDeviceId = try engine.queryLocalDevice().deviceId
      analytics?.updateApplicationContext(
        appVersion: appVersion,
        activeDeviceCount: (try? engine.listDevices().count) ?? 0
      )
      let count = (try? engine.listDevices().count) ?? 0
      let spaceID = try? engine.querySpaceState().spaceId
      try? analytics?.ensureSpaceContext(spaceID: spaceID ?? nil, activeDeviceCount: count)
      try controller.lifecycle.finishStartup()

      self.files = files
      self.engine = engine
      self.controller = controller
      self.localDeviceId = localDeviceId
      self.coordinator = ExtensionSyncCoordinator(
        engine: ExtensionMobileEngineAdapter(engine: engine, localDeviceId: localDeviceId)
      )
    } catch {
      controller.stopForSuspension()
      if let lifecycleError = error as? ExtensionRuntimeLifecycleError {
        switch lifecycleError {
        case .runtimeOwnershipUnavailable: throw ExtensionP2pError.runtimeBusy
        case .sessionClosed: throw ExtensionP2pError.sessionClosed
        }
      }
      throw error
    }
  }

  deinit {
    shutdown()
  }

  public func synchronize(
    // The core coalesces peer-online resyncs for 1.5s before dispatching. Keep
    // enough headroom for connection establishment and the inbound transfer.
    receiveTimeoutMs: UInt64 = 3_000,
    progress: ((ExtensionSendProgress) -> Void)? = nil,
    onPeerRefresh: ((ExtensionPeerRefreshReport) -> Void)? = nil,
    send: (() throws -> SendReport)? = nil
  ) throws -> ExtensionSyncResult {
    try operationLock.withLock {
      try withActiveSession {
        let sendOperation = send.map { operation in
          { try operation().extensionDeliveryReport }
        }
        return try coordinator.synchronize(
          send: sendOperation,
          receiveTimeoutMs: receiveTimeoutMs,
          progress: progress,
          onPeerRefresh: onPeerRefresh
        )
      }
    }
  }

  public func waitForRemoteChange(timeoutMs: UInt64 = 500) throws -> Bool {
    try operationLock.withLock {
      try withActiveSession {
        try coordinator.waitForRemoteChange(timeoutMs: timeoutMs)
      }
    }
  }

  public func waitForOutboundDelivery(
    entryId: String,
    expectedReceiverCount: UInt64,
    timeoutMs: UInt64,
    onTransferProgress: ((ExtensionTransferProgress) -> Void)? = nil
  ) throws {
    try operationLock.withLock {
      try withActiveSession {
        try coordinator.waitForOutboundDelivery(
          entryId: entryId,
          expectedReceiverCount: expectedReceiverCount,
          timeoutMs: timeoutMs,
          onTransferProgress: onTransferProgress
        )
      }
    }
  }

  public func shutdown() {
    controller.stopForSuspension()
    files.removeAll()
  }

  /// Reads the persisted space membership only. It intentionally does not
  /// refresh peer connections, so sharing can collect a recipient choice before
  /// opening a network connection.
  public func recipients() throws -> [ExtensionP2pRecipient] {
    try withActiveSession {
      try engine.listDevices().compactMap { device in
        guard device.deviceId != localDeviceId else { return nil }
        return ExtensionP2pRecipient(
          deviceId: device.deviceId,
          displayName: device.displayName,
          wasLastKnownOnline: device.online
        )
      }
    }
  }

  public func sendText(_ text: String, targetDevices: [String]) throws -> SendReport {
    try withActiveSession { try engine.sendText(text: text, targetDevices: targetDevices) }
  }

  public func sendImage(
    _ bytes: Data,
    mimeType: String,
    targetDevices: [String]
  ) throws -> SendReport {
    try withActiveSession {
      try engine.sendImage(bytes: bytes, mimeType: mimeType, targetDevices: targetDevices)
    }
  }

  public func sendFile(
    _ url: URL,
    displayName: String? = nil,
    targetDevices: [String]
  ) throws -> SendReport {
    try withActiveSession {
      try files.withRetainedInputFile(url: url, displayName: displayName) { handle in
        try engine.sendFiles(fileHandles: [handle], targetDevices: targetDevices)
      }
    }
  }

  private func withActiveSession<Result>(_ operation: () throws -> Result) throws -> Result {
    do {
      return try controller.lifecycle.withOperation(operation)
    } catch ExtensionRuntimeLifecycleError.sessionClosed {
      throw ExtensionP2pError.sessionClosed
    }
  }
}

public enum ExtensionP2pError: LocalizedError {
  case sharedStoreUnavailable
  case spaceUnavailable
  case runtimeBusy
  case sessionClosed
  case deliveryIncomplete(ExtensionDeliveryState)

  public var errorDescription: String? {
    switch self {
    case .sharedStoreUnavailable:
      return "Open UniClip once to prepare P2P sharing for extensions."
    case .spaceUnavailable:
      return "No P2P space is available for this extension."
    case .runtimeBusy:
      return "P2P sync is busy. Please try again."
    case .sessionClosed:
      return "This P2P extension session has ended."
    case .deliveryIncomplete(let state):
      switch state {
      case .partial: return "Some devices have not received this content yet."
      case .offline: return "The receiving device is offline."
      case .pending: return "This content is waiting to be sent."
      case .failed: return "P2P delivery failed."
      case .delivered: return nil
      }
    }
  }
}

enum P2pStorageMode: Equatable {
  case mainApplication
  case extensionHost
}

private enum P2pSharedStore {
  private static let rootName = "p2p"
  private static let readinessFilename = ".ready"
  private static let runtimeLockFilename = ".runtime.lock"
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

  static func runtimeLockURL(mode: P2pStorageMode) throws -> URL {
    try sharedP2pDirectory(mode: mode)
      .appendingPathComponent(runtimeLockFilename, isDirectory: false)
  }

  static func sharedKeychainAccessGroup() throws -> String {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "UCP2PKeychainAccessGroup") as? String,
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
      !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
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
    ]
    where fileManager.fileExists(atPath: source.path)
      && !fileManager.fileExists(atPath: destination.path)
    {
      try fileManager.copyItem(at: source, to: destination)
    }
  }
}

private final class ExtensionMobileEngineAdapter: ExtensionSyncEngine {
  private let engine: MobileEngine
  private let localDeviceId: String
  private var latestOutboundPeerByEntryId: [String: String] = [:]

  init(engine: MobileEngine, localDeviceId: String) {
    self.engine = engine
    self.localDeviceId = localDeviceId
  }

  func refreshPeerConnections() throws -> ExtensionPeerRefreshReport {
    let report = try engine.refreshPeerConnections()
    return ExtensionPeerRefreshReport(
      total: report.total,
      online: report.online,
      offline: report.offline,
      errors: report.errors
    )
  }

  func queryCurrentRemoteClipboardEntryId() throws -> String? {
    guard let active = try engine.queryActiveClipboard(), active.activatedBy != localDeviceId else {
      return nil
    }
    return active.entryId
  }

  func nextEvent(timeoutMs: UInt64) throws -> ExtensionSyncEvent? {
    guard let event = engine.nextEvent(timeoutMs: timeoutMs) else { return nil }
    switch event {
    case .activeClipboardChanged(_, let entryId, _, let activatedBy)
    where activatedBy != localDeviceId:
      return .remoteActiveClipboardChanged(entryId: entryId)
    case .transferProgress(
      _,
      let entryId,
      _,
      let peerId,
      let direction,
      let completedBytes,
      let totalBytes
    ) where direction == .sending:
      guard let entryId else { return .other }
      latestOutboundPeerByEntryId[entryId] = peerId
      return .outboundTransferProgress(
        entryId: entryId,
        peerId: peerId,
        completedBytes: completedBytes,
        totalBytes: totalBytes
      )
    case .transferStatusChanged(_, let entryId, _, let status, let reason):
      return .outboundTransferStatusChanged(
        entryId: entryId,
        peerId: latestOutboundPeerByEntryId.removeValue(forKey: entryId),
        status: status,
        reason: reason
      )
    default:
      return .other
    }
  }

  func restoreRemoteClipboard(entryId: String) throws -> Bool {
    try engine.restoreClipboard(entryId: entryId, mode: .standard) == .restored
  }
}

extension SendReport {
  fileprivate var extensionDeliveryReport: ExtensionDeliveryReport {
    ExtensionDeliveryReport(
      entryId: entryId,
      accepted: totalAccepted,
      duplicate: totalDuplicate,
      offline: totalOffline,
      errored: totalErrored,
      pending: totalPending
    )
  }
}

final class AppleEngineHost: BindingHost, @unchecked Sendable {
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
      guard
        let first = snapshot.representations.first(where: { representation in
          guard case .inline(let format, let mimeType, _) = representation else { return true }
          return !AppleClipboardDisplayMetadata.matches(format: format, mimeType: mimeType)
        })
      else {
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
