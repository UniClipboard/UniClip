import Foundation
import Security

public enum LanServerCredentialStore {
    private static let service = "app.uniclipboard.lan-servers"
    private static let keyPrefix = "uniclip.lan.server."

    public static func password(serverId: String) throws -> String? {
        try read(serverId: serverId, accessGroup: try sharedAccessGroup())
    }

    public static func loadAndMigratePassword(serverId: String) throws -> String? {
        if let shared = try password(serverId: serverId) { return shared }
        guard let legacy = try read(serverId: serverId, accessGroup: nil) else { return nil }
        try setPassword(legacy, serverId: serverId)
        // Keep the legacy copy until explicit removal. An unscoped delete would
        // also match the shared copy we just saved.
        return legacy
    }

    public static func setPassword(_ password: String, serverId: String) throws {
        let group = try sharedAccessGroup()
        try delete(serverId: serverId, accessGroup: group)
        var query = baseQuery(serverId: serverId, accessGroup: group)
        query[kSecValueData as String] = Data(password.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw credentialError(status) }
        // Never clean up with an unscoped query here: it includes this group.
    }

    public static func deletePassword(serverId: String, includeLegacy: Bool = false) throws {
        try delete(serverId: serverId, accessGroup: try sharedAccessGroup())
        if includeLegacy { try delete(serverId: serverId, accessGroup: nil) }
    }

    private static func read(serverId: String, accessGroup: String?) throws -> String? {
        var query = baseQuery(serverId: serverId, accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw credentialError(status) }
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(serverId: String, accessGroup: String?) throws {
        let status = SecItemDelete(baseQuery(serverId: serverId, accessGroup: accessGroup) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw credentialError(status)
        }
    }

    private static func baseQuery(serverId: String, accessGroup: String?) -> [String: Any] {
        let key = Data((keyPrefix + serverId).utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrGeneric as String: key,
            kSecAttrAccount as String: key,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    private static func sharedAccessGroup() throws -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "UCP2PKeychainAccessGroup") as? String else {
            throw credentialError(errSecMissingEntitlement)
        }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("$(") else {
            throw credentialError(errSecMissingEntitlement)
        }
        return value
    }

    private static func credentialError(_ status: OSStatus) -> NSError {
        NSError(
            domain: NSOSStatusErrorDomain,
            code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)" ]
        )
    }
}
