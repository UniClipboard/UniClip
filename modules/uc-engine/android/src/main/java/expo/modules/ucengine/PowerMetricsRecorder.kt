package expo.modules.ucengine

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.os.health.HealthStats
import android.os.health.SystemHealthManager
import android.os.health.UidHealthStats
import android.net.TrafficStats
import android.provider.Settings
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Closed vocabulary of sampling boundaries. See docs/specs/006-android-power-metrics.md.
 * Every one is an existing lifecycle event or a system broadcast; nothing here is a timer.
 */
internal enum class PowerSampleReason(val wire: String) {
  PROCESS_START("process.start"), APP_FOREGROUND("app.foreground"), APP_BACKGROUND("app.background"),
  SCREEN_ON("screen.on"), SCREEN_OFF("screen.off"), POWER_CONNECTED("power.connected"),
  POWER_DISCONNECTED("power.disconnected"), DOZE_CHANGED("doze.changed"), POWER_SAVE_CHANGED("powersave.changed"),
  SERVICE_STARTED("service.started"), SERVICE_STOPPED("service.stopped"), ENGINE_START("engine.start"),
  ENGINE_SUSPEND("engine.suspend"), ENGINE_RESUME("engine.resume"), ENGINE_SHUTDOWN("engine.shutdown"),
  NETWORK_CHANGED("network.changed"), QUERY("query"), RESET("reset")
}

/** What a source can provide on this device, decided from real reads, never assumed. */
internal enum class PowerSourceStatus(val wire: String) { OK("ok"), UNSUPPORTED("unsupported"), DENIED("denied"), ERROR("error") }

/** Reads a [BatteryManager] property. Injectable so failure modes (no sensor, denied) are testable. */
internal fun interface BatteryPropertyReader { fun read(id: Int): Long }

/**
 * Bounded, local-only recorder of power-relevant counters.
 *
 * It takes a sample only when [record] is called at an existing boundary, on one daemon thread,
 * with no timer, wake lock, network, or extra service. It stores raw cumulative counters; deltas,
 * validity and attribution are derived later by the shared aggregator so the UI and the export agree.
 */
