import ExpoModulesCore

public class UcCoreModule: Module {

    private static var initialized = false
    private var client: MobileSyncClient?
    // Long-lived push/pull sync engine (design 2026-07-05). One instance for the
    // active server; `engineSetServer` reconfigures in place, never reconstructs.
    private var engine: MobileSyncEngine?

    private func requireEngine() throws -> MobileSyncEngine {
        guard let syncEngine = engine else {
            throw EngineNotInitializedException()
        }
        return syncEngine
    }

    // Live SSE subscriptions keyed by the TS-assigned subscriptionId. Mutated
    // from both the JS thread (start/cancel) and Rust callback threads
    // (onDisconnected), hence the lock.
    private var sseHandles: [String: SseHandle] = [:]
    private let sseLock = NSLock()

    fileprivate func removeSseHandle(_ subscriptionId: String) -> SseHandle? {
        sseLock.lock()
        defer { sseLock.unlock() }
        return sseHandles.removeValue(forKey: subscriptionId)
    }

    private func storeSseHandle(_ subscriptionId: String, _ handle: SseHandle) {
        sseLock.lock()
        defer { sseLock.unlock() }
        sseHandles[subscriptionId] = handle
    }

    private func cancelAllSseHandles() {
        sseLock.lock()
        let handles = sseHandles.values
        sseHandles.removeAll()
        sseLock.unlock()
        handles.forEach { $0.cancel() }
    }

    private func ensureInit() {
        if !UcCoreModule.initialized {
            ucMobileInit()
            UcCoreModule.initialized = true
        }
    }

    private func getClient(trustInsecureCert: Bool) throws -> MobileSyncClient {
        if let existingClient = client { return existingClient }
        ensureInit()
        let bridge = ExpoPlatformBridge()
        let newClient = try MobileSyncClient(bridge: bridge, trustInsecureCert: trustInsecureCert)
        client = newClient
        return newClient
    }

