import Foundation

/// The only two content transports exposed by the main application. Keeping
/// this Codable lets the App Group settings blob remain forward compatible.
public enum SyncChannel: String, Codable, CaseIterable, Sendable {
    case p2p
    case lan
}
