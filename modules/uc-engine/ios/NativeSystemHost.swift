import Foundation
import Security
import UniformTypeIdentifiers

enum SystemHostError: Error, Equatable {
  case unavailable
  case permissionDenied
  case invalidHandle
  case io
}

enum KeychainCopyResult {
  case success(Data)
  case missing
  case failure(OSStatus)
}

protocol KeychainAccessing {
  func copy(query: [String: Any]) -> KeychainCopyResult
  func add(attributes: [String: Any]) -> OSStatus
  func update(query: [String: Any], attributes: [String: Any]) -> OSStatus
  func delete(query: [String: Any]) -> OSStatus
}

struct SystemKeychain: KeychainAccessing {
  func copy(query: [String: Any]) -> KeychainCopyResult {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return .missing }
    guard status == errSecSuccess, let data = item as? Data else { return .failure(status) }
    return .success(data)
  }

  func add(attributes: [String: Any]) -> OSStatus {
    SecItemAdd(attributes as CFDictionary, nil)
  }

  func update(query: [String: Any], attributes: [String: Any]) -> OSStatus {
    SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
  }

  func delete(query: [String: Any]) -> OSStatus {
    SecItemDelete(query as CFDictionary)
  }
}

final class AppleSecureStorage {
  private let service: String
  private let accessGroup: String?
  private let keychain: any KeychainAccessing
  private let legacyStorage: AppleSecureStorage?

  init(
    service: String,
    accessGroup: String? = nil,
    keychain: any KeychainAccessing = SystemKeychain(),
    legacyService: String? = nil
  ) {
    self.service = service
    self.accessGroup = accessGroup
    self.keychain = keychain
    self.legacyStorage = legacyService.map {
      AppleSecureStorage(service: $0, keychain: keychain)
    }
  }

  func get(key: String) throws -> Data? {
    let query = keychainQuery(key: key).merging([
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]) { _, new in new }
    switch keychain.copy(query: query) {
    case .success(let data): return data
    case .missing:
      // Main-app upgrades used a bundle-specific service before the P2P
      // engine became available to extensions. Lift the value once into the
      // access-group-protected service; extensions never create this fallback.
      guard let legacyStorage, let value = try legacyStorage.get(key: key) else { return nil }
      try set(key: key, value: value)
      return value
    case .failure(let status): throw Self.error(status)
    }
  }

  func set(key: String, value: Data) throws {
    let query = keychainQuery(key: key)
    let status = keychain.add(
      attributes: query.merging([kSecValueData as String: value]) { _, new in new }
    )
    if status == errSecDuplicateItem {
      let update = keychain.update(
        query: query,
        attributes: [kSecValueData as String: value]
      )
      guard update == errSecSuccess else { throw Self.error(update) }
    } else if status != errSecSuccess {
      throw Self.error(status)
    }
  }

  func delete(key: String) throws {
    let status = keychain.delete(query: keychainQuery(key: key))
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw Self.error(status)
    }
  }

  private func keychainQuery(key: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    if let accessGroup {
      query[kSecAttrAccessGroup as String] = accessGroup
    }
    return query
  }

  private static func error(_ status: OSStatus) -> SystemHostError {
    switch status {
    case errSecInteractionNotAllowed, errSecNotAvailable: .unavailable
    case errSecAuthFailed, errSecUserCanceled: .permissionDenied
    default: .io
    }
  }
}

struct AppleFileMetadata {
  let displayName: String
  let sizeBytes: UInt64
  let mimeType: String?
}

struct AppleClipboardDisplayMetadata: Decodable {
  static let format = "uniclipboard-file-display-metadata"
  static let mimeType = "application/x-uniclipboard-file-display-metadata+json"

  private struct Entry: Decodable {
    let storageName: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
      case storageName = "storage_name"
      case displayName = "display_name"
    }
  }

  private let files: [Entry]

  init(data: Data) throws {
    self = try JSONDecoder().decode(Self.self, from: data)
  }

  func displayName(for storageName: String) -> String? {
    files.first { $0.storageName == storageName }?.displayName
  }

  static func matches(format: String, mimeType: String?) -> Bool {
    format == Self.format || mimeType == Self.mimeType
  }
}

struct AppleClipboardFileSelection {
  let sourceURL: URL
  let displayName: String
}

enum AppleClipboardFileResolver {
  static func resolve(
    format: String,
    mimeType: String?,
    bytes: Data,
    metadata: AppleClipboardDisplayMetadata?,
    allowedRoots: [URL]
  ) -> AppleClipboardFileSelection? {
    let knownFormat = ["files", "public.file-url", "NSFilenamesPboardType"].contains(format)
    let knownMime = mimeType == "text/uri-list" || mimeType == "file/uri-list"
    guard knownFormat || knownMime,
      let uriList = String(data: bytes, encoding: .utf8),
      let value = uriList.split(whereSeparator: \.isNewline)
        .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
        .first(where: { !$0.isEmpty && !$0.hasPrefix("#") }),
      let parsed = URL(string: value), parsed.isFileURL
    else { return nil }

    let source = parsed.resolvingSymlinksInPath().standardizedFileURL
    let isAllowed = allowedRoots.contains { root in
      let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
      return source.path == rootPath || source.path.hasPrefix(rootPath + "/")
    }
    var isDirectory: ObjCBool = false
    guard isAllowed,
      FileManager.default.fileExists(atPath: source.path, isDirectory: &isDirectory),
      !isDirectory.boolValue
    else { return nil }

    return AppleClipboardFileSelection(
      sourceURL: source,
      displayName: metadata?.displayName(for: source.lastPathComponent)
        ?? source.lastPathComponent
    )
  }
}

