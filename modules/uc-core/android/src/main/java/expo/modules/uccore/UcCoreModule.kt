package expo.modules.uccore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import uniffi.uc_mobile.*

class UcCoreModule : Module() {

    companion object {
        private var initialized = false
    }

    private var client: MobileSyncClient? = null

    private fun ensureInit() {
        if (!initialized) {
            ucMobileInit()
            initialized = true
        }
    }

    private fun getClient(trustInsecureCert: Boolean): MobileSyncClient {
        return client ?: run {
            ensureInit()
            val bridge = AndroidPlatformBridge()
            MobileSyncClient(bridge, trustInsecureCert).also { client = it }
        }
    }

    override fun definition() = ModuleDefinition {
        Name("UcCore")

        Function("parseConnectUri") { uri: String ->
            val payload = parseConnectUri(uri)
            mapOf(
                "v" to payload.v,
                "url" to payload.url,
                "urls" to payload.urls,
                "user" to payload.user,
                "pwd" to payload.pwd,
                "other" to payload.other
            )
        }

        AsyncFunction("getLatest") { serverMap: Map<String, String>,
                                      trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            val meta = runBlocking { getClient(trustInsecureCert).getLatest(server) }
            metaToMap(meta)
        }

        AsyncFunction("putClipboard") { serverMap: Map<String, String>,
                                         metaMap: Map<String, Any?>,
                                         payload: ByteArray?,
                                         trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            val meta = metaFromMap(metaMap)
            runBlocking { getClient(trustInsecureCert).putClipboard(server, meta, payload) }
        }

        AsyncFunction("testConnection") { serverMap: Map<String, String>,
                                           trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            val result = runBlocking {
                getClient(trustInsecureCert).testConnection(server, trustInsecureCert)
            }
            probeResultToString(result)
        }

        AsyncFunction("queryHistory") { serverMap: Map<String, String>,
                                          queryMap: Map<String, Any?>,
                                          trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            val query = historyQueryFromMap(queryMap)
            val records = runBlocking {
                getClient(trustInsecureCert).queryHistory(server, query)
            }
            records.map { historyRecordToMap(it) }
        }

        AsyncFunction("getFile") { serverMap: Map<String, String>,
                                     name: String,
                                     trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            runBlocking { getClient(trustInsecureCert).getFile(server, name) }
        }

        AsyncFunction("putFile") { serverMap: Map<String, String>,
                                     name: String,
                                     body: ByteArray,
                                     trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            runBlocking { getClient(trustInsecureCert).putFile(server, name, body) }
        }

        AsyncFunction("getHistoryPayload") { serverMap: Map<String, String>,
                                               profileId: String,
                                               trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            runBlocking { getClient(trustInsecureCert).getHistoryPayload(server, profileId) }
        }

        AsyncFunction("probe") { urls: List<String>,
                                   username: String,
                                   password: String,
                                   trustInsecureCert: Boolean,
                                   timeoutMs: Int,
                                   networkEpoch: Double ->
            val report = runBlocking {
                getClient(trustInsecureCert)
                    .probe(urls, username, password, trustInsecureCert,
                           timeoutMs.toUInt(), networkEpoch.toULong())
            }
            val results = mutableMapOf<String, String>()
            for ((url, result) in report.results) {
                results[url] = probeResultToString(result)
            }
            mapOf(
                "networkEpoch" to report.networkEpoch,
                "results" to results
            )
        }

        Function("cancelInFlight") {
            client?.cancelInFlight()
        }

        // Sync reducer functions (synchronous, pure state transforms)

        Function("defaultSyncConfig") {
            ensureInit()
            syncConfigToMap(uniffi.uc_mobile.defaultSyncConfig())
        }

        Function("defaultSyncRuntimeState") {
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.defaultSyncRuntimeState())
        }

        Function("planPreamble") { stateMap: Map<String, Any?>, snapMap: Map<String, Any?> ->
            ensureInit()
            val step = uniffi.uc_mobile.planPreamble(
                runtimeStateFromMap(stateMap),
                preambleSnapshotFromMap(snapMap)
            )
            mapOf(
                "state" to runtimeStateToMap(step.state),
                "preamble" to mapOf(
                    "recordLocal" to step.preamble.recordLocal,
                    "proceed" to preambleProceedToMap(step.preamble.proceed)
                )
            )
        }