internal class PowerMetricsRecorder(
  context: Context,
  private val directory: File?,
  private val maxSamples: Int = 1500,
  private val retentionMs: Long = 7L * 24 * 60 * 60 * 1000,
  private val burstPerMinute: Int = 30,
  private val batteryProperty: BatteryPropertyReader = BatteryPropertyReader { id ->
    context.applicationContext.getSystemService(BatteryManager::class.java).getLongProperty(id)
  }
) : AutoCloseable {
  private val app = context.applicationContext
  private val lock = Any()
  private val executor = ThreadPoolExecutor(
    1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(64)
  ) { runnable -> Thread(runnable, "uc-power-metrics").apply { isDaemon = true } }

  // State owned by the host, read at sample time. Everything else is read from the OS.
  @Volatile private var startedActivities = 0
  private var configChangeInFlight = false
  @Volatile private var serviceRunning = false
  @Volatile private var engineRunning = false
  @Volatile private var network: String? = null
  private val engineEvents = HashMap<String, Long>()

  private var droppedSamples = 0L
  private var writeFailures = 0L
  private var selfSamples = 0L
  private var selfCostUs = 0L
  private var selfCpuUs = 0L
  private var selfBinderCalls = 0L
  private val recentSampleTimes = ArrayDeque<Long>()

  // Touched only on the executor thread.
  private var nextSeq: Long? = null
  @Volatile private var fileSamples = 0
  private var truncatedPending = false
  private val sourceStatus = linkedMapOf<String, PowerSourceStatus>()
  private var previousExit: JSONObject? = null
  private var lastSampleWallMs: Long? = null
  private var receiversRegistered = false

  private val file: File? get() = directory?.let { File(it, "samples.jsonl") }

  fun start(application: Application) {
    if (receiversRegistered) return
    receiversRegistered = true
    previousExit = readPreviousExit()
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        val first = ++startedActivities == 1
        // The restart half of a rotation is not a return to the foreground.
        if (first && !configChangeInFlight) record(PowerSampleReason.APP_FOREGROUND)
        configChangeInFlight = false
      }
      override fun onActivityStopped(activity: Activity) {
        startedActivities = maxOf(0, startedActivities - 1)
        configChangeInFlight = activity.isChangingConfigurations
        if (startedActivities == 0 && !configChangeInFlight) record(PowerSampleReason.APP_BACKGROUND)
      }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
      override fun onActivityResumed(activity: Activity) = Unit
      override fun onActivityPaused(activity: Activity) = Unit
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
      override fun onActivityDestroyed(activity: Activity) = Unit
    })
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val reason = when (intent.action) {
          Intent.ACTION_SCREEN_ON -> PowerSampleReason.SCREEN_ON
          Intent.ACTION_SCREEN_OFF -> PowerSampleReason.SCREEN_OFF
          Intent.ACTION_POWER_CONNECTED -> PowerSampleReason.POWER_CONNECTED
          Intent.ACTION_POWER_DISCONNECTED -> PowerSampleReason.POWER_DISCONNECTED
          PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED -> PowerSampleReason.DOZE_CHANGED
          PowerManager.ACTION_POWER_SAVE_MODE_CHANGED -> PowerSampleReason.POWER_SAVE_CHANGED
          else -> return
        }
        record(reason)
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_POWER_DISCONNECTED)
      addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED); addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
    }
    runCatching {
      if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      else app.registerReceiver(receiver, filter)
    }
    record(PowerSampleReason.PROCESS_START)
  }

  fun setServiceRunning(running: Boolean) {
    if (serviceRunning == running) return
    serviceRunning = running
    record(if (running) PowerSampleReason.SERVICE_STARTED else PowerSampleReason.SERVICE_STOPPED)
  }

  fun setEngineRunning(running: Boolean, reason: PowerSampleReason) {
    engineRunning = running
    record(reason)
  }

  fun setNetwork(kind: String) {
    if (network == kind) return
    network = kind
    record(PowerSampleReason.NETWORK_CHANGED)
  }

  /** Counts one Engine event of a closed type. No payload is read, so no content can leak. */
  fun countEngineEvent(type: String) {
    synchronized(lock) { engineEvents[type] = (engineEvents[type] ?: 0L) + 1 }
  }

  /** Takes a sample now. Never blocks the caller and never throws. */
  fun record(reason: PowerSampleReason) {
    val elapsed = SystemClock.elapsedRealtime()
    val wall = System.currentTimeMillis()
    val uptime = SystemClock.uptimeMillis()
    // State changes are always worth a sample, but a flapping source must not turn into a cost.
    val admitted = synchronized(lock) {
      while (recentSampleTimes.isNotEmpty() && elapsed - recentSampleTimes.first() > 60_000) recentSampleTimes.removeFirst()
      if (reason != PowerSampleReason.RESET && recentSampleTimes.size >= burstPerMinute) { droppedSamples++; false }
      else { recentSampleTimes.addLast(elapsed); true }
    }
    if (!admitted) return
    submit { collect(reason, wall, elapsed, uptime) }
  }

  /**
   * Deletes all samples. A single `reset` sample follows so no window spans the reset; diagnostic logs are untouched.
   * Returns true only when the deletion was confirmed on the writer thread: a timeout or a failed delete is false.
   */
  fun reset(): Boolean {
    val task = FutureTask<Boolean> {
      val target = file
      val deleted = target == null || !target.exists() || target.delete()
      if (deleted) { fileSamples = 0; truncatedPending = false } else synchronized(lock) { writeFailures++ }
      deleted
    }
    submit { task.run() }
    val ok = try { task.get(2, TimeUnit.SECONDS) } catch (_: Exception) { false }
    if (ok) record(PowerSampleReason.RESET)
    return ok
  }

  fun flush(deadlineMs: Long = 2000): Boolean {
    val done = CountDownLatch(1)
    return try {
      executor.execute { done.countDown() }
      done.await(deadlineMs, TimeUnit.MILLISECONDS)
    } catch (_: RejectedExecutionException) { false } catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
  }

  /** A fresh `query` sample closes the open window up to now, then the file is described for the caller. */
  fun snapshot(): Map<String, Any?> {
    record(PowerSampleReason.QUERY)
    val flushed = flush()
    val target = file
    // The map belongs to the writer thread: copy it there and use the copy only if the wait completed.
    val copy = FutureTask<Map<String, String>> { sourceStatus.mapValues { it.value.wire } }
    submit { copy.run() }
    val sources = try { copy.get(1, TimeUnit.SECONDS) } catch (_: Exception) { emptyMap() }
    return mapOf(
      "flushStatus" to if (flushed) "completed" else "incomplete",
      "fileUri" to target?.takeIf { it.isFile }?.let { Uri.fromFile(it).toString() },
      "sampleCount" to fileSamples,
      "droppedSamples" to synchronized(lock) { droppedSamples }, "writeFailures" to synchronized(lock) { writeFailures },
      "maxSamples" to maxSamples, "retentionDays" to retentionMs / (24 * 60 * 60 * 1000L),
      "sources" to sources,
      "device" to mapOf("sdk" to Build.VERSION.SDK_INT, "manufacturer" to Build.MANUFACTURER, "model" to Build.MODEL),
      "policy" to "android-power-metrics-v1"
    )
  }

  override fun close() { flush(); executor.shutdown() }

  private fun submit(task: () -> Unit) {
    try { executor.execute(task) } catch (_: RejectedExecutionException) { synchronized(lock) { droppedSamples++ } }
  }

  // ---- everything below runs on the single executor thread ----

  private fun collect(reason: PowerSampleReason, wall: Long, elapsed: Long, uptime: Long) {
    val startNanos = SystemClock.elapsedRealtimeNanos()
    val cpuStart = Debug.threadCpuTimeNanos()
    var binder = 0
    try {
      val root = directory ?: error("directory unavailable")
      check(root.isDirectory || root.mkdirs() || root.isDirectory)
      if (nextSeq == null) loadExisting()
      val record = JSONObject().apply {
        put("v", 1); put("seq", nextSeq!!); put("reason", reason.wire)
        put("wallMs", wall); put("elapsedMs", elapsed); put("uptimeMs", uptime)
        put("epoch", JSONObject().put("boot", bootCount()).put("procStartElapsedMs", Process.getStartElapsedRealtime()).put("pid", Process.myPid()))
        val (ctx, ctxBinder) = context()
        put("ctx", ctx); binder += ctxBinder
        val (dev, devBinder) = device()
        put("dev", dev); binder += devBinder
        val (appCounters, appBinder) = appCounters()
        put("app", appCounters); binder += appBinder
        put("cnt", counters())
        if (reason == PowerSampleReason.PROCESS_START) previousExitFor(lastSampleWallMs)?.let { put("prevExit", it) }
        if (truncatedPending) { put("trunc", true); truncatedPending = false }
      }
      val self = synchronized(lock) {
        selfSamples++; selfBinderCalls += binder
        JSONObject().put("samples", selfSamples).put("costUs", selfCostUs).put("cpuUs", selfCpuUs).put("binderCalls", selfBinderCalls)
      }
      record.put("self", self)
      append(root, record)
      nextSeq = nextSeq!! + 1
    } catch (_: Exception) {
      synchronized(lock) { writeFailures++; droppedSamples++ }
    } finally {
      synchronized(lock) {
        selfCostUs += (SystemClock.elapsedRealtimeNanos() - startNanos) / 1000
        selfCpuUs += (Debug.threadCpuTimeNanos() - cpuStart) / 1000
      }
    }
  }

  private fun loadExisting() {
    val target = file
    var count = 0
    var last = -1L
    if (target != null && target.isFile) {
      target.forEachLine { line ->
        val parsed = runCatching { JSONObject(line) }.getOrNull()
        val seq = parsed?.optLong("seq", -1L) ?: -1L
        if (parsed != null && seq >= 0) { count++; last = maxOf(last, seq); lastSampleWallMs = parsed.optLong("wallMs").takeIf { it > 0 } }
      }
    }
    fileSamples = count
    nextSeq = last + 1
  }

  private fun append(root: File, record: JSONObject) {
    val target = File(root, "samples.jsonl")
    target.appendText(record.toString() + "\n")
    fileSamples++
    if (fileSamples > maxSamples + maxSamples / 10) compact(target)
  }

  /** Keeps the newest [maxSamples] within the retention age and marks the new first sample as truncated. */
  private fun compact(target: File) {
    val cutoff = System.currentTimeMillis() - retentionMs
    val lines = target.readLines().filter { it.isNotBlank() }
    val recent = lines.takeLast(maxSamples)
    // Wall time can jump (clock set forward); the age cutoff must never erase the newest sample.
    val kept = recent.filter { runCatching { JSONObject(it).getLong("wallMs") >= cutoff }.getOrDefault(true) }
      .ifEmpty { listOf(recent.last()) }
    val first = runCatching { JSONObject(kept.first()).put("trunc", true).toString() }.getOrDefault(kept.first())
    val rewritten = listOf(first) + kept.drop(1)
    val temp = File(target.parentFile, "samples.jsonl.tmp")
    temp.writeText(rewritten.joinToString("\n", postfix = "\n"))
    check(temp.renameTo(target))
    fileSamples = rewritten.size
  }

  private fun bootCount(): Any? = runCatching {
    Settings.Global.getInt(app.contentResolver, "boot_count", -1).takeIf { it >= 0 }
  }.getOrNull() ?: JSONObject.NULL

  private fun status(name: String, status: PowerSourceStatus) { if (sourceStatus[name] != status) sourceStatus[name] = status }

  private fun context(): Pair<JSONObject, Int> {
    var binder = 0
    val power = app.getSystemService(PowerManager::class.java)
    val activityManager = app.getSystemService(ActivityManager::class.java)
    val info = ActivityManager.RunningAppProcessInfo().also { runCatching { ActivityManager.getMyMemoryState(it) }; binder++ }
    val bucket = if (Build.VERSION.SDK_INT >= 28) runCatching {
      binder++; app.getSystemService(UsageStatsManager::class.java).appStandbyBucket
    }.getOrNull() else null
    val restricted = if (Build.VERSION.SDK_INT >= 28) runCatching { binder++; activityManager.isBackgroundRestricted }.getOrNull() else null
    val foreground = startedActivities > 0 || info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    val plugged = batteryIntent()?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
    return JSONObject().apply {
      put("app", if (foreground) "fg" else "bg"); put("importance", info.importance)
      put("screen", runCatching { binder++; power.isInteractive }.getOrNull() ?: JSONObject.NULL)
      put("plugged", pluggedWire(plugged))
      put("doze", runCatching { binder++; power.isDeviceIdleMode }.getOrNull() ?: JSONObject.NULL)
      put("powerSave", runCatching { binder++; power.isPowerSaveMode }.getOrNull() ?: JSONObject.NULL)
      put("service", serviceRunning); put("engine", engineRunning)
      put("net", network ?: JSONObject.NULL)
      put("bucket", bucket ?: JSONObject.NULL); put("bgRestricted", restricted ?: JSONObject.NULL)
    } to binder
  }

  private fun pluggedWire(value: Int?): Any = when {
    value == null || value < 0 -> JSONObject.NULL
    value == 0 -> "none"
    value and BatteryManager.BATTERY_PLUGGED_AC != 0 -> "ac"
    value and BatteryManager.BATTERY_PLUGGED_USB != 0 -> "usb"
    value and BatteryManager.BATTERY_PLUGGED_WIRELESS != 0 -> "wireless"
    value and 8 != 0 -> "dock"
    else -> "unknown"
  }

  /** The sticky intent is read at boundaries only; no `ACTION_BATTERY_CHANGED` receiver is ever registered. */
  private fun batteryIntent(): Intent? = runCatching { app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) }.getOrNull()

  private fun property(name: String, id: Int, invalid: (Long) -> Boolean): Any {
    return try {
      val value = batteryProperty.read(id)
      if (value == Long.MIN_VALUE || invalid(value)) { status(name, PowerSourceStatus.UNSUPPORTED); JSONObject.NULL }
      else { status(name, PowerSourceStatus.OK); value }
    } catch (_: SecurityException) { status(name, PowerSourceStatus.DENIED); JSONObject.NULL }
    catch (_: Exception) { status(name, PowerSourceStatus.ERROR); JSONObject.NULL }
  }

  private fun device(): Pair<JSONObject, Int> {
    // The sticky intent is the percentage the system shows the user; the property is only a fallback.
    val level: Any = batteryIntent()?.let {
      val raw = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      if (raw >= 0 && scale > 0) (raw * 100L / scale) else null
    } ?: property("batteryLevel", BatteryManager.BATTERY_PROPERTY_CAPACITY) { it !in 0..100 }
    return JSONObject().apply {
      put("levelPct", level)
      // A zero charge or energy counter cannot be a real reading on a working battery: treat it as absent.
      put("chargeUah", property("chargeCounter", BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER) { it <= 0 })
      put("energyNwh", property("energyCounter", BatteryManager.BATTERY_PROPERTY_ENERGY_COUNTER) { it <= 0 })
      // Instantaneous, OEM-signed. Stored raw for diagnosis only; the aggregator never integrates it.
      put("currentNowUa", property("currentNow", BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) { false })
      put("currentAvgUa", property("currentAverage", BatteryManager.BATTERY_PROPERTY_CURRENT_AVERAGE) { false })
    } to 5
  }

  private fun appCounters(): Pair<JSONObject, Int> {
    val uid = Process.myUid()
    val rx = TrafficStats.getUidRxBytes(uid)
    val tx = TrafficStats.getUidTxBytes(uid)
    status("trafficStats", if (rx == TrafficStats.UNSUPPORTED.toLong() || tx == TrafficStats.UNSUPPORTED.toLong()) PowerSourceStatus.UNSUPPORTED else PowerSourceStatus.OK)
    val (health, binder) = healthStats()
    return JSONObject().apply {
      put("cpuMs", Process.getElapsedCpuTime())
      put("rxBytes", if (rx == TrafficStats.UNSUPPORTED.toLong()) JSONObject.NULL else rx)
      put("txBytes", if (tx == TrafficStats.UNSUPPORTED.toLong()) JSONObject.NULL else tx)
      put("health", health ?: JSONObject.NULL)
    } to binder
  }

  /**
   * Same data source as `dumpsys batterystats`, restricted by the OS to this UID. Durations only:
   * wake-lock names are never read. One binder call per sample.
   */
  private fun healthStats(): Pair<JSONObject?, Int> = try {
    val snapshot = app.getSystemService(SystemHealthManager::class.java).takeMyUidSnapshot()
    status("healthStats", PowerSourceStatus.OK)
    JSONObject().apply {
      put("wakeMs", partialWakeMs(snapshot))
      put("cpuUserMs", measurement(snapshot, UidHealthStats.MEASUREMENT_USER_CPU_TIME_MS))
      put("cpuSysMs", measurement(snapshot, UidHealthStats.MEASUREMENT_SYSTEM_CPU_TIME_MS))
      put("radioMs", if (snapshot.hasTimer(UidHealthStats.TIMER_MOBILE_RADIO_ACTIVE)) snapshot.getTimerTime(UidHealthStats.TIMER_MOBILE_RADIO_ACTIVE) else JSONObject.NULL)
    } to 1
  } catch (_: SecurityException) { status("healthStats", PowerSourceStatus.DENIED); null to 1 }
  catch (_: Exception) { status("healthStats", PowerSourceStatus.ERROR); null to 1 }

  private fun measurement(stats: HealthStats, key: Int): Any = if (stats.hasMeasurement(key)) stats.getMeasurement(key) else JSONObject.NULL

  private fun partialWakeMs(stats: HealthStats): Any {
    if (!stats.hasTimers(UidHealthStats.TIMERS_WAKELOCKS_PARTIAL)) return JSONObject.NULL
    return stats.getTimers(UidHealthStats.TIMERS_WAKELOCKS_PARTIAL).values.sumOf { it.time.toLong() }
  }

  private fun counters(): JSONObject = synchronized(lock) {
    JSONObject().put("engineEvents", JSONObject(engineEvents as Map<*, *>)).put("droppedSamples", droppedSamples)
  }

  /**
   * Only an exit recorded after the last sample can belong to the previous process. A reboot or power loss
   * leaves no exit record, so an older entry would be misleading and is reported as `noExitRecord`.
   */
  private fun previousExitFor(lastSampleWall: Long?): JSONObject? {
    if (lastSampleWall == null) return null
    val exit = previousExit
    val timestamp = exit?.optLong("timestampMs") ?: 0L
    if (exit != null && timestamp >= lastSampleWall - 1000) return exit
    return if (sourceStatus["exitInfo"] == PowerSourceStatus.OK) JSONObject().put("reason", "noExitRecord").put("importance", JSONObject.NULL).put("timestampMs", JSONObject.NULL) else null
  }

  /** The OS records why the previous process ended; it is stored with `process.start`, never guessed. */
  private fun readPreviousExit(): JSONObject? {
    if (Build.VERSION.SDK_INT < 30) { status("exitInfo", PowerSourceStatus.UNSUPPORTED); return null }
    return try {
      val manager = app.getSystemService(ActivityManager::class.java)
      val exit = manager.getHistoricalProcessExitReasons(app.packageName, 0, 1).firstOrNull()
      status("exitInfo", PowerSourceStatus.OK)
      exit?.let {
        JSONObject().put("reason", exitReason(it.reason)).put("importance", it.importance).put("timestampMs", it.timestamp)
      }
    } catch (_: SecurityException) { status("exitInfo", PowerSourceStatus.DENIED); null }
    catch (_: Exception) { status("exitInfo", PowerSourceStatus.ERROR); null }
  }

  private fun exitReason(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "anr"
    ApplicationExitInfo.REASON_CRASH -> "crash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "crashNative"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependencyDied"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessiveResourceUsage"
    ApplicationExitInfo.REASON_EXIT_SELF -> "exitSelf"
    ApplicationExitInfo.REASON_FREEZER -> "freezer"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initializationFailure"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "lowMemory"
    ApplicationExitInfo.REASON_OTHER -> "other"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permissionChange"
    ApplicationExitInfo.REASON_SIGNALED -> "signaled"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "userRequested"
    ApplicationExitInfo.REASON_USER_STOPPED -> "userStopped"
    else -> "unknown"
  }
}
