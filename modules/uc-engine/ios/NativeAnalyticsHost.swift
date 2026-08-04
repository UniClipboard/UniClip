import CryptoKit
import Foundation

private enum AnalyticsKey {
  static let consent = "usage_analytics_enabled"
  static let anonymous = "anonymous_user_id"
  static let device = "analytics_device_id"
  static let spacePerson = "space_person_id"
  static let spaceGroup = "space_id_hash"
  static let spaceGroupIdentified = "space_group_identified"
  static let hasCaptured = "has_captured_event"
}

final class AppleAnalyticsStore: @unchecked Sendable {
  private let defaults: UserDefaults
  private let queueDirectory: URL
  private let lock = NSLock()
  private var queueSequence: UInt64 = 0

  init() throws {
    guard let groupID = Self.appGroupID(), let defaults = UserDefaults(suiteName: groupID),
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)
    else { throw BindingAnalyticsHostError.ContextUnavailable }
    self.defaults = defaults
    queueDirectory = container.appendingPathComponent("analytics/queue", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: queueDirectory, withIntermediateDirectories: true)
    } catch { throw BindingAnalyticsHostError.PersistenceFailed }
  }

  var isEnabled: Bool {
    lock.withAnalyticsLock { defaults.object(forKey: AnalyticsKey.consent) as? Bool ?? true }
  }

  func setEnabled(_ enabled: Bool) throws {
    try lock.withAnalyticsLock {
      defaults.set(enabled, forKey: AnalyticsKey.consent)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
  }

  init(defaults: UserDefaults, queueDirectory: URL) throws {
    self.defaults = defaults
    self.queueDirectory = queueDirectory
    do {
      try FileManager.default.createDirectory(at: queueDirectory, withIntermediateDirectories: true)
    } catch { throw BindingAnalyticsHostError.PersistenceFailed }
  }

  func anonymousID() throws -> String { try value(forKey: AnalyticsKey.anonymous) }
  func deviceID() throws -> String { try value(forKey: AnalyticsKey.device) }
  func currentSpacePersonID() -> String? {
    lock.withAnalyticsLock { defaults.string(forKey: AnalyticsKey.spacePerson) }
  }
  func currentSpaceGroupKey() -> String? {
    lock.withAnalyticsLock { defaults.string(forKey: AnalyticsKey.spaceGroup) }
  }
  func isSpaceGroupIdentified() -> Bool {
    lock.withAnalyticsLock { defaults.bool(forKey: AnalyticsKey.spaceGroupIdentified) }
  }
  func currentDistinctID() throws -> String {
    try lock.withAnalyticsLock {
      if let spacePerson = defaults.string(forKey: AnalyticsKey.spacePerson) {
        return spacePerson
      }
      return try identifier(forKey: AnalyticsKey.anonymous)
    }
  }

  func adopt(_ value: String) throws -> BindingAnalyticsIdentityChange {
    guard UUID(uuidString: value) != nil else { throw BindingAnalyticsHostError.InvalidIdentity }
    let previous = try currentDistinctID()
    try save(value, forKey: AnalyticsKey.spacePerson)
    return BindingAnalyticsIdentityChange(previousDistinctId: previous, newDistinctId: value)
  }

  func release() throws -> BindingAnalyticsIdentityChange {
    let previous = try currentDistinctID()
    let anonymous = try anonymousID()
    try lock.withAnalyticsLock {
      defaults.removeObject(forKey: AnalyticsKey.spacePerson)
      defaults.removeObject(forKey: AnalyticsKey.spaceGroup)
      defaults.removeObject(forKey: AnalyticsKey.spaceGroupIdentified)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
    return BindingAnalyticsIdentityChange(previousDistinctId: previous, newDistinctId: anonymous)
  }

  func resetTelemetryIdentity() throws -> BindingAnalyticsIdentityChange {
    let previous = try currentDistinctID()
    let anonymous = UUID().uuidString.lowercased()
    try lock.withAnalyticsLock {
      defaults.set(anonymous, forKey: AnalyticsKey.anonymous)
      defaults.set(UUID().uuidString.lowercased(), forKey: AnalyticsKey.device)
      defaults.removeObject(forKey: AnalyticsKey.spacePerson)
      defaults.removeObject(forKey: AnalyticsKey.spaceGroup)
      defaults.removeObject(forKey: AnalyticsKey.spaceGroupIdentified)
      defaults.removeObject(forKey: AnalyticsKey.hasCaptured)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
    return BindingAnalyticsIdentityChange(previousDistinctId: previous, newDistinctId: anonymous)
  }

  func setSpaceGroupKey(_ value: String, identified: Bool) throws {
    try lock.withAnalyticsLock {
      defaults.set(value, forKey: AnalyticsKey.spaceGroup)
      defaults.set(identified, forKey: AnalyticsKey.spaceGroupIdentified)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
  }

  func setSpaceGroupIdentified(_ identified: Bool) throws {
    try lock.withAnalyticsLock {
      defaults.set(identified, forKey: AnalyticsKey.spaceGroupIdentified)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
  }

  func clearSpaceGroup() throws {
    try lock.withAnalyticsLock {
      defaults.removeObject(forKey: AnalyticsKey.spaceGroup)
      defaults.removeObject(forKey: AnalyticsKey.spaceGroupIdentified)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
  }

  func consumeFirstRun() -> Bool {
    lock.withAnalyticsLock {
      let first = !defaults.bool(forKey: AnalyticsKey.hasCaptured)
      if first { defaults.set(true, forKey: AnalyticsKey.hasCaptured); defaults.synchronize() }
      return first
    }
  }

  func enqueue(_ data: Data) throws {
    do {
      let fileName = lock.withAnalyticsLock { () -> String in
        queueSequence &+= 1
        let timestamp = UInt64(Date().timeIntervalSince1970 * 1_000_000)
        return String(format: "%020llu-%020llu-%@.json", timestamp, queueSequence, UUID().uuidString)
      }
      try data.write(
        to: queueDirectory.appendingPathComponent(fileName),
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
      for url in pendingEvents().dropLast(256) { try FileManager.default.removeItem(at: url) }
    } catch { throw BindingAnalyticsHostError.PersistenceFailed }
  }

  func pendingEvents() -> [URL] {
    ((try? FileManager.default.contentsOfDirectory(at: queueDirectory, includingPropertiesForKeys: nil)) ?? [])
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
  }
  func remove(_ url: URL) { try? FileManager.default.removeItem(at: url) }
  func clearPendingEvents() { pendingEvents().forEach(remove) }

  private func value(forKey key: String) throws -> String {
    try lock.withAnalyticsLock { try identifier(forKey: key) }
  }
  private func identifier(forKey key: String) throws -> String {
    if let existing = defaults.string(forKey: key), UUID(uuidString: existing) != nil { return existing }
    let created = UUID().uuidString.lowercased()
    defaults.set(created, forKey: key)
    guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    return created
  }
  private func save(_ value: String, forKey key: String) throws {
    try lock.withAnalyticsLock {
      defaults.set(value, forKey: key)
      guard defaults.synchronize() else { throw BindingAnalyticsHostError.PersistenceFailed }
    }
  }
  private static func appGroupID() -> String? {
    if let configured = Bundle.main.object(forInfoDictionaryKey: "UCAppGroupIdentifier") as? String,
      !configured.isEmpty { return configured }
    guard var bundleID = Bundle.main.bundleIdentifier else { return nil }
    for suffix in [".Keyboard", ".Share"] where bundleID.hasSuffix(suffix) { bundleID.removeLast(suffix.count) }
    return "group.\(bundleID)"
  }
}

final class ApplePostHogAnalyticsHost: BindingAnalyticsHost, @unchecked Sendable {
  private let store: AppleAnalyticsStore
  private let projectKey: String
  private let endpoint: URL
  private let deliveryQueue = DispatchQueue(label: "app.uniclipboard.analytics.delivery")
  private let contextLock = NSLock()
  private let sessionID = UUID().uuidString.lowercased()
  private var appVersion: String
  private var activeDeviceCount = 0
  private var deliveryRunning = false

  convenience init(appVersion: String) throws {
    try self.init(
      appVersion: appVersion,
      store: AppleAnalyticsStore(),
      projectKey: (Bundle.main.object(forInfoDictionaryKey: "UCPostHogProjectKey") as? String) ?? "",
      endpoint: URL(string: "https://us.i.posthog.com/i/v0/e/")!
    )
  }

  init(appVersion: String, store: AppleAnalyticsStore, projectKey: String, endpoint: URL) throws {
    self.store = store
    self.appVersion = appVersion
    self.projectKey = projectKey.trimmingCharacters(in: .whitespacesAndNewlines)
    self.endpoint = endpoint
    scheduleDelivery()
  }

  func updateApplicationContext(appVersion: String, activeDeviceCount: Int) {
    contextLock.withAnalyticsLock { self.appVersion = appVersion; self.activeDeviceCount = max(0, activeDeviceCount) }
  }
  func consentEnabled() -> Bool { store.isEnabled }
  func setConsentEnabled(_ enabled: Bool) throws {
    try store.setEnabled(enabled)
    if enabled {
      try identifyCurrentSpaceGroupIfNeeded()
      scheduleDelivery()
    } else {
      store.clearPendingEvents()
      try store.setSpaceGroupIdentified(false)
    }
  }
  func resetAndIdentify() throws {
    store.clearPendingEvents()
    _ = try resetTelemetryIdentity()
  }

  func getAnalyticsState() throws -> [String: Any?] {
    let spacePersonID = store.currentSpacePersonID()
    return [
      "projectKey": projectKey,
      "consentEnabled": store.isEnabled,
      "distinctId": try store.currentDistinctID(),
      "anonymousId": try store.anonymousID(),
      "deviceId": try store.deviceID(),
      "spaceGroupKey": store.currentSpaceGroupKey(),
      "isIdentified": spacePersonID != nil,
    ]
  }

  func ensureSpaceContext(spaceID: String?, activeDeviceCount: Int) throws {
    guard let spaceID, !spaceID.isEmpty else {
      try store.clearSpaceGroup()
      return
    }
    let groupKey = SHA256.hash(data: Data(spaceID.utf8)).prefix(8)
      .map { String(format: "%02x", $0) }.joined()
    if store.currentSpaceGroupKey() != groupKey {
      try store.setSpaceGroupKey(groupKey, identified: false)
    }
    try identifyCurrentSpaceGroupIfNeeded(activeDeviceCount: activeDeviceCount)
  }

  func capture(event: BindingAnalyticsEvent) throws {
    guard store.isEnabled, !projectKey.isEmpty else { return }
    guard let data = event.propertiesJson.data(using: .utf8),
      let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw BindingAnalyticsHostError.DeliveryFailed }
    guard !containsSensitiveData(raw) else { throw BindingAnalyticsHostError.DeliveryFailed }
    var properties = raw
    for (key, value) in try commonProperties() { properties[key] = value }
    properties["$insert_id"] = UUID().uuidString.lowercased()
    properties["$device_id"] = properties["analytics_device_id"]
    properties["$session_id"] = properties["session_id"]
    properties["$lib"] = "uniclipboard-mobile"
    properties["$lib_version"] = properties["app_version"]
    properties["$os"] = "iOS"; properties["$os_version"] = properties["os_version"]
    properties["$device_type"] = "Mobile"; properties["$geoip_disable"] = true
    if let group = store.currentSpaceGroupKey() {
      properties["space_id_hash"] = group; properties["$groups"] = ["space": group]
    }
    properties["$set"] = personProperties(properties)
    properties["$set_once"] = initialProperties(properties)
    try enqueue(event.name, distinctID: try store.currentDistinctID(), properties: properties)
  }

  func identify(payload: BindingAnalyticsIdentify) throws {
    guard store.isEnabled, !projectKey.isEmpty else { return }
    var properties: [String: Any] = ["$anon_distinct_id": payload.oldDistinctId, "$lib": "uniclipboard-mobile", "$geoip_disable": true]
    try addJSON(payload.setJson, key: "$set", to: &properties)
    try addJSON(payload.setOnceJson, key: "$set_once", to: &properties)
    try enqueue("$identify", distinctID: payload.newDistinctId, properties: properties)
  }

  func groupIdentify(payload: BindingAnalyticsGroupIdentify) throws {
    try store.setSpaceGroupKey(payload.groupKey, identified: false)
    guard store.isEnabled, !projectKey.isEmpty else { return }
    var properties: [String: Any] = ["$group_type": payload.groupType, "$group_key": payload.groupKey, "$lib": "uniclipboard-mobile", "$geoip_disable": true]
    try addJSON(payload.setJson, key: "$group_set", to: &properties)
    try enqueue("$groupidentify", distinctID: try store.currentDistinctID(), properties: properties)
    try store.setSpaceGroupIdentified(true)
  }
  func adoptSpacePerson(spacePersonId: String) throws -> BindingAnalyticsIdentityChange { try store.adopt(spacePersonId) }
  func releaseSpacePerson() throws -> BindingAnalyticsIdentityChange { try store.release() }
  func currentSpacePersonId() throws -> String? { store.currentSpacePersonID() }
  func resetTelemetryIdentity() throws -> BindingAnalyticsIdentityChange { try store.resetTelemetryIdentity() }

  private func commonProperties() throws -> [String: Any] {
    let context = contextLock.withAnalyticsLock { (appVersion, activeDeviceCount) }
    return [
      "anonymous_user_id": try store.anonymousID(), "analytics_device_id": try store.deviceID(),
      "session_id": sessionID, "app_version": context.0,
      "app_channel": Bundle.main.bundleIdentifier?.contains(".dev") == true ? "development" : "production",
      "os": "ios", "os_version": ProcessInfo.processInfo.operatingSystemVersionString,
      "arch": Self.architecture, "locale": Locale.current.identifier,
      "timezone": TimeZone.current.identifier, "install_source": "app_store",
      "is_first_run": store.consumeFirstRun(), "active_device_count": context.1,
    ]
  }
  private func identifyCurrentSpaceGroupIfNeeded(activeDeviceCount: Int? = nil) throws {
    guard store.isEnabled, !projectKey.isEmpty, !store.isSpaceGroupIdentified(),
      let groupKey = store.currentSpaceGroupKey()
    else { return }
    let count = activeDeviceCount ?? contextLock.withAnalyticsLock { self.activeDeviceCount }
    try groupIdentify(
      payload: BindingAnalyticsGroupIdentify(
        groupType: "space",
        groupKey: groupKey,
        setJson: "{\"device_count\":\(max(0, count))}"
      )
    )
  }
  private func enqueue(_ event: String, distinctID: String, properties: [String: Any]) throws {
    var properties = properties
    if properties["$insert_id"] == nil { properties["$insert_id"] = UUID().uuidString.lowercased() }
    let body: [String: Any] = ["api_key": projectKey, "event": event, "distinct_id": distinctID, "properties": properties, "timestamp": ISO8601DateFormatter().string(from: Date())]
    guard JSONSerialization.isValidJSONObject(body) else { throw BindingAnalyticsHostError.DeliveryFailed }
    try store.enqueue(try JSONSerialization.data(withJSONObject: body)); scheduleDelivery()
  }
  private func scheduleDelivery() {
    deliveryQueue.async { [self] in guard !deliveryRunning, store.isEnabled, !projectKey.isEmpty else { return }; deliveryRunning = true; deliverNext() }
  }
  private func deliverNext() {
    guard store.isEnabled, let url = store.pendingEvents().first else { deliveryRunning = false; return }
    guard let body = try? Data(contentsOf: url) else { store.remove(url); deliverNext(); return }
    var request = URLRequest(url: endpoint); request.httpMethod = "POST"; request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    URLSession.shared.dataTask(with: request) { [self] _, response, _ in
      deliveryQueue.async { [self] in
        if let status = (response as? HTTPURLResponse)?.statusCode,
          (200..<300).contains(status)
        {
          self.store.remove(url)
          self.deliverNext()
        } else {
          self.deliveryRunning = false
        }
      }
    }.resume()
  }
  private func addJSON(_ json: String, key: String, to properties: inout [String: Any]) throws {
    guard let data = json.data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], !containsSensitiveData(value) else { throw BindingAnalyticsHostError.DeliveryFailed }
    if !value.isEmpty { properties[key] = value }
  }
  private func containsSensitiveData(_ value: Any, key: String? = nil) -> Bool {
    let forbidden = Set(["clipboard", "device_name", "display_name", "file_name", "filename", "path", "password", "secret", "token", "invitation_code", "credential"])
    if let key { let normalized = key.lowercased().replacingOccurrences(of: "-", with: "_"); if forbidden.contains(normalized) || normalized.hasSuffix("_path") || normalized.hasSuffix("_content") { return true } }
    if let object = value as? [String: Any] { return object.contains { containsSensitiveData($0.value, key: $0.key) } }
    if let array = value as? [Any] { return array.contains { containsSensitiveData($0) } }
    if let string = value as? String { let lowered = string.lowercased(); return lowered.contains("file://") || lowered.contains("content://") || lowered.contains("/users/") || lowered.contains("/var/mobile/") }
    return false
  }
  private func personProperties(_ source: [String: Any]) -> [String: Any] {
    let keys = ["app_version", "app_channel", "os", "os_version", "arch", "locale", "timezone", "active_device_count", "space_id_hash"]
    return Dictionary(uniqueKeysWithValues: keys.compactMap { key in source[key].map { (key, $0) } })
  }
  private func initialProperties(_ source: [String: Any]) -> [String: Any] {
    ["initial_app_version": source["app_version"], "initial_app_channel": source["app_channel"], "initial_os": source["os"], "initial_install_source": source["install_source"]].compactMapValues { $0 }
  }
  private static var architecture: String {
    #if arch(arm64)
      "arm64"
    #elseif arch(x86_64)
      "x86_64"
    #else
      "other"
    #endif
  }
}

private extension NSLock {
  func withAnalyticsLock<T>(_ operation: () throws -> T) rethrows -> T { lock(); defer { unlock() }; return try operation() }
}