        Function("planAfterServerGet") { stateMap: Map<String, Any?>, snapMap: Map<String, Any?> ->
            ensureInit()
            serverRouteToMap(
                uniffi.uc_mobile.planAfterServerGet(
                    runtimeStateFromMap(stateMap),
                    serverGetSnapshotFromMap(snapMap)
                )
            )
        }

        Function("commitConverged") { stateMap: Map<String, Any?>, serverHash: String, serverContentId: String? ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitConverged(runtimeStateFromMap(stateMap), serverHash, serverContentId))
        }

        Function("commitApply") { stateMap: Map<String, Any?>, hash: String?, contentId: String?, nowMs: Double, cfgMap: Map<String, Any?> ->
            ensureInit()
            commitStepToMap(uniffi.uc_mobile.commitApply(runtimeStateFromMap(stateMap), hash, contentId, nowMs.toLong(), syncConfigFromMap(cfgMap)))
        }

        Function("commitApplyFailed") { stateMap: Map<String, Any?>, entryMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitApplyFailed(runtimeStateFromMap(stateMap), metaFromMap(entryMap)))
        }

        Function("commitStage") { stateMap: Map<String, Any?>, entryMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitStage(runtimeStateFromMap(stateMap), metaFromMap(entryMap)))
        }

        Function("commitPush") { stateMap: Map<String, Any?>, pushedHash: String?, nowMs: Double, cfgMap: Map<String, Any?> ->
            ensureInit()
            commitStepToMap(uniffi.uc_mobile.commitPush(runtimeStateFromMap(stateMap), pushedHash, nowMs.toLong(), syncConfigFromMap(cfgMap)))
        }

        Function("commitPushSkipped") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitPushSkipped(runtimeStateFromMap(stateMap)))
        }

        Function("commitConsentPush") { stateMap: Map<String, Any?>, pushedHash: String?, nowMs: Double, cfgMap: Map<String, Any?> ->
            ensureInit()
            commitStepToMap(uniffi.uc_mobile.commitConsentPush(runtimeStateFromMap(stateMap), pushedHash, nowMs.toLong(), syncConfigFromMap(cfgMap)))
        }

        Function("commitTickSuccess") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitTickSuccess(runtimeStateFromMap(stateMap)))
        }

        Function("commitTickFailure") { stateMap: Map<String, Any?>, kind: String, jitter: Double, nowMs: Double, cfgMap: Map<String, Any?> ->
            ensureInit()
            val step = uniffi.uc_mobile.commitTickFailure(
                runtimeStateFromMap(stateMap),
                tickErrorKindFromString(kind),
                jitter,
                nowMs.toLong(),
                syncConfigFromMap(cfgMap)
            )
            mapOf(
                "state" to runtimeStateToMap(step.state),
                "outcome" to mapOf(
                    "kickProbe" to step.outcome.kickProbe,
                    "firstOffline" to step.outcome.firstOffline
                )
            )
        }

        Function("commitHistorySyncDone") { stateMap: Map<String, Any?>, nowMs: Double ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.commitHistorySyncDone(runtimeStateFromMap(stateMap), nowMs.toLong()))
        }

        Function("markStagedApplied") { stateMap: Map<String, Any?> ->
            ensureInit()
            val step = uniffi.uc_mobile.markStagedApplied(runtimeStateFromMap(stateMap))
            mapOf(
                "state" to runtimeStateToMap(step.state),
                "wasStaged" to step.wasStaged
            )
        }

        Function("acknowledgeLoopDetection") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.acknowledgeLoopDetection(runtimeStateFromMap(stateMap)))
        }

        Function("resetRuntimeState") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.resetRuntimeState(runtimeStateFromMap(stateMap)))
        }

        Function("handleActiveServerChanged") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.handleActiveServerChanged(runtimeStateFromMap(stateMap)))
        }

        Function("handleNetworkRouteChanged") { stateMap: Map<String, Any?> ->
            ensureInit()
            runtimeStateToMap(uniffi.uc_mobile.handleNetworkRouteChanged(runtimeStateFromMap(stateMap)))
        }

        // Sync helper functions

        Function("hashesEqual") { a: String?, b: String? ->
            ensureInit()
            uniffi.uc_mobile.hashesEqual(a, b)
        }

        Function("backoffSecs") { consecutiveFailures: Double, base: Double, max: Double, jitter: Double ->
            ensureInit()
            uniffi.uc_mobile.backoffSecs(consecutiveFailures.toLong(), base, max, jitter)
        }

        Function("cadenceSecs") { stateStr: String, isSceneInactive: Boolean, cfgMap: Map<String, Any?> ->
            ensureInit()
            uniffi.uc_mobile.cadenceSecs(syncStateFromString(stateStr), isSceneInactive, syncConfigFromMap(cfgMap))
        }

        Function("isHistorySyncDue") { lastSyncMs: Double?, nowMs: Double, intervalSecs: Double ->
            ensureInit()
            uniffi.uc_mobile.isHistorySyncDue(lastSyncMs?.toLong(), nowMs.toLong(), intervalSecs)
        }

        Function("isColdStart") { watermarkMs: Double? ->
            ensureInit()
            uniffi.uc_mobile.isColdStart(watermarkMs?.toLong())
        }

        Function("advanceWatermark") { currentMs: Double?, maxLastModifiedMs: Double ->
            ensureInit()
            uniffi.uc_mobile.advanceWatermark(currentMs?.toLong(), maxLastModifiedMs.toLong())
        }

        Function("isProbeConclusionValid") { reportEpoch: Double, currentEpoch: Double ->
            ensureInit()
            uniffi.uc_mobile.isProbeConclusionValid(reportEpoch.toULong(), currentEpoch.toULong())
        }
    }
}

