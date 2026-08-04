package expo.modules.ucengine

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.AtomicFile
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject
import uniffi.uc_engine_uniffi.BindingAnalyticsEvent
import uniffi.uc_engine_uniffi.BindingAnalyticsGroupIdentify
import uniffi.uc_engine_uniffi.BindingAnalyticsHost
import uniffi.uc_engine_uniffi.BindingAnalyticsHostException
import uniffi.uc_engine_uniffi.BindingAnalyticsIdentify
import uniffi.uc_engine_uniffi.BindingAnalyticsIdentityChange

private const val ANALYTICS_PREFERENCES = "uc_engine_analytics"
private const val POSTHOG_ENDPOINT = "https://us.i.posthog.com/i/v0/e/"

internal class AndroidPostHogAnalyticsHost(
  context: Context,
  private var appVersion: String,
  preferencesName: String = ANALYTICS_PREFERENCES,
  queueDirectoryOverride: File? = null,
  projectKeyOverride: String? = null,
  private val endpoint: String = POSTHOG_ENDPOINT
) : BindingAnalyticsHost {
  private val applicationContext = context.applicationContext
  private val preferences = applicationContext.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
  private val queueDirectory = queueDirectoryOverride ?: File(applicationContext.filesDir, "uc-engine-analytics/queue")
  private val executor = Executors.newSingleThreadExecutor()
  private val deliveryRunning = AtomicBoolean(false)
  private val activeDeviceCount = AtomicInteger(0)
  private val queueSequence = AtomicLong(0)
  private val sessionId = UUID.randomUUID().toString()
  private val projectKey = projectKeyOverride ?: runCatching {
    applicationContext.packageManager.getApplicationInfo(
      applicationContext.packageName,
      PackageManager.GET_META_DATA
    ).metaData?.getString("app.uniclipboard.analytics.POSTHOG_PROJECT_KEY")?.trim().orEmpty()
  }.getOrDefault("")

  init {
    if (!queueDirectory.exists() && !queueDirectory.mkdirs()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    scheduleDelivery()
  }

  fun updateApplicationContext(appVersion: String, activeDeviceCount: Int) {
    this.appVersion = appVersion
    this.activeDeviceCount.set(activeDeviceCount.coerceAtLeast(0))
  }
  fun consentEnabled(): Boolean = preferences.getBoolean("usage_analytics_enabled", true)
  fun setConsentEnabled(enabled: Boolean) {
    if (!preferences.edit().putBoolean("usage_analytics_enabled", enabled).commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    if (enabled) {
      identifyCurrentSpaceGroupIfNeeded()
      scheduleDelivery()
    } else {
      clearPendingEvents()
      persistSpaceGroupIdentified(false)
    }
  }
  fun resetAndIdentify() {
    clearPendingEvents()
    resetTelemetryIdentity()
  }

  fun getAnalyticsState(): Map<String, Any?> {
    val spacePersonId = preferences.getString("space_person_id", null)
    return mapOf(
      "projectKey" to projectKey,
      "consentEnabled" to consentEnabled(),
      "distinctId" to currentDistinctId(),
      "anonymousId" to identifier("anonymous_user_id"),
      "deviceId" to identifier("analytics_device_id"),
      "spaceGroupKey" to preferences.getString("space_id_hash", null),
      "isIdentified" to (spacePersonId != null)
    )
  }

  fun ensureSpaceContext(spaceId: String?, activeDeviceCount: Int) {
    if (spaceId.isNullOrEmpty()) {
      if (!preferences.edit().remove("space_id_hash").remove("space_group_identified").commit()) {
        throw BindingAnalyticsHostException.PersistenceFailed()
      }
      return
    }
    val groupKey = MessageDigest.getInstance("SHA-256").digest(spaceId.toByteArray())
      .take(8).joinToString("") { "%02x".format(it) }
    if (preferences.getString("space_id_hash", null) != groupKey) {
      if (!preferences.edit().putString("space_id_hash", groupKey)
          .putBoolean("space_group_identified", false).commit()) {
        throw BindingAnalyticsHostException.PersistenceFailed()
      }
    }
    identifyCurrentSpaceGroupIfNeeded(activeDeviceCount)
  }

  override fun capture(event: BindingAnalyticsEvent) {
    if (!consentEnabled() || projectKey.isEmpty()) return
    val properties = try { JSONObject(event.propertiesJson) } catch (_: Exception) {
      throw BindingAnalyticsHostException.DeliveryFailed()
    }
    if (containsSensitiveData(properties)) throw BindingAnalyticsHostException.DeliveryFailed()
    commonProperties().forEach { (key, value) -> properties.put(key, value) }
    properties.put("${'$'}insert_id", UUID.randomUUID().toString())
    properties.put("${'$'}device_id", properties.getString("analytics_device_id"))
    properties.put("${'$'}session_id", sessionId)
    properties.put("${'$'}lib", "uniclipboard-mobile")
    properties.put("${'$'}lib_version", appVersion)
    properties.put("${'$'}os", "Android")
    properties.put("${'$'}os_version", Build.VERSION.RELEASE)
    properties.put("${'$'}device_type", "Mobile")
    properties.put("${'$'}geoip_disable", true)
    preferences.getString("space_id_hash", null)?.let { group ->
      properties.put("space_id_hash", group)
      properties.put("${'$'}groups", JSONObject().put("space", group))
    }
    properties.put("${'$'}set", personProperties(properties))
    properties.put("${'$'}set_once", initialProperties(properties))
    enqueue(event.name, currentDistinctId(), properties)
  }

  override fun identify(payload: BindingAnalyticsIdentify) {
    if (!consentEnabled() || projectKey.isEmpty()) return
    val properties = JSONObject()
      .put("${'$'}anon_distinct_id", payload.oldDistinctId)
      .put("${'$'}lib", "uniclipboard-mobile")
      .put("${'$'}geoip_disable", true)
    addJson(payload.setJson, "${'$'}set", properties)
    addJson(payload.setOnceJson, "${'$'}set_once", properties)
    enqueue("${'$'}identify", payload.newDistinctId, properties)
  }

  override fun groupIdentify(payload: BindingAnalyticsGroupIdentify) {
    if (!preferences.edit().putString("space_id_hash", payload.groupKey)
        .putBoolean("space_group_identified", false).commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    if (!consentEnabled() || projectKey.isEmpty()) return
    val properties = JSONObject()
      .put("${'$'}group_type", payload.groupType)
      .put("${'$'}group_key", payload.groupKey)
      .put("${'$'}lib", "uniclipboard-mobile")
      .put("${'$'}geoip_disable", true)
    addJson(payload.setJson, "${'$'}group_set", properties)
    enqueue("${'$'}groupidentify", currentDistinctId(), properties)
    persistSpaceGroupIdentified(true)
  }

  @Synchronized
  override fun adoptSpacePerson(spacePersonId: String): BindingAnalyticsIdentityChange {
    runCatching { UUID.fromString(spacePersonId) }
      .getOrElse { throw BindingAnalyticsHostException.InvalidIdentity() }
    val previous = currentDistinctId()
    if (!preferences.edit().putString("space_person_id", spacePersonId).commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    return BindingAnalyticsIdentityChange(previous, spacePersonId)
  }

  @Synchronized
  override fun releaseSpacePerson(): BindingAnalyticsIdentityChange {
    val previous = currentDistinctId()
    val anonymous = identifier("anonymous_user_id")
    if (!preferences.edit().remove("space_person_id").remove("space_id_hash").commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    return BindingAnalyticsIdentityChange(previous, anonymous)
  }

  override fun currentSpacePersonId(): String? = preferences.getString("space_person_id", null)

  @Synchronized
  override fun resetTelemetryIdentity(): BindingAnalyticsIdentityChange {
    val previous = currentDistinctId()
    val anonymous = UUID.randomUUID().toString()
    if (!preferences.edit()
        .putString("anonymous_user_id", anonymous)
        .putString("analytics_device_id", UUID.randomUUID().toString())
        .remove("space_person_id").remove("space_id_hash").remove("space_group_identified")
        .remove("has_captured_event").commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    return BindingAnalyticsIdentityChange(previous, anonymous)
  }

  @Synchronized
  private fun currentDistinctId(): String =
    preferences.getString("space_person_id", null) ?: identifier("anonymous_user_id")

  @Synchronized
  private fun identifier(key: String): String {
    preferences.getString(key, null)?.let { if (runCatching { UUID.fromString(it) }.isSuccess) return it }
    val created = UUID.randomUUID().toString()
    if (!preferences.edit().putString(key, created).commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
    return created
  }

  private fun commonProperties(): Map<String, Any> {
    val firstRun = !preferences.getBoolean("has_captured_event", false)
    if (firstRun) preferences.edit().putBoolean("has_captured_event", true).apply()
    return mapOf(
      "anonymous_user_id" to identifier("anonymous_user_id"),
      "analytics_device_id" to identifier("analytics_device_id"),
      "session_id" to sessionId,
      "app_version" to appVersion,
      "app_channel" to if (applicationContext.packageName.endsWith(".dev")) "development" else "production",
      "os" to "android",
      "os_version" to Build.VERSION.RELEASE,
      "arch" to (Build.SUPPORTED_ABIS.firstOrNull() ?: "other"),
      "locale" to Locale.getDefault().toLanguageTag(),
      "timezone" to TimeZone.getDefault().id,
      "install_source" to "play_store",
      "is_first_run" to firstRun,
      "active_device_count" to activeDeviceCount.get()
    )
  }

  private fun identifyCurrentSpaceGroupIfNeeded(deviceCount: Int = activeDeviceCount.get()) {
    val groupKey = preferences.getString("space_id_hash", null) ?: return
    if (!consentEnabled() || projectKey.isEmpty() ||
      preferences.getBoolean("space_group_identified", false)) return
    groupIdentify(BindingAnalyticsGroupIdentify(
      "space",
      groupKey,
      JSONObject().put("device_count", deviceCount.coerceAtLeast(0)).toString()
    ))
  }

  private fun persistSpaceGroupIdentified(identified: Boolean) {
    if (!preferences.edit().putBoolean("space_group_identified", identified).commit()) {
      throw BindingAnalyticsHostException.PersistenceFailed()
    }
  }

  private fun enqueue(event: String, distinctId: String, properties: JSONObject) {
    if (!properties.has("${'$'}insert_id")) {
      properties.put("${'$'}insert_id", UUID.randomUUID().toString())
    }
    val body = JSONObject().put("api_key", projectKey).put("event", event)
      .put("distinct_id", distinctId).put("properties", properties)
      .put("timestamp", Instant.now().toString())
    val fileName = "%020d-%020d-%s.json".format(
      Locale.ROOT,
      System.currentTimeMillis(),
      queueSequence.incrementAndGet(),
      UUID.randomUUID()
    )
    val target = AtomicFile(File(queueDirectory, fileName))
    try {
      val output = target.startWrite()
      try { output.write(body.toString().toByteArray()); target.finishWrite(output) }
      catch (error: Throwable) { target.failWrite(output); throw error }
      pendingEvents().dropLast(256).forEach(File::delete)
    } catch (_: Exception) { throw BindingAnalyticsHostException.PersistenceFailed() }
    scheduleDelivery()
  }

  private fun scheduleDelivery() {
    if (!consentEnabled() || projectKey.isEmpty() || !deliveryRunning.compareAndSet(false, true)) return
    executor.execute {
      try {
        while (consentEnabled()) {
          val file = pendingEvents().firstOrNull() ?: break
          if (!deliver(file)) break
          file.delete()
        }
      } finally { deliveryRunning.set(false) }
    }
  }

  private fun deliver(file: File): Boolean {
    val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"; connectTimeout = 10_000; readTimeout = 10_000; doOutput = true
      setRequestProperty("Content-Type", "application/json")
    }
    return try {
      connection.outputStream.use { output -> file.inputStream().use { it.copyTo(output) } }
      connection.responseCode in 200..299
    } catch (_: Exception) { false } finally { connection.disconnect() }
  }

  private fun pendingEvents(): List<File> =
    queueDirectory.listFiles { file -> file.extension == "json" }?.sortedBy { it.name }.orEmpty()
  private fun clearPendingEvents() { pendingEvents().forEach(File::delete) }

  private fun addJson(json: String, key: String, target: JSONObject) {
    val value = try { JSONObject(json) } catch (_: Exception) {
      throw BindingAnalyticsHostException.DeliveryFailed()
    }
    if (containsSensitiveData(value)) throw BindingAnalyticsHostException.DeliveryFailed()
    if (value.length() > 0) target.put(key, value)
  }

  private fun containsSensitiveData(value: Any?, key: String? = null): Boolean {
    val forbidden = setOf("clipboard", "device_name", "display_name", "file_name", "filename", "path", "password", "secret", "token", "invitation_code", "credential")
    key?.lowercase()?.replace('-', '_')?.let {
      if (it in forbidden || it.endsWith("_path") || it.endsWith("_content")) return true
    }
    when (value) {
      is JSONObject -> { val keys = value.keys(); while (keys.hasNext()) { val child = keys.next(); if (containsSensitiveData(value.opt(child), child)) return true } }
      is JSONArray -> for (index in 0 until value.length()) if (containsSensitiveData(value.opt(index))) return true
      is String -> { val text = value.lowercase(); if (text.contains("file://") || text.contains("content://") || text.contains("/users/") || text.contains("/var/mobile/")) return true }
    }
    return false
  }

  private fun personProperties(source: JSONObject): JSONObject {
    val result = JSONObject()
    listOf("app_version", "app_channel", "os", "os_version", "arch", "locale", "timezone", "active_device_count", "space_id_hash")
      .forEach { if (source.has(it)) result.put(it, source.get(it)) }
    return result
  }
  private fun initialProperties(source: JSONObject): JSONObject = JSONObject()
    .put("initial_app_version", source.get("app_version"))
    .put("initial_app_channel", source.get("app_channel"))
    .put("initial_os", source.get("os"))
    .put("initial_install_source", source.get("install_source"))
}
