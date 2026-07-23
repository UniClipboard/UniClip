import Foundation
import Security
import XCTest

@testable import UcEngineSystemHost

final class NativeSystemHostTests: XCTestCase {
  func testKeychainRoundTripUsesSystemKeychain() throws {
    let service = "app.uniclipboard.uc-engine.tests.\(UUID().uuidString)"
    let key = "identity"
    let value = Data("keychain-value".utf8)
    let storage = AppleSecureStorage(service: service)
    defer { try? storage.delete(key: key) }

    XCTAssertNil(try storage.get(key: key))
    try storage.set(key: key, value: value)
    XCTAssertEqual(try storage.get(key: key), value)
    try storage.delete(key: key)
    XCTAssertNil(try storage.get(key: key))
  }

  func testKeychainUnavailableReturnsStableFailure() throws {
    let storage = AppleSecureStorage(
      service: "app.uniclipboard.uc-engine.tests.unavailable",
      keychain: UnavailableKeychain()
    )

    XCTAssertThrowsError(try storage.get(key: "identity")) { error in
      XCTAssertEqual(error as? SystemHostError, .unavailable)
    }
  }

  func testOutputHandleWritesAndReadsBackIdenticalContent() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("uc-engine-host-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let destination = directory.appendingPathComponent("export.bin")
    let expected = Data((0..<32_769).map { UInt8($0 % 251) })
    let files = AppleFileHandleRegistry()
    let handle = files.register(url: destination, writable: true)

    try files.write(handle, offset: 0, bytes: expected.prefix(16_384))
    try files.write(handle, offset: 16_384, bytes: expected.dropFirst(16_384))
    try files.finishWrite(handle)

    let actual = try files.read(handle, offset: 0, maxBytes: UInt32(expected.count + 1))
    XCTAssertEqual(actual, expected)
    XCTAssertEqual(try Data(contentsOf: destination), expected)
    XCTAssertFalse(handle.contains(destination.path))
  }
}

private struct UnavailableKeychain: KeychainAccessing {
  func copy(query: [String: Any]) -> KeychainCopyResult {
    .failure(errSecNotAvailable)
  }

  func add(attributes: [String: Any]) -> OSStatus { errSecNotAvailable }
  func update(query: [String: Any], attributes: [String: Any]) -> OSStatus { errSecNotAvailable }
  func delete(query: [String: Any]) -> OSStatus { errSecNotAvailable }
}