class AndroidPlatformBridge : PlatformBridge {
    override fun appGroupDir(): String {
        return ""
    }
}

private fun serverFromMap(map: Map<String, String>): ServerConfig {
    var base = (map["baseUrl"] ?: "").trim()
    while (base.endsWith("/")) base = base.dropLast(1)
    return ServerConfig(
        baseUrl = base,
        username = map["username"] ?: "",
        password = map["password"] ?: ""
    )
}

private fun metaToMap(meta: ClipboardMeta): Map<String, Any?> = mapOf(
    "kind" to clipboardKindToString(meta.kind),
    "text" to meta.text,
    "dataName" to meta.dataName,
    "hasData" to meta.hasData,
    "size" to meta.size,
    "hash" to meta.hash,
    "contentId" to meta.contentId
)

private fun metaFromMap(map: Map<String, Any?>): ClipboardMeta {
    val kind = when (map["kind"] as? String) {
        "Image" -> ClipboardKind.IMAGE
        "File" -> ClipboardKind.FILE
        "Group" -> ClipboardKind.GROUP
        else -> ClipboardKind.TEXT
    }
    return ClipboardMeta(
        kind = kind,
        text = map["text"] as? String ?: "",
        dataName = map["dataName"] as? String,
        hasData = map["hasData"] as? Boolean ?: false,
        size = (map["size"] as? Number)?.toLong()?.toULong() ?: 0u,
        hash = map["hash"] as? String,
        contentId = map["contentId"] as? String
    )
}

private fun historyQueryFromMap(map: Map<String, Any?>): HistoryQuery {
    return HistoryQuery(
        page = (map["page"] as? Number)?.toLong(),
        beforeMs = (map["beforeMs"] as? Number)?.toLong(),
        afterMs = (map["afterMs"] as? Number)?.toLong(),
        modifiedAfterMs = (map["modifiedAfterMs"] as? Number)?.toLong(),
        types = (map["types"] as? Number)?.toLong(),
        searchText = map["searchText"] as? String,
        starred = map["starred"] as? Boolean,
        sortByLastAccessed = map["sortByLastAccessed"] as? Boolean
    )
}

private fun historyRecordToMap(r: HistoryRecord): Map<String, Any?> = mapOf(
    "hash" to r.hash,
    "kind" to clipboardKindToString(r.kind),
    "text" to r.text,
    "hasData" to r.hasData,
    "size" to r.size,
    "createTimeMs" to r.createTimeMs,
    "lastModifiedMs" to r.lastModifiedMs,
    "lastAccessedMs" to r.lastAccessedMs,
    "starred" to r.starred,
    "pinned" to r.pinned,
    "version" to r.version,
    "isDeleted" to r.isDeleted
)

private fun clipboardKindToString(kind: ClipboardKind): String = when (kind) {
    ClipboardKind.TEXT -> "Text"
    ClipboardKind.IMAGE -> "Image"
    ClipboardKind.FILE -> "File"
    ClipboardKind.GROUP -> "Group"
}

private fun probeResultToString(result: ProbeResult): String = when (result) {
    ProbeResult.SUCCESS -> "Success"
    ProbeResult.AUTH_FAILED -> "AuthFailed"
    ProbeResult.UNREACHABLE -> "Unreachable"
    ProbeResult.MISSING_FIELDS -> "MissingFields"
}

// Sync reducer type conversions

