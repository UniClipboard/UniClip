import ExpoModulesCore

public class UcCoreModule: Module {

    private static var initialized = false
    private var client: MobileSyncClient?

    private func ensureInit() {
        if !UcCoreModule.initialized {
            ucMobileInit()
            UcCoreModule.initialized = true
        }
    }

    private func getClient(trustInsecureCert: Bool) throws -> MobileSyncClient {
        if let c = client { return c }
        ensureInit()
        let bridge = ExpoPlatformBridge()
        let c = try MobileSyncClient(bridge: bridge, trustInsecureCert: trustInsecureCert)
        client = c
        return c
    }

    public func definition() -> ModuleDefinition {
        Name("UcCore")

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
            try await self.getClient(trustInsecureCert: trustInsecureCert)
                .putClipboard(server: server, meta: meta, payload: payload)
        }

        AsyncFunction("testConnection") { (serverMap: [String: String], trustInsecureCert: Bool) -> String in
            let server = self.serverFromMap(serverMap)
            let result = await try self.getClient(trustInsecureCert: trustInsecureCert)
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
            let report = await try self.getClient(trustInsecureCert: trustInsecureCert)
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

        Function("cancelInFlight") {
            self.client?.cancelInFlight()
        }
    }

    // MARK: - Type conversion helpers

    private func serverFromMap(_ map: [String: String]) -> ServerConfig {
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
            "hash": meta.hash
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
            hash: map["hash"] as? String
        )
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

    private func historyRecordToMap(_ r: HistoryRecord) -> [String: Any?] {
        return [
            "hash": r.hash,
            "kind": self.clipboardKindToString(r.kind),
            "text": r.text,
            "hasData": r.hasData,
            "size": r.size,
            "createTimeMs": r.createTimeMs,
            "lastModifiedMs": r.lastModifiedMs,
            "lastAccessedMs": r.lastAccessedMs,
            "starred": r.starred,
            "pinned": r.pinned,
            "version": r.version,
            "isDeleted": r.isDeleted
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
}

// MARK: - PlatformBridge implementation

class ExpoPlatformBridge: PlatformBridge {
    func appGroupDir() -> String {
        let url = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.app.uniclipboard.ios"
        )
        return url?.path ?? NSTemporaryDirectory()
    }
}