final class AppleClipboardShareCache {
  private static let maximumEntries = 64
  private static let maximumAge: TimeInterval = 7 * 24 * 60 * 60

  private let root: URL
  private let fileManager: FileManager

  init(
    root: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("uc-engine-clipboard/shares", isDirectory: true),
    fileManager: FileManager = .default
  ) {
    self.root = root
    self.fileManager = fileManager
  }

  func create(displayName: String, write: (URL) throws -> Void) throws -> URL {
    do {
      try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
      try prune(now: Date(), maximumEntries: Self.maximumEntries - 1)
      let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      let target = directory.appendingPathComponent(Self.safeDisplayName(displayName))
      do {
        try write(target)
        return target
      } catch {
        try? fileManager.removeItem(at: directory)
        throw error
      }
    } catch let error as SystemHostError {
      throw error
    } catch {
      throw SystemHostError.io
    }
  }

  func prune(now: Date = Date()) throws {
    try prune(now: now, maximumEntries: Self.maximumEntries)
  }

  private func prune(now: Date, maximumEntries: Int) throws {
    guard fileManager.fileExists(atPath: root.path) else { return }
    do {
      let entries = try fileManager.contentsOfDirectory(
        at: root,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
      ).sorted {
        let left = try? $0.resourceValues(forKeys: [.contentModificationDateKey])
          .contentModificationDate
        let right = try? $1.resourceValues(forKeys: [.contentModificationDateKey])
          .contentModificationDate
        return (left ?? .distantPast) > (right ?? .distantPast)
      }
      for (index, entry) in entries.enumerated() {
        let modified = try entry.resourceValues(forKeys: [.contentModificationDateKey])
          .contentModificationDate ?? .distantPast
        if now.timeIntervalSince(modified) > Self.maximumAge || index >= maximumEntries {
          try fileManager.removeItem(at: entry)
        }
      }
    } catch let error as SystemHostError {
      throw error
    } catch {
      throw SystemHostError.io
    }
  }

  private static func safeDisplayName(_ value: String) -> String {
    let leaf = value.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? ""
    let sanitized = String(
      leaf.unicodeScalars.map { scalar in
        CharacterSet.controlCharacters.contains(scalar) ? "_" : Character(String(scalar))
      }
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    var result = ""
    var byteCount = 0
    for character in sanitized {
      let bytes = String(character).utf8.count
      guard byteCount + bytes <= 240 else { break }
      result.append(character)
      byteCount += bytes
    }
    return result.isEmpty || result == "." || result == ".." ? "file" : result
  }
}

final class AppleFileHandleRegistry: @unchecked Sendable {
  private struct Entry {
    let url: URL
    let writable: Bool
    let displayName: String?
  }

  private let lock = NSLock()
  private var entries: [String: Entry] = [:]

  func register(uri: String, writable: Bool, displayName: String? = nil) throws -> String {
    let url: URL
    if let parsed = URL(string: uri), parsed.isFileURL {
      url = parsed
    } else {
      url = URL(fileURLWithPath: uri)
    }
    return register(url: url, writable: writable, displayName: displayName)
  }

  func register(url: URL, writable: Bool, displayName: String? = nil) -> String {
    let handle = UUID().uuidString
    lock.withLock {
      entries[handle] = Entry(url: url, writable: writable, displayName: displayName)
    }
    return handle
  }

  func remove(_ handle: String) {
    _ = lock.withLock { entries.removeValue(forKey: handle) }
  }

  func removeAll() {
    lock.withLock { entries.removeAll() }
  }

  func url(_ handle: String) throws -> URL {
    guard let entry = lock.withLock({ entries[handle] }) else {
      throw SystemHostError.invalidHandle
    }
    return entry.url
  }

  func metadata(_ handle: String) throws -> AppleFileMetadata {
    let target = try entry(handle)
    return try scoped(target.url) {
      let values = try target.url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
      return AppleFileMetadata(
        displayName: target.displayName ?? target.url.lastPathComponent,
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

  func copy(_ handle: String, to destination: URL) throws {
    let target = try entry(handle)
    try scoped(target.url) {
      try FileManager.default.copyItem(at: target.url, to: destination)
    }
  }

  func write(_ handle: String, offset: UInt64, bytes: Data) throws {
    let target = try entry(handle)
    guard target.writable else { throw SystemHostError.permissionDenied }
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
    guard target.writable else { throw SystemHostError.permissionDenied }
    guard FileManager.default.fileExists(atPath: target.url.path) else {
      throw SystemHostError.io
    }
  }

  private func entry(_ handle: String) throws -> Entry {
    guard let value = lock.withLock({ entries[handle] }) else {
      throw SystemHostError.invalidHandle
    }
    return value
  }

  private func scoped<T>(_ url: URL, operation: () throws -> T) throws -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      return try operation()
    } catch let error as SystemHostError {
      throw error
    } catch {
      throw SystemHostError.io
    }
  }
}

extension NSLock {
  fileprivate func withLock<T>(_ operation: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try operation()
  }
}
