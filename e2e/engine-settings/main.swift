import Foundation

struct CheckFailure: Error { let message: String }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw CheckFailure(message: message) }
}
func readJSON(_ path: URL) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any] else {
        throw CheckFailure(message: "Invalid JSON object")
    }
    return object
}
func writeJSON(_ value: [String: Any], _ path: URL) throws {
    try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        .write(to: path, options: .atomic)
}

// Only synthetic keys live in this process. No OS keychain or clipboard is accessed.
final class IsolatedHost: BindingHost, @unchecked Sendable {
    let root: URL
    private let lock = NSLock()
    private var secrets: [String: Data] = [:]
    private var writtenClipboard: BindingClipboardSnapshot?
    init(_ root: URL) { self.root = root }
    func privateDataDirectory() throws -> String { root.appendingPathComponent("private").path }
    func cacheDirectory() throws -> String { root.appendingPathComponent("cache").path }
    func temporaryDirectory() throws -> String { root.appendingPathComponent("temporary").path }
    func secureStorageGet(key: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }; return secrets[key]
    }
    func secureStorageSet(key: String, value: Data) throws {
        lock.lock(); defer { lock.unlock() }; secrets[key] = value
    }
    func secureStorageDelete(key: String) throws {
        lock.lock(); defer { lock.unlock() }; secrets.removeValue(forKey: key)
    }
    func fileMetadata(handle: String) throws -> BindingFileMetadata { throw HostBindingError.InvalidHandle }
    func fileReadChunk(handle: String, offset: UInt64, maxBytes: UInt32) throws -> Data { throw HostBindingError.InvalidHandle }
    func fileWriteChunk(handle: String, offset: UInt64, bytes: Data) throws { throw HostBindingError.InvalidHandle }
    func fileFinishWrite(handle: String) throws { throw HostBindingError.InvalidHandle }
    func clipboardRead() throws -> BindingClipboardSnapshot { throw HostBindingError.Unavailable }
    func clipboardWrite(snapshot: BindingClipboardSnapshot) throws {
        lock.lock(); defer { lock.unlock() }; writtenClipboard = snapshot
    }
    func lastClipboard() -> BindingClipboardSnapshot? {
        lock.lock(); defer { lock.unlock() }; return writtenClipboard
    }
}

