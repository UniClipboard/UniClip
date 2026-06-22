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
    "hash" to meta.hash
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
        hash = map["hash"] as? String
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