    // Expo's SDK 56 result builder has no flattening primitive for grouped definitions.
    // swiftlint:disable:next function_body_length
    public func definition() -> ModuleDefinition {
        Name("UcCore")

        Events("onSseHello", "onSseUpdate", "onSseResync", "onSseDisconnected")

        Function("parseConnectUri") { (uri: String) -> [String: Any] in
            let payload = try parseConnectUri(uri: uri)
            return [
                "v": payload.v,
                "url": payload.url,
                "urls": payload.urls,
                "user": payload.user,
                "pwd": payload.pwd,
                "other": payload.other
            ]
        }

        AsyncFunction("getLatest") { (serverMap: [String: String], trustInsecureCert: Bool) -> [String: Any?] in
            let server = self.serverFromMap(serverMap)
            let meta = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getLatest(server: server)
            return self.metaToMap(meta)
        }

        AsyncFunction("putClipboard") { (serverMap: [String: String], metaMap: [String: Any?], payload: Data?, trustInsecureCert: Bool) in
            let server = self.serverFromMap(serverMap)
            let meta = self.metaFromMap(metaMap)
            _ = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .putClipboard(server: server, meta: meta, payload: payload)
        }

        AsyncFunction("testConnection") { (serverMap: [String: String], trustInsecureCert: Bool) -> String in
            let server = self.serverFromMap(serverMap)
            let result = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .testConnection(server: server, trustInsecureCert: trustInsecureCert)
            return self.probeResultToString(result)
        }

        AsyncFunction("queryHistory") { (serverMap: [String: String], queryMap: [String: Any?], trustInsecureCert: Bool) -> [[String: Any?]] in
            let server = self.serverFromMap(serverMap)
            let query = self.historyQueryFromMap(queryMap)
            let records = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .queryHistory(server: server, query: query)
            return records.map { self.historyRecordToMap($0) }
        }

        AsyncFunction("getFile") { (serverMap: [String: String], name: String, trustInsecureCert: Bool) -> Data in
            let server = self.serverFromMap(serverMap)
            return try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getFile(server: server, name: name)
        }

        AsyncFunction("putFile") { (serverMap: [String: String], name: String, body: Data, trustInsecureCert: Bool) in
            let server = self.serverFromMap(serverMap)
            try await self.getClient(trustInsecureCert: trustInsecureCert)
                .putFile(server: server, name: name, body: body)
        }

        AsyncFunction("getHistoryPayload") { (serverMap: [String: String], profileId: String, trustInsecureCert: Bool) -> Data in
            let server = self.serverFromMap(serverMap)
            return try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getHistoryPayload(server: server, profileId: profileId)
        }

        AsyncFunction("probe") { (urls: [String], username: String, password: String, trustInsecureCert: Bool, timeoutMs: UInt32, networkEpoch: UInt64) -> [String: Any] in
            let report = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .probe(urls: urls, username: username, password: password,
                       trustInsecureCert: trustInsecureCert,
                       timeoutMs: timeoutMs, networkEpoch: networkEpoch)
            var results: [String: String] = [:]
            for (url, result) in report.results {
                results[url] = self.probeResultToString(result)
            }
            return [
                "networkEpoch": report.networkEpoch,
                "results": results
            ]
        }

        AsyncFunction("healthProbe") { (urls: [String], trustInsecureCert: Bool, timeoutMs: UInt32, networkEpoch: UInt64) -> [String: Any] in
            let report = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .healthProbe(urls: urls, trustInsecureCert: trustInsecureCert,
                             timeoutMs: timeoutMs, networkEpoch: networkEpoch)
            var results: [String: String] = [:]
            for (url, result) in report.results {
                results[url] = self.healthProbeResultToString(result)
            }
            return [
                "networkEpoch": report.networkEpoch,
                "results": results
            ]
        }

        Function("cancelInFlight") {
            self.client?.cancelInFlight()
        }

        // MARK: - SSE push channel (mobile-sync notify-then-pull)
        //
        // `subscriptionId` is assigned by the TS epoch state machine (design
        // §5.2) and echoed back on every event so stale callbacks from a
        // cancelled subscription can be told apart from the current one.
        // Reconnect policy is entirely on the TS side: on `onSseDisconnected`
        // the caller decides whether/when to call `startSseSubscription`
        // again. Rust callbacks arrive on a Rust runtime thread; forwarding
        // hops to the main queue before touching sendEvent.

        Function("startSseSubscription") { (subscriptionId: String, serverMap: [String: String], trustInsecureCert: Bool) in
            let server = self.serverFromMap(serverMap)
            let listener = SseEventForwarder(subscriptionId: subscriptionId, module: self)
            self.removeSseHandle(subscriptionId)?.cancel()
            let handle = try self.getClient(trustInsecureCert: trustInsecureCert)
                .startSseSubscription(server: server, listener: listener)
            self.storeSseHandle(subscriptionId, handle)
        }

        Function("cancelSseSubscription") { (subscriptionId: String) in
            self.removeSseHandle(subscriptionId)?.cancel()
        }

        // MARK: - MobileSyncEngine (push/pull sync SDK)
        // Replaces the per-function reducer driving: dedup / anti-loop / watermark /
        // conflict resolution all live inside the Rust engine. TS drives via these.

        Function("engineInit") { (serverMap: [String: String], configMap: [String: Any], settingsMap: [String: Any], trustInsecureCert: Bool) in
            self.ensureInit()
            let store = ExpoKeyValueStore()
            let client = try self.getClient(trustInsecureCert: trustInsecureCert)
            self.engine = try MobileSyncEngine(
                server: self.serverFromMap(serverMap),
                config: self.syncConfigFromMap(configMap),
                settings: self.syncSettingsFromMap(settingsMap),
                store: store,
                client: client
            )
        }

        Function("engineDispose") {
            self.engine = nil
        }

        AsyncFunction("enginePush") { (contentMap: [String: Any?], payload: Data?) -> [String: Any?] in
            let syncEngine = try self.requireEngine()
            let content = self.localContentFromMap(contentMap, payload: payload)
            return self.syncOutcomeToMap(await syncEngine.push(content: content))
        }

        AsyncFunction("enginePull") { (triggerMap: [String: Any?], currentDeviceHash: String?) -> [String: Any?] in
            let syncEngine = try self.requireEngine()
            let trigger = self.pullTriggerFromMap(triggerMap)
            return self.syncOutcomeToMap(await syncEngine.pull(trigger: trigger, currentDeviceHash: currentDeviceHash))
        }

        AsyncFunction("engineApplyStaged") { () -> [String: Any?] in
            let syncEngine = try self.requireEngine()
            return self.syncOutcomeToMap(await syncEngine.applyStaged())
        }

        AsyncFunction("engineSetServer") { (serverMap: [String: String]) in
            let syncEngine = try self.requireEngine()
            await syncEngine.setServer(server: self.serverFromMap(serverMap))
        }

        AsyncFunction("engineHandleNetworkRouteChanged") {
            let syncEngine = try self.requireEngine()
            await syncEngine.handleNetworkRouteChanged()
        }

        AsyncFunction("engineSetSettings") { (settingsMap: [String: Any]) in
            let syncEngine = try self.requireEngine()
            await syncEngine.setSettings(settings: self.syncSettingsFromMap(settingsMap))
        }

        AsyncFunction("engineAcknowledgeLoopDetected") {
            let syncEngine = try self.requireEngine()
            await syncEngine.acknowledgeLoopDetected()
        }

        OnDestroy {
            self.cancelAllSseHandles()
            self.engine = nil
        }

        // MARK: - Sync config + cadence helpers (survivors from the pre-engine reducer
        // design; dedup/anti-loop/watermark/conflict resolution now live in
        // MobileSyncEngine above — these remain for RN-side history-sync cadence +
        // cold-start/watermark bookkeeping, which the engine doesn't own).

        Function("defaultSyncConfig") { () -> [String: Any] in
            self.ensureInit()
            return self.syncConfigToMap(defaultSyncConfig())
        }

        Function("isHistorySyncDue") { (lastSyncMs: Int?, nowMs: Int, intervalSecs: Double) -> Bool in
            self.ensureInit()
            return isHistorySyncDue(lastSyncMs: lastSyncMs.map { Int64($0) }, nowMs: Int64(nowMs), intervalSecs: intervalSecs)
        }

        Function("isColdStart") { (watermarkMs: Int?) -> Bool in
            self.ensureInit()
            return isColdStart(watermarkMs: watermarkMs.map { Int64($0) })
        }

        Function("advanceWatermark") { (currentMs: Int?, maxLastModifiedMs: Int) -> Int? in
            self.ensureInit()
            return advanceWatermark(currentMs: currentMs.map { Int64($0) }, maxLastModifiedMs: Int64(maxLastModifiedMs)).map { Int($0) }
        }
    }

}