private fun syncStateToString(s: SyncState): String = when (s) {
    SyncState.IDLE -> "Idle"
    SyncState.SUCCEEDED -> "Succeeded"
    SyncState.HAS_NEW_UNWRITTEN -> "HasNewUnwritten"
    SyncState.OFFLINE_RETRYING -> "OfflineRetrying"
    SyncState.AUTH_FAILED -> "AuthFailed"
    SyncState.LOOP_DETECTED -> "LoopDetected"
}

private fun syncStateFromString(s: String): SyncState = when (s) {
    "Succeeded" -> SyncState.SUCCEEDED
    "HasNewUnwritten" -> SyncState.HAS_NEW_UNWRITTEN
    "OfflineRetrying" -> SyncState.OFFLINE_RETRYING
    "AuthFailed" -> SyncState.AUTH_FAILED
    "LoopDetected" -> SyncState.LOOP_DETECTED
    else -> SyncState.IDLE
}

private fun loopDirectionToString(d: LoopDirection): String = when (d) {
    LoopDirection.PULLED -> "Pulled"
    LoopDirection.PUSHED -> "Pushed"
}

private fun loopDirectionFromString(s: String): LoopDirection = when (s) {
    "Pushed" -> LoopDirection.PUSHED
    else -> LoopDirection.PULLED
}

private fun runtimeStateToMap(s: SyncRuntimeState): Map<String, Any?> = mapOf(
    "state" to syncStateToString(s.state),
    "lastSyncedHash" to s.lastSyncedHash,
    "lastSyncedContentId" to s.lastSyncedContentId,
    "lastAppliedHash" to s.lastAppliedHash,
    "loopEvents" to s.loopEvents.map { ev ->
        mapOf(
            "hash" to ev.hash,
            "direction" to loopDirectionToString(ev.direction),
            "atMillis" to ev.atMillis
        )
    },
    "stagedServerHash" to s.stagedServerHash,
    "stagedContentId" to s.stagedContentId,
    "stagedEntry" to s.stagedEntry?.let { metaToMap(it) },
    "consecutiveFailures" to s.consecutiveFailures,
    "nextAttemptMs" to s.nextAttemptMs,
    "lastHistorySyncMs" to s.lastHistorySyncMs
)

@Suppress("UNCHECKED_CAST")
private fun runtimeStateFromMap(map: Map<String, Any?>): SyncRuntimeState {
    val loopEventsRaw = map["loopEvents"] as? List<Map<String, Any?>> ?: emptyList()
    val loopEvents = loopEventsRaw.map { ev ->
        LoopGuardEvent(
            hash = ev["hash"] as? String ?: "",
            direction = loopDirectionFromString(ev["direction"] as? String ?: ""),
            atMillis = (ev["atMillis"] as? Number)?.toLong() ?: 0L
        )
    }
    val stagedEntryMap = map["stagedEntry"] as? Map<String, Any?>
    return SyncRuntimeState(
        state = syncStateFromString(map["state"] as? String ?: "Idle"),
        lastSyncedHash = map["lastSyncedHash"] as? String,
        lastSyncedContentId = map["lastSyncedContentId"] as? String,
        lastAppliedHash = map["lastAppliedHash"] as? String,
        loopEvents = loopEvents,
        stagedServerHash = map["stagedServerHash"] as? String,
        stagedContentId = map["stagedContentId"] as? String,
        stagedEntry = stagedEntryMap?.let { metaFromMap(it) },
        consecutiveFailures = (map["consecutiveFailures"] as? Number)?.toLong() ?: 0L,
        nextAttemptMs = (map["nextAttemptMs"] as? Number)?.toLong(),
        lastHistorySyncMs = (map["lastHistorySyncMs"] as? Number)?.toLong()
    )
}

private fun syncConfigToMap(c: SyncConfig): Map<String, Any> = mapOf(
    "normalCadenceSecs" to c.normalCadenceSecs,
    "inactiveCadenceSecs" to c.inactiveCadenceSecs,
    "offlineBackoffSecs" to c.offlineBackoffSecs,
    "offlineBackoffMaxSecs" to c.offlineBackoffMaxSecs,
    "historySyncIntervalSecs" to c.historySyncIntervalSecs,
    "loopWindowSecs" to c.loopWindowSecs,
    "loopFlipThreshold" to c.loopFlipThreshold
)

