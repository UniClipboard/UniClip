import CryptoKit
import Foundation

/// The extension targets compile this file without the UcEngineCore pod, so
/// this mirrors `ExtensionStableIdentifier` in
/// `modules/uc-engine/ios/ExtensionSyncCoordinator.swift`. Keep both in sync.
public enum ExtensionStableIdentifier {
  public static func uuid(for value: String) -> UUID {
    let digest: String
    if value.hasPrefix("blake3v1:") {
      digest = String(value.dropFirst("blake3v1:".count))
    } else {
      digest = value
    }
    if let bytes = firstUUIDBytes(fromHex: digest) {
      return uuid(from: bytes)
    }
    return uuid(from: Array(SHA256.hash(data: Data(value.utf8)).prefix(16)))
  }

  private static func firstUUIDBytes(fromHex value: String) -> [UInt8]? {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(16)
    var iterator = value.makeIterator()
    while bytes.count < 16, let high = iterator.next(), let low = iterator.next() {
      guard let highValue = high.hexDigitValue, let lowValue = low.hexDigitValue else {
        return nil
      }
      bytes.append(UInt8(highValue << 4 | lowValue))
    }
    return bytes.count == 16 ? bytes : nil
  }

  private static func uuid(from bytes: [UInt8]) -> UUID {
    UUID(
      uuid: (
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15]
      )
    )
  }
}