private extension UcCoreModule {
    // MARK: - Type conversion helpers

    func serverFromMap(_ map: [String: String]) -> ServerConfig {
        var base = (map["baseUrl"] ?? "").trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        return ServerConfig(
            baseUrl: base,
            username: map["username"] ?? "",
            password: map["password"] ?? ""
        )
    }

    private func metaToMap(_ meta: ClipboardMeta) -> [String: Any?] {
        return [
            "kind": self.clipboardKindToString(meta.kind),
            "text": meta.text,
            "dataName": meta.dataName,
            "hasData": meta.hasData,
            "size": meta.size,
            "hash": meta.hash,
            "contentId": meta.contentId
        ]
    }

    private func metaFromMap(_ map: [String: Any?]) -> ClipboardMeta {
        let kind = self.clipboardKindFromString(map["kind"] as? String)
        return ClipboardMeta(
            kind: kind,
            text: map["text"] as? String ?? "",
            dataName: map["dataName"] as? String,
            hasData: map["hasData"] as? Bool ?? false,
            size: (map["size"] as? NSNumber)?.uint64Value ?? 0,
            hash: map["hash"] as? String,
            contentId: map["contentId"] as? String
        )
    }

    // MARK: - MobileSyncEngine marshaling

    private func syncSettingsFromMap(_ map: [String: Any]) -> SyncSettings {
        return SyncSettings(autoApply: map["autoApply"] as? Bool ?? true)
    }