private fun syncConfigFromMap(map: Map<String, Any?>): SyncConfig = SyncConfig(
    normalCadenceSecs = (map["normalCadenceSecs"] as? Number)?.toDouble() ?: 1.0,
    inactiveCadenceSecs = (map["inactiveCadenceSecs"] as? Number)?.toDouble() ?: 5.0,
    offlineBackoffSecs = (map["offlineBackoffSecs"] as? Number)?.toDouble() ?: 5.0,
    offlineBackoffMaxSecs = (map["offlineBackoffMaxSecs"] as? Number)?.toDouble() ?: 60.0,
    historySyncIntervalSecs = (map["historySyncIntervalSecs"] as? Number)?.toDouble() ?: 30.0,
    loopWindowSecs = (map["loopWindowSecs"] as? Number)?.toDouble() ?: 30.0,
    loopFlipThreshold = (map["loopFlipThreshold"] as? Number)?.toLong() ?: 3L
)

private fun preambleSnapshotFromMap(map: Map<String, Any?>): PreambleSnapshot = PreambleSnapshot(
    explicit = map["explicit"] as? Boolean ?: false,
    autoPush = map["autoPush"] as? Boolean ?: false,
    hasActiveServer = map["hasActiveServer"] as? Boolean ?: false,
    deviceHash = map["deviceHash"] as? String,
    historyHeadHash = map["historyHeadHash"] as? String,
    persistedSyncedHash = map["persistedSyncedHash"] as? String,
    persistedSyncedContentId = map["persistedSyncedContentId"] as? String,
    nowMs = (map["nowMs"] as? Number)?.toLong() ?: 0L
)

@Suppress("UNCHECKED_CAST")
private fun serverGetSnapshotFromMap(map: Map<String, Any?>): ServerGetSnapshot {
    val serverEntryMap = map["serverEntry"] as? Map<String, Any?>
    return ServerGetSnapshot(
        autoApply = map["autoApply"] as? Boolean ?: false,
        autoPush = map["autoPush"] as? Boolean ?: false,
        serverEntry = serverEntryMap?.let { metaFromMap(it) },
        devicePresent = map["devicePresent"] as? Boolean ?: false,
        deviceHash = map["deviceHash"] as? String
    )
}

private fun preambleProceedToMap(p: PreambleProceed): Map<String, Any> = when (p) {
    is PreambleProceed.Stop -> {
        val reasonStr = when (p.reason) {
            StopReason.NO_ACTIVE_SERVER -> "NoActiveServer"
            StopReason.PAUSED -> "Paused"
            StopReason.BACKOFF_GATE -> "BackoffGated"
        }
        mapOf("type" to "Stop", "reason" to reasonStr)
    }
    is PreambleProceed.ToNetwork -> mapOf("type" to "ToNetwork")
}

private fun serverRouteToMap(route: ServerRoute): Map<String, Any?> = when (route) {
    is ServerRoute.Converged -> mapOf("type" to "Converged", "serverHash" to route.serverHash)
    is ServerRoute.ServerNew -> mapOf(
        "type" to "ServerNew",
        "plan" to mapOf(
            "willApply" to route.plan.willApply,
            "alreadyStaged" to route.plan.alreadyStaged
        )
    )
    is ServerRoute.Push -> {
        val decStr = when (route.decision) {
            PushDecision.SKIP_CONSENT_MODE -> "SkipConsentMode"
            PushDecision.SKIP_NO_DEVICE -> "SkipNoDevice"
            PushDecision.SKIP_ALREADY_SYNCED -> "SkipAlreadySynced"
            PushDecision.SKIP_SELF_WRITTEN -> "SkipSelfWritten"
            PushDecision.DO_PUSH -> "DoPush"
        }
        mapOf("type" to "Push", "decision" to decStr)
    }
}

private fun commitStepToMap(step: CommitStep): Map<String, Any?> = mapOf(
    "state" to runtimeStateToMap(step.state),
    "outcome" to mapOf("tripped" to step.outcome.tripped)
)

private fun tickErrorKindFromString(s: String): TickErrorKind = when (s) {
    "AuthFailed" -> TickErrorKind.AUTH_FAILED
    "Cancelled" -> TickErrorKind.CANCELLED
    "NetworkUnreachable" -> TickErrorKind.NETWORK_UNREACHABLE
    "ConnectTimeout" -> TickErrorKind.CONNECT_TIMEOUT
    "ReceiveTimeout" -> TickErrorKind.RECEIVE_TIMEOUT
    "OtherSyncError" -> TickErrorKind.OTHER_SYNC_ERROR
    else -> TickErrorKind.UNEXPECTED
}
