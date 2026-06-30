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

        // MARK: - Sync reducer functions (synchronous, pure state transforms)

        Function("defaultSyncConfig") { () -> [String: Any] in
            self.ensureInit()
            return self.syncConfigToMap(defaultSyncConfig())
        }

        Function("defaultSyncRuntimeState") { () -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(defaultSyncRuntimeState())
        }

        Function("planPreamble") { (stateMap: [String: Any?], snapMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            let state = self.runtimeStateFromMap(stateMap)
            let snap = self.preambleSnapshotFromMap(snapMap)
            let step = planPreamble(state: state, snap: snap)
            return [
                "state": self.runtimeStateToMap(step.state),
                "preamble": [
                    "recordLocal": step.preamble.recordLocal,
                    "proceed": self.preambleProceedToMap(step.preamble.proceed)
                ] as [String: Any]
            ] as [String: Any]
        }

        Function("planAfterServerGet") { (stateMap: [String: Any?], snapMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            let state = self.runtimeStateFromMap(stateMap)
            let snap = self.serverGetSnapshotFromMap(snapMap)
            let route = planAfterServerGet(state: state, snap: snap)
            return self.serverRouteToMap(route)
        }

        Function("commitConverged") { (stateMap: [String: Any?], serverHash: String, serverContentId: String?) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitConverged(state: self.runtimeStateFromMap(stateMap), serverHash: serverHash, serverContentId: serverContentId))
        }

        Function("commitApply") { (stateMap: [String: Any?], hash: String?, contentId: String?, nowMs: Int, cfgMap: [String: Any]) -> [String: Any?] in
            self.ensureInit()
            let step = commitApply(state: self.runtimeStateFromMap(stateMap), hash: hash, contentId: contentId, nowMs: Int64(nowMs), cfg: self.syncConfigFromMap(cfgMap))
            return self.commitStepToMap(step)
        }

        Function("commitApplyFailed") { (stateMap: [String: Any?], entryMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitApplyFailed(state: self.runtimeStateFromMap(stateMap), entry: self.metaFromMap(entryMap)))
        }

        Function("commitStage") { (stateMap: [String: Any?], entryMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitStage(state: self.runtimeStateFromMap(stateMap), entry: self.metaFromMap(entryMap)))
        }

        Function("commitPush") { (stateMap: [String: Any?], pushedHash: String?, nowMs: Int, cfgMap: [String: Any]) -> [String: Any?] in
            self.ensureInit()
            let step = commitPush(state: self.runtimeStateFromMap(stateMap), pushedHash: pushedHash, nowMs: Int64(nowMs), cfg: self.syncConfigFromMap(cfgMap))
            return self.commitStepToMap(step)
        }

        Function("commitPushSkipped") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitPushSkipped(state: self.runtimeStateFromMap(stateMap)))
        }

        Function("commitConsentPush") { (stateMap: [String: Any?], pushedHash: String?, nowMs: Int, cfgMap: [String: Any]) -> [String: Any?] in
            self.ensureInit()
            let step = commitConsentPush(state: self.runtimeStateFromMap(stateMap), pushedHash: pushedHash, nowMs: Int64(nowMs), cfg: self.syncConfigFromMap(cfgMap))
            return self.commitStepToMap(step)
        }

        Function("commitTickSuccess") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitTickSuccess(state: self.runtimeStateFromMap(stateMap)))
        }

        Function("commitTickFailure") { (stateMap: [String: Any?], kind: String, jitter: Double, nowMs: Int, cfgMap: [String: Any]) -> [String: Any?] in
            self.ensureInit()
            let step = commitTickFailure(
                state: self.runtimeStateFromMap(stateMap),
                kind: self.tickErrorKindFromString(kind),
                jitter: jitter,
                nowMs: Int64(nowMs),
                cfg: self.syncConfigFromMap(cfgMap)
            )
            return [
                "state": self.runtimeStateToMap(step.state),
                "outcome": [
                    "kickProbe": step.outcome.kickProbe,
                    "firstOffline": step.outcome.firstOffline
                ] as [String: Any]
            ] as [String: Any]
        }

        Function("commitHistorySyncDone") { (stateMap: [String: Any?], nowMs: Int) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(commitHistorySyncDone(state: self.runtimeStateFromMap(stateMap), nowMs: Int64(nowMs)))
        }

        Function("markStagedApplied") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            let step = markStagedApplied(state: self.runtimeStateFromMap(stateMap))
            return [
                "state": self.runtimeStateToMap(step.state),
                "wasStaged": step.wasStaged
            ] as [String: Any]
        }

        Function("acknowledgeLoopDetection") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(acknowledgeLoopDetection(state: self.runtimeStateFromMap(stateMap)))
        }

        Function("resetRuntimeState") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(resetRuntimeState(state: self.runtimeStateFromMap(stateMap)))
        }

        Function("handleActiveServerChanged") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(handleActiveServerChanged(state: self.runtimeStateFromMap(stateMap)))
        }

        Function("handleNetworkRouteChanged") { (stateMap: [String: Any?]) -> [String: Any?] in
            self.ensureInit()
            return self.runtimeStateToMap(handleNetworkRouteChanged(state: self.runtimeStateFromMap(stateMap)))
        }

        // MARK: - Sync helper functions

        Function("hashesEqual") { (a: String?, b: String?) -> Bool in
            self.ensureInit()
            return hashesEqual(a: a, b: b)
        }

        Function("backoffSecs") { (consecutiveFailures: Int, base: Double, max: Double, jitter: Double) -> Double in
            self.ensureInit()
            return backoffSecs(consecutiveFailures: Int64(consecutiveFailures), base: base, max: max, jitter: jitter)
        }

        Function("cadenceSecs") { (stateStr: String, isSceneInactive: Bool, cfgMap: [String: Any]) -> Double in
            self.ensureInit()
            return cadenceSecs(state: self.syncStateFromString(stateStr), isSceneInactive: isSceneInactive, cfg: self.syncConfigFromMap(cfgMap))
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

        Function("isProbeConclusionValid") { (reportEpoch: Double, currentEpoch: Double) -> Bool in
            self.ensureInit()
            return isProbeConclusionValid(reportEpoch: UInt64(reportEpoch), currentEpoch: UInt64(currentEpoch))
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

    // MARK: - Sync reducer type conversions

    private func syncStateToString(_ s: SyncState) -> String {
        switch s {
        case .idle: return "Idle"
        case .succeeded: return "Succeeded"
        case .hasNewUnwritten: return "HasNewUnwritten"
        case .offlineRetrying: return "OfflineRetrying"
        case .authFailed: return "AuthFailed"
        case .loopDetected: return "LoopDetected"
        }
    }

    private func syncStateFromString(_ s: String) -> SyncState {
        switch s {
        case "Succeeded": return .succeeded
        case "HasNewUnwritten": return .hasNewUnwritten
        case "OfflineRetrying": return .offlineRetrying
        case "AuthFailed": return .authFailed
        case "LoopDetected": return .loopDetected
        default: return .idle
        }
    }

    private func loopDirectionToString(_ d: LoopDirection) -> String {
        switch d {
        case .pulled: return "Pulled"
        case .pushed: return "Pushed"
        }
    }

    private func loopDirectionFromString(_ s: String) -> LoopDirection {
        switch s {
        case "Pushed": return .pushed
        default: return .pulled
        }
    }

    private func runtimeStateToMap(_ s: SyncRuntimeState) -> [String: Any?] {
        return [
            "state": syncStateToString(s.state),
            "lastSyncedHash": s.lastSyncedHash,
            "lastSyncedContentId": s.lastSyncedContentId,
            "lastAppliedHash": s.lastAppliedHash,
            "loopEvents": s.loopEvents.map { ev -> [String: Any] in
                [
                    "hash": ev.hash,
                    "direction": loopDirectionToString(ev.direction),
                    "atMillis": ev.atMillis
                ]
            },
            "stagedServerHash": s.stagedServerHash,
            "stagedContentId": s.stagedContentId,
            "stagedEntry": s.stagedEntry.map { metaToMap($0) },
            "consecutiveFailures": s.consecutiveFailures,
            "nextAttemptMs": s.nextAttemptMs,
            "lastHistorySyncMs": s.lastHistorySyncMs
        ]
    }

    private func runtimeStateFromMap(_ map: [String: Any?]) -> SyncRuntimeState {
        let loopEventsRaw = map["loopEvents"] as? [[String: Any]] ?? []
        let loopEvents: [LoopGuardEvent] = loopEventsRaw.map { ev in
            LoopGuardEvent(
                hash: ev["hash"] as? String ?? "",
                direction: loopDirectionFromString(ev["direction"] as? String ?? ""),
                atMillis: (ev["atMillis"] as? NSNumber)?.int64Value ?? 0
            )
        }
        let stagedEntryMap = map["stagedEntry"] as? [String: Any?]
        return SyncRuntimeState(
            state: syncStateFromString(map["state"] as? String ?? "Idle"),
            lastSyncedHash: map["lastSyncedHash"] as? String,
            lastSyncedContentId: map["lastSyncedContentId"] as? String,
            lastAppliedHash: map["lastAppliedHash"] as? String,
            loopEvents: loopEvents,
            stagedServerHash: map["stagedServerHash"] as? String,
            stagedContentId: map["stagedContentId"] as? String,
            stagedEntry: stagedEntryMap.map { metaFromMap($0) },
            consecutiveFailures: (map["consecutiveFailures"] as? NSNumber)?.int64Value ?? 0,
            nextAttemptMs: (map["nextAttemptMs"] as? NSNumber)?.int64Value,
            lastHistorySyncMs: (map["lastHistorySyncMs"] as? NSNumber)?.int64Value
        )
    }

    private func syncConfigToMap(_ c: SyncConfig) -> [String: Any] {
        return [
            "normalCadenceSecs": c.normalCadenceSecs,
            "inactiveCadenceSecs": c.inactiveCadenceSecs,
            "offlineBackoffSecs": c.offlineBackoffSecs,
            "offlineBackoffMaxSecs": c.offlineBackoffMaxSecs,
            "historySyncIntervalSecs": c.historySyncIntervalSecs,
            "loopWindowSecs": c.loopWindowSecs,
            "loopFlipThreshold": c.loopFlipThreshold
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

    private func preambleSnapshotFromMap(_ map: [String: Any?]) -> PreambleSnapshot {
        return PreambleSnapshot(
            explicit: map["explicit"] as? Bool ?? false,
            autoPush: map["autoPush"] as? Bool ?? false,
            hasActiveServer: map["hasActiveServer"] as? Bool ?? false,
            deviceHash: map["deviceHash"] as? String,
            historyHeadHash: map["historyHeadHash"] as? String,
            persistedSyncedHash: map["persistedSyncedHash"] as? String,
            persistedSyncedContentId: map["persistedSyncedContentId"] as? String,
            nowMs: (map["nowMs"] as? NSNumber)?.int64Value ?? 0
        )
    }

    private func serverGetSnapshotFromMap(_ map: [String: Any?]) -> ServerGetSnapshot {
        let serverEntryMap = map["serverEntry"] as? [String: Any?]
        return ServerGetSnapshot(
            autoApply: map["autoApply"] as? Bool ?? false,
            autoPush: map["autoPush"] as? Bool ?? false,
            serverEntry: serverEntryMap.map { metaFromMap($0) },
            devicePresent: map["devicePresent"] as? Bool ?? false,
            deviceHash: map["deviceHash"] as? String
        )
    }

    private func preambleProceedToMap(_ p: PreambleProceed) -> [String: Any] {
        switch p {
        case .stop(let reason):
            let reasonStr: String
            switch reason {
            case .noActiveServer: reasonStr = "NoActiveServer"
            case .paused: reasonStr = "Paused"
            case .backoffGate: reasonStr = "BackoffGated"
            }
            return ["type": "Stop", "reason": reasonStr]
        case .toNetwork:
            return ["type": "ToNetwork"]
        }
    }

    private func serverRouteToMap(_ route: ServerRoute) -> [String: Any?] {
        switch route {
        case .converged(let serverHash):
            return ["type": "Converged", "serverHash": serverHash]
        case .serverNew(let plan):
            return [
                "type": "ServerNew",
                "plan": [
                    "willApply": plan.willApply,
                    "alreadyStaged": plan.alreadyStaged
                ] as [String: Any]
            ]
        case .push(let decision):
            let decStr: String
            switch decision {
            case .skipConsentMode: decStr = "SkipConsentMode"
            case .skipNoDevice: decStr = "SkipNoDevice"
            case .skipAlreadySynced: decStr = "SkipAlreadySynced"
            case .skipSelfWritten: decStr = "SkipSelfWritten"
            case .doPush: decStr = "DoPush"
            }
            return ["type": "Push", "decision": decStr]
        }
    }

    private func commitStepToMap(_ step: CommitStep) -> [String: Any?] {
        return [
            "state": runtimeStateToMap(step.state),
            "outcome": [
                "tripped": step.outcome.tripped
            ] as [String: Any]
        ] as [String: Any]
    }

    private func tickErrorKindFromString(_ s: String) -> TickErrorKind {
        switch s {
        case "AuthFailed": return .authFailed
        case "Cancelled": return .cancelled
        case "NetworkUnreachable": return .networkUnreachable
        case "ConnectTimeout": return .connectTimeout
        case "ReceiveTimeout": return .receiveTimeout
        case "OtherSyncError": return .otherSyncError
        default: return .unexpected
        }
    }
}

// MARK: - PlatformBridge implementation

class ExpoPlatformBridge: PlatformBridge {
    func appGroupDir() -> String {
        let url = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.app.uniclipboard.UniClipboard"
        )
        return url?.path ?? NSTemporaryDirectory()
    }
}