    private func localContentFromMap(_ map: [String: Any?], payload: Data?) -> LocalContent {
        return LocalContent(
            kind: self.clipboardKindFromString(map["kind"] as? String),
            text: map["text"] as? String ?? "",
            dataName: map["dataName"] as? String,
            payload: payload
        )
    }

    private func pullTriggerFromMap(_ map: [String: Any?]) -> PullTrigger {
        switch map["tag"] as? String {
        case "Explicit": return .explicit
        case "SseHello": return .sseHello
        case "SseResync": return .sseResync
        case "SseUpdate": return .sseUpdate(contentId: map["contentId"] as? String ?? "")
        default: return .routine
        }
    }

    private func upToDateReasonToString(_ reason: UpToDateReason) -> String {
        switch reason {
        case .alreadySynced: return "AlreadySynced"
        case .selfWritten: return "SelfWritten"
        case .converged: return "Converged"
        case .noLocalChange: return "NoLocalChange"
        case .sseShortCircuit: return "SseShortCircuit"
        case .consentMode: return "ConsentMode"
        }
    }

    func syncedMetaToMap(_ meta: SyncedMeta) -> [String: Any?] {
        return [
            "kind": self.clipboardKindToString(meta.kind),
            "hash": meta.hash,
            "contentId": meta.contentId,
            "text": meta.text,
            "size": meta.size
        ]
    }

    func stagedPreviewToMap(_ preview: StagedPreview) -> [String: Any?] {
        return [
            "kind": self.clipboardKindToString(preview.kind),
            "text": preview.text,
            "size": preview.size
        ]
    }

    // Content sans payload — the Applied outcome carries payload bytes at the top
    // level (top-level Data marshals cleanly; nested does not always).
    func localContentToMap(_ content: LocalContent) -> [String: Any?] {
        return [
            "kind": self.clipboardKindToString(content.kind),
            "text": content.text,
            "dataName": content.dataName
        ]
    }

    private func syncOutcomeToMap(_ outcome: SyncOutcome) -> [String: Any?] {
        switch outcome {
        case .uploaded(let meta):
            return ["tag": "Uploaded", "meta": self.syncedMetaToMap(meta)]
        case .applied(let content, let meta):
            return [
                "tag": "Applied",
                "content": self.localContentToMap(content),
                "payload": content.payload,
                "meta": self.syncedMetaToMap(meta)
            ]
        case .staged(let preview):
            return ["tag": "Staged", "preview": self.stagedPreviewToMap(preview)]
        case .upToDate(let reason):
            return ["tag": "UpToDate", "reason": self.upToDateReasonToString(reason)]
        case .backingOff(let retryAfterMs):
            return ["tag": "BackingOff", "retryAfterMs": retryAfterMs]
        case .loopDetected:
            return ["tag": "LoopDetected"]
        case .failed(let error):
            return ["tag": "Failed", "error": String(describing: error)]
        }
    }

    private func historyQueryFromMap(_ map: [String: Any?]) -> HistoryQuery {
        return HistoryQuery(
            page: (map["page"] as? NSNumber)?.int64Value,
            beforeMs: (map["beforeMs"] as? NSNumber)?.int64Value,
            afterMs: (map["afterMs"] as? NSNumber)?.int64Value,
            modifiedAfterMs: (map["modifiedAfterMs"] as? NSNumber)?.int64Value,
            types: (map["types"] as? NSNumber)?.int64Value,
            searchText: map["searchText"] as? String,
            starred: map["starred"] as? Bool,
            sortByLastAccessed: map["sortByLastAccessed"] as? Bool
        )
    }

