package expo.modules.uccore

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import uniffi.uc_mobile.*

class UcCoreModule : Module() {

    companion object {
        private var initialized = false
    }

    private var client: MobileSyncClient? = null
    // Long-lived push/pull sync engine (design 2026-07-05). One instance for the
    // active server; `engineSetServer` reconfigures in place, never reconstructs.
    private var engine: MobileSyncEngine? = null
    private val handler = Handler(Looper.getMainLooper())
    private val sseHandles = ConcurrentHashMap<String, SseHandle>()

    private fun requireEngine(): MobileSyncEngine =
        engine ?: throw IllegalStateException("MobileSyncEngine not initialized — call engineInit first")

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

        Events("onSseHello", "onSseUpdate", "onSseResync", "onSseDisconnected")

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

        // SSE push channel (mobile-sync notify-then-pull). `subscriptionId` is
        // assigned by the TS epoch state machine (design §5.2) and echoed back
        // on every event so stale callbacks from a cancelled subscription can
        // be told apart from the current one. Reconnect policy is entirely on
        // the TS side: on `onSseDisconnected` the caller decides whether/when
        // to call `startSseSubscription` again.

        Function("startSseSubscription") { subscriptionId: String,
                                             serverMap: Map<String, String>,
                                             trustInsecureCert: Boolean ->
            val server = serverFromMap(serverMap)
            val listener = object : SseListener {
                override fun onHello(serverTimeMs: Long) {
                    handler.post {
                        sendEvent("onSseHello", mapOf(
                            "subscriptionId" to subscriptionId,
                            "serverTimeMs" to serverTimeMs
                        ))
                    }
                }

                override fun onUpdate(contentId: String) {
                    handler.post {
                        sendEvent("onSseUpdate", mapOf(
                            "subscriptionId" to subscriptionId,
                            "contentId" to contentId
                        ))
                    }
                }

                override fun onResync() {
                    handler.post {
                        sendEvent("onSseResync", mapOf("subscriptionId" to subscriptionId))
                    }
                }

                override fun onDisconnected(reason: String) {
                    sseHandles.remove(subscriptionId)
                    handler.post {
                        sendEvent("onSseDisconnected", mapOf(
                            "subscriptionId" to subscriptionId,
                            "reason" to reason
                        ))
                    }
                }
            }

            sseHandles.remove(subscriptionId)?.cancel()
            sseHandles[subscriptionId] = getClient(trustInsecureCert).startSseSubscription(server, listener)
        }

        Function("cancelSseSubscription") { subscriptionId: String ->
            sseHandles.remove(subscriptionId)?.cancel()
        }

        // --- MobileSyncEngine (push/pull sync SDK) ---
        // Replaces the per-function reducer driving: dedup / anti-loop / watermark /
        // conflict resolution all live inside the Rust engine. TS drives via these.

        Function("engineInit") { serverMap: Map<String, String>,
                                  configMap: Map<String, Any?>,
                                  settingsMap: Map<String, Any?>,
                                  trustInsecureCert: Boolean ->
            ensureInit()
            val ctx = appContext.reactContext?.applicationContext
                ?: throw IllegalStateException("no Android context for KeyValueStore")
            // Android has no App Group; watermark is persisted to app-private files
            // (single-process). Cross-process alignment with extensions is a follow-up.
            val baseDir = File(ctx.filesDir, "uc-mobile-kv").apply { mkdirs() }
            val store = AndroidKeyValueStore(baseDir)
            engine = MobileSyncEngine(
                serverFromMap(serverMap),
                syncConfigFromMap(configMap),
                syncSettingsFromMap(settingsMap),
                store,
                getClient(trustInsecureCert)
            )
        }

        Function("engineDispose") {
            engine?.close()
            engine = null
        }

        AsyncFunction("enginePush") { contentMap: Map<String, Any?>, payload: ByteArray? ->
            val content = localContentFromMap(contentMap, payload)
            syncOutcomeToMap(runBlocking { requireEngine().push(content) })
        }

        AsyncFunction("enginePull") { triggerMap: Map<String, Any?>, currentDeviceHash: String? ->
            val trigger = pullTriggerFromMap(triggerMap)
            syncOutcomeToMap(runBlocking { requireEngine().pull(trigger, currentDeviceHash) })
        }

        AsyncFunction("engineApplyStaged") {
            syncOutcomeToMap(runBlocking { requireEngine().applyStaged() })
        }

        AsyncFunction("engineSetServer") { serverMap: Map<String, String> ->
            val server = serverFromMap(serverMap)
            runBlocking { requireEngine().setServer(server) }
        }

        AsyncFunction("engineHandleNetworkRouteChanged") {
            runBlocking { requireEngine().handleNetworkRouteChanged() }
        }

        AsyncFunction("engineSetSettings") { settingsMap: Map<String, Any?> ->
            val settings = syncSettingsFromMap(settingsMap)
            runBlocking { requireEngine().setSettings(settings) }
        }

        AsyncFunction("engineAcknowledgeLoopDetected") {
            runBlocking { requireEngine().acknowledgeLoopDetected() }
        }

        OnDestroy {
            sseHandles.values.forEach { it.cancel() }
            sseHandles.clear()
            engine?.close()
            engine = null
        }