func run() throws {
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let fixture = try readJSON(URL(fileURLWithPath: CommandLine.arguments[2]))
let loggingHost = IsolatedHost(output.appendingPathComponent("observability"))
_ = try installProcessObservability(config: BindingObservabilityConfig(
    serviceVersion: "1.0.0", environment: .test, appChannel: "test",
    remoteDiagnosticsEnabled: false, collector: nil), host: loggingHost)
var results: [[String: Any]] = []
for name in ["fresh", "legacy", "invalid-legacy"] {
    let caseRoot = output.appendingPathComponent(name)
    let host = IsolatedHost(caseRoot)
    let privateRoot = URL(fileURLWithPath: try host.privateDataDirectory())
    try FileManager.default.createDirectory(at: privateRoot, withIntermediateDirectories: true)
    let settingsPath = privateRoot.appendingPathComponent("settings.json")
    let initialRelay = "http://127.0.0.1:9/"
    let writtenRelay = "http://127.0.0.1:10/"
    if name != "fresh" {
        var settings = fixture
        var general = settings["general"] as! [String: Any]
        general["device_name"] = "Synthetic Mobile"
        if name == "invalid-legacy" {
            general["theme"] = "neon"
            general["startup_mode"] = "turbo"
            general["update_channel"] = "nightly"
            general["language"] = 42
            general["debug_mode"] = "yes"
            general["usage_analytics_enabled"] = "yes"
            general["theme_overrides_light"] = "not-a-map"
            settings["quick_panel"] = ["position": "nowhere", "double_tap_modifier": "hyper"]
            settings["keyboard_shortcuts"] = ["global.toggleQuickPanel": 42]
        }
        settings["general"] = general
        var network = settings["network"] as! [String: Any]
        network["custom_relay_urls"] = [initialRelay]
        settings["network"] = network
        try writeJSON(settings, settingsPath)
        try writeJSON(settings, caseRoot.appendingPathComponent("input.json"))
    }
    let config = BindingConfig(appVersion: "1.0.0", profileId: "default")
    let engine = try MobileEngine.start(config: config, host: host)
    try require(try engine.queryRejectedConfigImport() == nil, "Unexpected rejected input")
    let before = try engine.queryLocalDevice()
    if name != "fresh" {
        try require(before.displayName == "Synthetic Mobile", "Legacy name was lost")
        let relays = try engine.queryCustomRelays()
        try require(relays.map { $0.url } == [initialRelay], "Legacy relay was lost")
    }
    let mutation = try engine.addCustomRelay(url: writtenRelay, accessToken: "")
    try require(mutation.rejection == nil, "Relay mutation was rejected")
    let expectedRelays = name == "fresh" ? [writtenRelay] : [initialRelay, writtenRelay]
    let actualRelays = try engine.queryCustomRelays().map { $0.url }.sorted()
    try require(actualRelays == expectedRelays.sorted(), "Relay write was not visible")
    let saved = try readJSON(settingsPath)
    let general = saved["general"] as! [String: Any]
    try require(Set(general.keys) == Set(["device_name"]), "Product settings remain in Engine")
    try require(saved["quick_panel"] == nil && saved["keyboard_shortcuts"] == nil, "Product sections remain")
    if name != "fresh" {
        let input = try readJSON(caseRoot.appendingPathComponent("input.json"))
        for section in ["retention_policy", "security", "pairing", "file_sync", "mobile_sync"] {
            try require(NSDictionary(dictionary: saved[section] as! [String: Any])
                .isEqual(to: input[section] as! [String: Any]), "Engine section changed: \(section)")
        }
        let oldSync = input["sync"] as! [String: Any]
        let newSync = saved["sync"] as! [String: Any]
        try require((newSync["auto_sync_enabled"] as? Bool) == (oldSync["auto_sync"] as? Bool), "Auto-sync changed")
        for key in ["sync_frequency", "content_types", "sync_on_restore"] {
            try require(NSDictionary(dictionary: [key: oldSync[key]!])
                .isEqual(to: [key: newSync[key]!]), "Sync policy changed: \(key)")
        }
        let oldNetwork = input["network"] as! [String: Any]
        let newNetwork = saved["network"] as! [String: Any]
        for key in oldNetwork.keys where key != "custom_relay_urls" {
            try require(NSDictionary(dictionary: [key: oldNetwork[key]!])
                .isEqual(to: [key: newNetwork[key]!]), "Network policy changed: \(key)")
        }
    }
    try writeJSON(saved, caseRoot.appendingPathComponent("saved.json"))
    try engine.shutdown(deadlineMs: 15000)
    let restarted = try MobileEngine.start(config: config, host: host)
    let after = try restarted.queryLocalDevice()
    try require(before.displayName == after.displayName, "Device name changed after restart")
    try require(before.deviceId == after.deviceId, "Device identity changed after restart")
    let restoredRelays = try restarted.queryCustomRelays().map { $0.url }.sorted()
    try require(restoredRelays == expectedRelays.sorted(), "Relay write was lost after restart")
    try restarted.shutdown(deadlineMs: 15000)
    let reloaded = try readJSON(settingsPath)
    try require(NSDictionary(dictionary: saved).isEqual(to: reloaded), "Restart changed persisted settings")
    results.append(["case": name, "passed": true, "sameDeviceIdentity": true,
                    "relays": restoredRelays, "engineRestarted": true,
                    "generalKeys": general.keys.sorted()])
    try writeJSON(["cases": results], output.appendingPathComponent("result.json"))
}

// Seed only synthetic historical inputs. Product code must use the public query.
for scenario in ["unsupportedFormat", "malformedMarker", "missingRuntimeMembers"] {
    let caseRoot = output.appendingPathComponent(scenario)
    let host = IsolatedHost(caseRoot)
    let config = BindingConfig(appVersion: "1.0.0", profileId: "default")
    let initial = try MobileEngine.start(config: config, host: host)
    try require(try initial.queryRejectedConfigImport() == nil, "Fresh query must be absent")
    let relay = try initial.addCustomRelay(url: "http://127.0.0.1:9/", accessToken: "")
    try require(relay.rejection == nil, "Synthetic relay was rejected")
    let originalSpace = try initial.createSpace(deviceName: "Synthetic retained space",
        passphrase: "synthetic retained space passphrase").spaceId
    let oldText = "Synthetic encrypted history before rejection"
    let oldEntry = try initial.sendText(text: oldText, targetDevices: []).entryId
    let oldDevice = try initial.queryLocalDevice().deviceId
    try initial.shutdown(deadlineMs: 15000)
    let privateRoot = URL(fileURLWithPath: try host.privateDataDirectory())
    let markerPath = privateRoot.appendingPathComponent("pending-import.json")
    let stage = privateRoot.appendingPathComponent("import-staging")
    let members = ["db/uniclipboard.db": Data("synthetic opaque unique database".utf8),
                   "unique-source.bin": Data([0, 1, 2, 254, 255])]
    for (name, bytes) in members {
        let file = stage.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: file)
    }
    let marker: Data
    if scenario == "malformedMarker" {
        marker = Data("{invalid marker".utf8)
    } else {
        marker = try JSONSerialization.data(withJSONObject: ["schema_ver": scenario == "unsupportedFormat" ? 1 : 2,
            "staging_dir": "import-staging", "has_kek": true, "staged_at_unix_ms": 0], options: [.sortedKeys])
    }
    try marker.write(to: markerPath)
    var boots: [[String: Any]] = []
    for boot in 0..<2 {
        let engine = try MobileEngine.start(config: config, host: host)
        let recovery = try engine.recoverSession(allowSecureStorageUnlock: true)
        try require(!recovery.unlocked || recovery.resumed, "Session did not resume after unlock")
        try require(try engine.querySpaceState().spaceId == originalSpace, "Original space was replaced")
        try require(try engine.queryLocalDevice().deviceId == oldDevice, "Original device was replaced")
        guard let rejected = try engine.queryRejectedConfigImport() else {
            throw CheckFailure(message: "Rejected input was silently hidden")
        }
        try require(String(describing: rejected.reason) == scenario, "Wrong generated reason")
        try require(rejected.message == "Import was not completed. Re-export the configuration bundle using the new version.", "Missing re-export instruction")
        for (entry, text) in [(oldEntry, oldText),
            (try engine.sendText(text: "Synthetic new encrypted write", targetDevices: []).entryId, "Synthetic new encrypted write")] {
            try require(try engine.restoreClipboard(entryId: entry, mode: .standard) == .restored, "Encrypted history unreadable")
            guard let snapshot = host.lastClipboard(),
                  let representation = snapshot.representations.first,
                  case let .inline(_, _, bytes) = representation else {
                throw CheckFailure(message: "Restored clipboard is missing")
            }
            try require(bytes == Data(text.utf8), "Restored encrypted bytes differ")
        }
        try require(try Data(contentsOf: markerPath) == marker, "Marker changed")
        for (name, bytes) in members {
            try require(try Data(contentsOf: stage.appendingPathComponent(name)) == bytes, "Staged member changed")
        }
        let names = try FileManager.default.subpathsOfDirectory(atPath: stage.path).sorted()
        try require(names == ["db", "db/uniclipboard.db", "unique-source.bin"], "Staging tree changed")
        let journal = privateRoot.appendingPathComponent(".config-import-adoption-v1")
        try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: false)
        var errorFields: [String: Any] = [:]
        do {
            _ = try engine.queryRejectedConfigImport()
            throw CheckFailure(message: "Query I/O failure was swallowed")
        } catch let BindingError.Engine(code, category, retryable) {
            try require(code == 1411 && category == .internal && !retryable, "Query error fields changed")
            errorFields = ["code": code, "category": String(describing: category), "retryable": retryable]
        }
        try require(try engine.querySpaceState().spaceId == originalSpace, "Query failure replaced the original space")
        try require(try engine.restoreClipboard(entryId: oldEntry, mode: .standard) == .restored, "Query failure blocked original history")
        try FileManager.default.removeItem(at: journal)
        try require(try engine.queryRejectedConfigImport()?.reason == rejected.reason, "Query did not recover")
        try engine.shutdown(deadlineMs: 15000)
        try require(try Data(contentsOf: markerPath) == marker, "Shutdown changed marker")
        for (name, bytes) in members {
            try require(try Data(contentsOf: stage.appendingPathComponent(name)) == bytes, "Shutdown changed staging")
        }
        try require(try FileManager.default.subpathsOfDirectory(atPath: stage.path).sorted() == names, "Shutdown changed staging tree")
        boots.append(["boot": boot, "reason": scenario, "message": rejected.message,
            "originalSpaceId": originalSpace, "originalDeviceId": oldDevice,
            "recoveryUnlocked": recovery.unlocked, "recoveryResumed": recovery.resumed,
            "encryptedHistoryRead": true, "newEncryptedWriteRead": true,
            "retainedFiles": names, "retainedBytesUnchanged": true, "originalSpaceUsableDuringQueryFailure": true, "queryFailure": errorFields])
    }
    try writeJSON(["boots": boots], caseRoot.appendingPathComponent("rejection.json"))
    results.append(["case": scenario, "passed": true, "boots": boots])
    try writeJSON(["cases": results], output.appendingPathComponent("result.json"))
}