    func historyRecordToMap(_ record: HistoryRecord) -> [String: Any?] {
        return [
            "hash": record.hash,
            "kind": self.clipboardKindToString(record.kind),
            "text": record.text,
            "hasData": record.hasData,
            "size": record.size,
            "createTimeMs": record.createTimeMs,
            "lastModifiedMs": record.lastModifiedMs,
            "lastAccessedMs": record.lastAccessedMs,
            "starred": record.starred,
            "pinned": record.pinned,
            "version": record.version,
            "isDeleted": record.isDeleted
        ]
    }

    private func clipboardKindToString(_ kind: ClipboardKind) -> String {
        switch kind {
        case .text: return "Text"
        case .image: return "Image"
        case .file: return "File"
        case .group: return "Group"
        }
    }

    private func clipboardKindFromString(_ str: String?) -> ClipboardKind {
        switch str {
        case "Image": return .image
        case "File": return .file
        case "Group": return .group
        default: return .text
        }
    }

    private func probeResultToString(_ result: ProbeResult) -> String {
        switch result {
        case .success: return "Success"
        case .authFailed: return "AuthFailed"
        case .unreachable: return "Unreachable"
        case .missingFields: return "MissingFields"
        }
    }

    private func healthProbeResultToString(_ result: HealthProbeResult) -> String {
        switch result {
        case .success: return "Success"
        case .notSupported: return "NotSupported"
        case .unreachable: return "Unreachable"
        }
    }

    // MARK: - Sync config type conversions (defaultSyncConfig / engineInit's SyncConfig arg)

    func syncConfigToMap(_ config: SyncConfig) -> [String: Any] {
        return [
            "normalCadenceSecs": config.normalCadenceSecs,
            "inactiveCadenceSecs": config.inactiveCadenceSecs,
            "offlineBackoffSecs": config.offlineBackoffSecs,
            "offlineBackoffMaxSecs": config.offlineBackoffMaxSecs,
            "historySyncIntervalSecs": config.historySyncIntervalSecs,
            "loopWindowSecs": config.loopWindowSecs,
            "loopFlipThreshold": config.loopFlipThreshold
        ]
    }

    private func syncConfigFromMap(_ map: [String: Any]) -> SyncConfig {
        return SyncConfig(
            normalCadenceSecs: map["normalCadenceSecs"] as? Double ?? 1.0,
            inactiveCadenceSecs: map["inactiveCadenceSecs"] as? Double ?? 5.0,
            offlineBackoffSecs: map["offlineBackoffSecs"] as? Double ?? 5.0,
            offlineBackoffMaxSecs: map["offlineBackoffMaxSecs"] as? Double ?? 60.0,
            historySyncIntervalSecs: map["historySyncIntervalSecs"] as? Double ?? 30.0,
            loopWindowSecs: map["loopWindowSecs"] as? Double ?? 30.0,
            loopFlipThreshold: (map["loopFlipThreshold"] as? NSNumber)?.int64Value ?? 3
        )
    }

}

// MARK: - SSE listener

/// One instance per subscription (matching the Rust contract: a reconnect is
/// a new listener with no memory of the old one). Holds the module weakly —
/// after module teardown callbacks become no-ops. uc-mobile invokes these on
/// its own runtime thread (design §9 risk 4), so every callback hops to the
/// main queue before calling `sendEvent`, mirroring the Android bridge's
/// `Handler(Looper.getMainLooper()).post`.
private final class SseEventForwarder: SseListener, @unchecked Sendable {
    private let subscriptionId: String
    private weak var module: UcCoreModule?

    init(subscriptionId: String, module: UcCoreModule) {
        self.subscriptionId = subscriptionId
        self.module = module
    }

