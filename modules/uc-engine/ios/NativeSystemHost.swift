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
  private let keychain: any KeychainAccessing

  init(service: String, keychain: any KeychainAccessing = SystemKeychain()) {
    self.service = service
    self.keychain = keychain
  }

  func get(key: String) throws -> Data? {
    let query = keychainQuery(key: key).merging([
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]) { _, new in new }
    switch keychain.copy(query: query) {
    case .success(let data): return data
    case .missing: return nil
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
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
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

final class AppleFileHandleRegistry: @unchecked Sendable {
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