// Receive query, cancellation and retry through the generated binding. A single isolated
// profile has no receiver-side attempt, so this proves symbol and checksum agreement,
// stable absent/refusal values and structured errors. It does not prove a transfer.
do {
    let caseRoot = output.appendingPathComponent("receive-api")
    let host = IsolatedHost(caseRoot)
    let config = BindingConfig(appVersion: "1.0.0", profileId: "default")
    let engine = try MobileEngine.start(config: config, host: host)
    _ = try engine.createSpace(deviceName: "Synthetic receive space",
        passphrase: "synthetic receive space passphrase")
    let text = "Synthetic sender-side entry"
    let entry = try engine.sendText(text: text, targetDevices: []).entryId
    try require(try engine.listEntryReceiveProgress().isEmpty, "Unexpected receive attempt in a fresh profile")
    try require(try engine.queryEntryReceiveProgress(entryId: entry) == nil, "A sender entry has a receive snapshot")
    let allowedCancellation: Set<String> = ["cancelled", "cancellation_incomplete", "not_receiving",
        "too_late", "already_terminal", "superseded"]
    let cancellation = try engine.cancelEntryReceive(entryId: entry, attemptId: "synthetic-attempt")
    try require(allowedCancellation.contains(cancellation), "Unknown cancellation outcome: \(cancellation)")
    try require(cancellation != "cancelled", "Cancellation was reported without a receive attempt")
    var emptySelection: [String: Any] = [:]
    do {
        _ = try engine.retryEntryReceive(entryId: entry, expectedAttemptId: "synthetic-attempt", itemIds: [])
        throw CheckFailure(message: "An empty retry selection was accepted")
    } catch let BindingError.Engine(code, category, retryable) {
        try require(category == .invalidInput && !retryable, "Empty selection error fields changed")
        emptySelection = ["code": code, "category": String(describing: category), "retryable": retryable]
    }
    var unknownItem = "error"
    var unknownItemFields: [String: Any] = [:]
    do {
        let outcome = try engine.retryEntryReceive(entryId: entry, expectedAttemptId: "synthetic-attempt", itemIds: ["synthetic-item"])
        if case .accepted = outcome { throw CheckFailure(message: "Retry was accepted for an unknown item") }
        unknownItem = String(describing: outcome)
    } catch let BindingError.Engine(code, category, retryable) {
        unknownItemFields = ["code": code, "category": String(describing: category), "retryable": retryable]
    }
    try require(try engine.restoreClipboard(entryId: entry, mode: .standard) == .restored, "Receive calls changed local history")
    try engine.shutdown(deadlineMs: 15000)
    let record: [String: Any] = ["listEmpty": true, "senderEntrySnapshot": "absent",
        "cancellationWithoutAttempt": cancellation, "emptySelection": emptySelection,
        "unknownItemOutcome": unknownItem, "unknownItemError": unknownItemFields,
        "localHistoryUnchanged": true]
    try writeJSON(record, caseRoot.appendingPathComponent("receive-api.json"))
    results.append(["case": "receive-api", "passed": true, "record": record])
    try writeJSON(["cases": results], output.appendingPathComponent("result.json"))
}

_ = try flushProcessObservability(deadlineMs: 2000)
}

do { try run() } catch {
    FileHandle.standardError.write(Data("Engine settings E2E failed: \(error)\n".utf8))
    exit(1)
}