        // Sync config + cadence helpers (survivors from the pre-engine reducer design;
        // dedup/anti-loop/watermark/conflict resolution now live in MobileSyncEngine
        // above — these remain for RN-side history-sync cadence + cold-start/watermark
        // bookkeeping, which the engine doesn't own).

        Function("defaultSyncConfig") {
            ensureInit()
            syncConfigToMap(uniffi.uc_mobile.defaultSyncConfig())
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
    }
}

class AndroidPlatformBridge : PlatformBridge {
    override fun appGroupDir(): String {
        return ""
    }
}

/**
 * `KeyValueStore` backing for `MobileSyncEngine`'s durable watermark
 * (`last_synced_hash` / `last_synced_content_id`). Each key maps to a file named
 * `key` under [baseDir]. Writes are tmp-then-rename so a concurrent reader sees the
 * old or new value, never a half-written file. Android has no App Group, so this is
 * app-private (single-process) — cross-process alignment with extensions is a
 * separate follow-up.
 */
class AndroidKeyValueStore(private val baseDir: File) : KeyValueStore {
    private fun file(key: String) = File(baseDir, key)

    override fun get(key: String): ByteArray? {
        val f = file(key)
        return if (f.exists()) f.readBytes() else null
    }

    override fun set(key: String, value: ByteArray) {
        val tmp = File(baseDir, "$key.tmp")
        tmp.writeBytes(value)
        if (!tmp.renameTo(file(key))) {
            // renameTo can fail if the destination exists on some filesystems;
            // fall back to delete + rename.
            file(key).delete()
            tmp.renameTo(file(key))
        }
    }

    override fun remove(key: String) {
        file(key).delete()
    }
}

private fun clipboardKindFromString(kind: String?): ClipboardKind = when (kind) {
    "Image" -> ClipboardKind.IMAGE
    "File" -> ClipboardKind.FILE
    "Group" -> ClipboardKind.GROUP
    else -> ClipboardKind.TEXT
}

private fun syncSettingsFromMap(map: Map<String, Any?>): SyncSettings =
    SyncSettings(autoApply = map["autoApply"] as? Boolean ?: true)

private fun localContentFromMap(map: Map<String, Any?>, payload: ByteArray?): LocalContent =
    LocalContent(
        kind = clipboardKindFromString(map["kind"] as? String),
        text = map["text"] as? String ?: "",
        dataName = map["dataName"] as? String,
        payload = payload
    )

private fun pullTriggerFromMap(map: Map<String, Any?>): PullTrigger = when (map["tag"] as? String) {
    "Explicit" -> PullTrigger.Explicit
    "SseHello" -> PullTrigger.SseHello
    "SseResync" -> PullTrigger.SseResync
    "SseUpdate" -> PullTrigger.SseUpdate(map["contentId"] as? String ?: "")
    else -> PullTrigger.Routine
}

private fun upToDateReasonToString(r: UpToDateReason): String = when (r) {
    UpToDateReason.ALREADY_SYNCED -> "AlreadySynced"
    UpToDateReason.SELF_WRITTEN -> "SelfWritten"
    UpToDateReason.CONVERGED -> "Converged"
    UpToDateReason.NO_LOCAL_CHANGE -> "NoLocalChange"
    UpToDateReason.SSE_SHORT_CIRCUIT -> "SseShortCircuit"
    UpToDateReason.CONSENT_MODE -> "ConsentMode"
}

private fun syncedMetaToMap(m: SyncedMeta): Map<String, Any?> = mapOf(
    "kind" to clipboardKindToString(m.kind),
    "hash" to m.hash,
    "contentId" to m.contentId,
    "text" to m.text,
    "size" to m.size
)

private fun stagedPreviewToMap(p: StagedPreview): Map<String, Any?> = mapOf(
    "kind" to clipboardKindToString(p.kind),
    "text" to p.text,
    "size" to p.size
)

// Content sans payload — the Applied outcome carries payload bytes at the top level
// (top-level ByteArray marshals cleanly; nested does not always).
private fun localContentToMap(c: LocalContent): Map<String, Any?> = mapOf(
    "kind" to clipboardKindToString(c.kind),
    "text" to c.text,
    "dataName" to c.dataName
)

private fun syncOutcomeToMap(o: SyncOutcome): Map<String, Any?> = when (o) {
    is SyncOutcome.Uploaded -> mapOf("tag" to "Uploaded", "meta" to syncedMetaToMap(o.meta))
    is SyncOutcome.Applied -> mapOf(
        "tag" to "Applied",
        "content" to localContentToMap(o.content),
        "payload" to o.content.payload,
        "meta" to syncedMetaToMap(o.meta)
    )
    is SyncOutcome.Staged -> mapOf("tag" to "Staged", "preview" to stagedPreviewToMap(o.preview))
    is SyncOutcome.UpToDate -> mapOf("tag" to "UpToDate", "reason" to upToDateReasonToString(o.reason))
    is SyncOutcome.BackingOff -> mapOf("tag" to "BackingOff", "retryAfterMs" to o.retryAfterMs)
    SyncOutcome.LoopDetected -> mapOf("tag" to "LoopDetected")
    is SyncOutcome.Failed -> mapOf("tag" to "Failed", "error" to (o.error.message ?: o.error.toString()))
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

// Sync config type conversions (defaultSyncConfig / engineInit's SyncConfig arg)

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
