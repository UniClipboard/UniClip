import Foundation
import UIKit
import UniformTypeIdentifiers

public final class MainApplicationEngineHost: @unchecked Sendable {
  private let files = AppleFileHandleRegistry()

  public init() {}

  public func start(appVersion: String, profileId: String) throws -> MobileEngine {
    let host = try AppleEngineHost(files: files, storageMode: .mainApplication)
    return try MobileEngine.start(
      config: BindingConfig(appVersion: appVersion, profileId: profileId),
      host: host
    )
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
}

/// Short-lived P2P sender for app extensions. Each extension starts its own
/// engine against the protected shared store and stops it after sending.
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

enum P2pStorageMode: Equatable {
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