    func onHello(serverTimeMs: Int64) {
        let id = subscriptionId
        DispatchQueue.main.async { [weak module] in
            module?.sendEvent("onSseHello", [
                "subscriptionId": id,
                "serverTimeMs": serverTimeMs
            ])
        }
    }

    func onUpdate(contentId: String) {
        let id = subscriptionId
        DispatchQueue.main.async { [weak module] in
            module?.sendEvent("onSseUpdate", [
                "subscriptionId": id,
                "contentId": contentId
            ])
        }
    }

    func onResync() {
        let id = subscriptionId
        DispatchQueue.main.async { [weak module] in
            module?.sendEvent("onSseResync", ["subscriptionId": id])
        }
    }

    func onDisconnected(reason: String) {
        let id = subscriptionId
        _ = module?.removeSseHandle(id)
        DispatchQueue.main.async { [weak module] in
            module?.sendEvent("onSseDisconnected", [
                "subscriptionId": id,
                "reason": reason
            ])
        }
    }
}

// MARK: - Engine errors

/// Thrown when an engine method is called before `engineInit`.
private final class EngineNotInitializedException: Exception, @unchecked Sendable {
    override var reason: String {
        "MobileSyncEngine not initialized — call engineInit first"
    }
}

// MARK: - KeyValueStore implementation

/// `KeyValueStore` backing for `MobileSyncEngine`'s durable watermark
/// (`last_synced_hash` / `last_synced_content_id`). Each key maps to a file named
/// `key` under the App Group container — the SAME directory + filenames the Share /
/// Keyboard extensions write via `SettingsStore` (cross-process contract). Writes are
/// atomic (`Data.write(options: .atomic)` = tmp + rename), byte-identical to
/// `SettingsStore.writeLastSyncedHashFile`, so the two processes' watermark stays
/// coherent.
final class ExpoKeyValueStore: KeyValueStore, @unchecked Sendable {
    private let containerURL: URL

    init() {
        // Same App Group ID resolution as ExpoPlatformBridge / SettingsStore.
        self.containerURL = URL(fileURLWithPath: ExpoPlatformBridge().appGroupDir(), isDirectory: true)
    }

    private func fileURL(_ key: String) -> URL {
        containerURL.appendingPathComponent(key)
    }

    func get(key: String) -> Data? {
        try? Data(contentsOf: fileURL(key))
    }

    func set(key: String, value: Data) {
        try? value.write(to: fileURL(key), options: [.atomic])
    }

    func remove(key: String) {
        try? FileManager.default.removeItem(at: fileURL(key))
    }
}

// MARK: - PlatformBridge implementation

final class ExpoPlatformBridge: PlatformBridge, @unchecked Sendable {
    func appGroupDir() -> String {
        let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
        return url?.path ?? NSTemporaryDirectory()
    }

    private var appGroupID: String {
        Self.infoPlistAppGroupID ?? Self.bundleDerivedAppGroupID ?? Self.defaultAppGroupID
    }

    private static let defaultAppGroupID = "group.app.uniclipboard.UniClipboard"
    private static let appBundleIDPrefix = "app.uniclipboard.UniClipboard"
    private static let extensionBundleSuffixes = [".Share", ".Keyboard"]

    private static var infoPlistAppGroupID: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "UCAppGroupIdentifier") as? String else {
            return nil
        }
        return normalizeAppGroupID(raw)
    }

    private static var bundleDerivedAppGroupID: String? {
        guard var bundleID = Bundle.main.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              bundleID.hasPrefix(appBundleIDPrefix) else {
            return nil
        }
        for suffix in extensionBundleSuffixes where bundleID.hasSuffix(suffix) {
            bundleID.removeLast(suffix.count)
            break
        }
        return normalizeAppGroupID("group.\(bundleID)")
    }

    private static func normalizeAppGroupID(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty || value.contains("$(") ? nil : value
    }
}
