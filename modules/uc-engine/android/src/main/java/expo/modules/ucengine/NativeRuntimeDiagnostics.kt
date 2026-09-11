package expo.modules.ucengine

import android.net.Uri
import android.os.Process
import android.os.SystemClock
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import org.json.JSONObject

internal enum class NativeDiagnosticEvent(val wire: String) {
  CAPTURE_STARTED("capture.started"), APP_FOREGROUND("app.foreground"), APP_BACKGROUND("app.background"),
  ENGINE_START("engine.start"), ENGINE_SUSPEND("engine.suspend"), ENGINE_RESUME("engine.resume"),
  ENGINE_SHUTDOWN("engine.shutdown"), SECURE_STATE_RECOVERY("security.recover"),
  NETWORK_CHANGED("network.path_observed"), NETWORK_OBSERVATION("network.observation"), EXPORT_FLUSH("export.flush")
}

internal enum class NativeDiagnosticTrigger(val wire: String) {
  APP_STARTUP("appStartup"), APP_FOREGROUND("appForeground"), APP_BACKGROUND("appBackground"),
  USER_REQUEST("userRequest"), CONTEXT_DESTROYED("contextDestroyed"), NETWORK_CHANGE("networkChange"),
  EXPORT_REQUESTED("exportRequested"), UNSPECIFIED("unspecified")
}

internal enum class NativeDiagnosticOutcome(val wire: String) {
  OBSERVED("observed"), STARTED("started"), SUCCEEDED("succeeded"), FAILED("failed")
}

internal enum class NativeDiagnosticFailureReason(val wire: String) {
  ENGINE_FAILURE("engineFailure"), PERMISSION_DENIED("permissionDenied"),
  STORAGE_UNAVAILABLE("storageUnavailable"), NATIVE_FAILURE("nativeFailure")
}

internal data class NativeDiagnosticFailure(
  val reason: NativeDiagnosticFailureReason, val code: Long? = null, val retryable: Boolean? = null
)

internal data class NativeDiagnosticNetwork(
  val available: Boolean, val kind: Kind, val expensive: Boolean = false, val constrained: Boolean = false,
  val change: Change = Change.CAPABILITIES
) {
  enum class Change(val wire: String) { INITIAL("initial"), PATH_UPDATE("pathUpdate"), DEFAULT_NETWORK("defaultNetwork"), PROPERTIES("properties"), CAPABILITIES("capabilities") }
  enum class Kind(val wire: String) { WIFI("wifi"), CELLULAR("cellular"), WIRED("wired"), OTHER("other"), NONE("none") }
}

internal data class NativeDiagnosticOperation(
  val id: String, val event: NativeDiagnosticEvent, val trigger: NativeDiagnosticTrigger,
  val startedAt: Long, val generation: Long
)

/** Records only a closed event vocabulary: no caller-provided messages or attribute maps. */
internal class NativeRuntimeDiagnostics(
  private val directory: File?, private val appVersion: String = "unknown", private val appBuild: String = "unknown",
  private val maxFileBytes: Int = 256 * 1024, private val maxFiles: Int = 24
) : AutoCloseable {
  private val sessionId = UUID.randomUUID().toString()
  private val startedAt = Date()
  private val lock = Any()
  private val capacity = Semaphore(128)
  private val queue = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "uc-native-diagnostics").apply { isDaemon = true }
  }
  private var generation = 0L
  private var droppedRecords = 0L
  private var writeFailures = 0L
  private var prunedFiles = 0L
  private var writerReady = false
  private var fileIndex = 0
  private var fileBytes = 0

  init { record(NativeDiagnosticEvent.CAPTURE_STARTED, NativeDiagnosticTrigger.UNSPECIFIED) }

  fun begin(event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger): NativeDiagnosticOperation {
    val current = synchronized(lock) {
      if (event == NativeDiagnosticEvent.ENGINE_START) generation++
      generation
    }
    return NativeDiagnosticOperation(UUID.randomUUID().toString(), event, trigger, SystemClock.elapsedRealtime(), current)
      .also { enqueue(event, trigger, NativeDiagnosticOutcome.STARTED, it) }
  }

  fun finish(operation: NativeDiagnosticOperation, outcome: NativeDiagnosticOutcome, failure: NativeDiagnosticFailure? = null) {
    enqueue(operation.event, operation.trigger, outcome, operation, failure)
  }

  fun record(event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger,
             outcome: NativeDiagnosticOutcome = NativeDiagnosticOutcome.OBSERVED,
             failure: NativeDiagnosticFailure? = null, network: NativeDiagnosticNetwork? = null) {
    enqueue(event, trigger, outcome, failure = failure, network = network)
  }

  fun flush(deadlineMs: Long = 1000): Boolean {
    val completed = CountDownLatch(1)
    return try {
      queue.execute { completed.countDown() }
      completed.await(deadlineMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
    } catch (_: RejectedExecutionException) { false }
      catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
  }

  override fun close() { flush(); queue.shutdown() }

  fun exportSnapshot(): Map<String, Any?> {
    val completed = flush()
    val discovery = discovery()
    return mapOf(
      "flushStatus" to if (completed) "completed" else "incomplete",
      "writer" to snapshot(),
      "fileUris" to discovery.files.map { Uri.fromFile(it).toString() },
      "discoveryStatus" to discovery.status, "skippedFileCount" to discovery.skippedFiles
    )
  }

  fun snapshot(): Map<String, Any?> = synchronized(lock) {
    mapOf(
      "writerStatus" to if (writerReady) "ready" else "unavailable", "droppedRecords" to droppedRecords,
      "writeFailures" to writeFailures, "prunedFiles" to prunedFiles, "sessionId" to sessionId,
      "role" to "main", "startedAt" to timestamp(startedAt), "capturedAt" to timestamp(Date()),
      "policy" to "native-runtime-boundaries-v1", "effectiveLevel" to "info", "filteredRecordCount" to null,
      "retentionDays" to 3, "maxFileBytes" to maxFileBytes, "maxFiles" to maxFiles
    )
  }

  data class Discovery(val files: List<File>, val status: String, val skippedFiles: Int)

  fun files(): List<File> = discovery().files

  fun discovery(): Discovery {
    val candidates = directory?.listFiles() ?: return Discovery(emptyList(), "unavailable", 0)
    var skipped = 0
    val files = candidates.filter {
      if (!it.name.matches(Regex("native-runtime\\.(main|keyboard|share)\\.[0-9a-f-]{36}\\.[0-9]+\\.jsonl"))) return@filter false
      try {
        val regular = it.isFile && it.canonicalFile == File(it.parentFile.canonicalFile, it.name)
        if (!regular) skipped++
        regular
      } catch (_: Exception) { skipped++; false }
    }.sortedBy { it.name }
    return Discovery(files, if (skipped == 0) "completed" else "partial", skipped)
  }

  private fun enqueue(event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger, outcome: NativeDiagnosticOutcome,
                      operation: NativeDiagnosticOperation? = null, failure: NativeDiagnosticFailure? = null,
                      network: NativeDiagnosticNetwork? = null) {
    if (!capacity.tryAcquire()) { synchronized(lock) { droppedRecords++ }; return }
    val capturedAt = Date()
    val uptime = SystemClock.elapsedRealtime()
    val currentGeneration = operation?.generation ?: synchronized(lock) { generation }
    try {
      queue.execute {
        try {
          val root = directory ?: error("directory unavailable")
          check(root.isDirectory || root.mkdirs() || root.isDirectory)
          val health = snapshot()
          val record = JSONObject().apply {
            put("schemaVersion", 1); put("policy", "native-runtime-boundaries-v1")
            put("timestamp", timestamp(capturedAt)); put("monotonicMs", uptime)
            put("role", "main"); put("sessionId", sessionId); put("startAttempt", currentGeneration)
            put("processId", Process.myPid()); put("event", event.wire); put("trigger", trigger.wire)
            put("outcome", outcome.wire); put("level", if (outcome == NativeDiagnosticOutcome.FAILED) "ERROR" else "INFO"); put("appVersion", safeBuildValue(appVersion)); put("appBuild", safeBuildValue(appBuild))
            put("droppedRecords", health["droppedRecords"]); put("writeFailures", health["writeFailures"])
            put("prunedFiles", health["prunedFiles"])
            operation?.let {
              put("operationId", it.id)
              if (outcome != NativeDiagnosticOutcome.STARTED) put("durationMs", (uptime - it.startedAt).coerceAtLeast(0))
            }
            failure?.let {
              put("failure", JSONObject().put("reason", it.reason.wire).apply {
                it.code?.let { code -> put("code", code) }
                it.retryable?.let { retryable -> put("retryable", retryable) }
              })
            }
            network?.let {
              put("network", JSONObject().put("available", it.available).put("kind", it.kind.wire)
                .put("expensive", it.expensive).put("constrained", it.constrained).put("change", it.change.wire))
            }
          }
          val bytes = (record.toString() + "\n").toByteArray(Charsets.UTF_8)
          withDirectoryLock(root) {
            if (fileBytes > 0 && fileBytes + bytes.size > maxFileBytes) { fileIndex++; fileBytes = 0 }
            val file = File(root, "native-runtime.main.$sessionId.$fileIndex.jsonl")
            prune(file)
            file.appendBytes(bytes)
            fileBytes += bytes.size
            synchronized(lock) { writerReady = true }
          }
        } catch (_: Exception) {
          synchronized(lock) { droppedRecords++; writeFailures++; writerReady = false }
        } finally { capacity.release() }
      }
    } catch (_: RejectedExecutionException) {
      capacity.release()
      synchronized(lock) { droppedRecords++ }
    }
  }

  private fun prune(current: File) {
    val cutoff = System.currentTimeMillis() - 3 * 24 * 60 * 60 * 1000L
    val discovery = discovery()
    check(discovery.status != "unavailable")
    val candidates = discovery.files.sortedBy { it.lastModified() }
    var remaining = candidates.size + discovery.skippedFiles + if (current in candidates) 0 else 1
    candidates.filter { it != current }.forEach {
      if (it.lastModified() < cutoff || remaining > maxFiles) {
        check(it.delete())
        remaining--
        synchronized(lock) { prunedFiles++ }
      }
    }
    check(remaining <= maxFiles)
  }

  private fun withDirectoryLock(root: File, operation: () -> Unit) {
    RandomAccessFile(File(root, ".native-runtime.lock"), "rw").use { file ->
      var held: FileLock? = null
      val deadline = SystemClock.elapsedRealtime() + 100
      while (held == null) {
        held = try { file.channel.tryLock() } catch (_: OverlappingFileLockException) { null }
        if (held == null) {
          check(SystemClock.elapsedRealtime() < deadline)
          Thread.sleep(1)
        }
      }
      try { operation() } finally { held.release() }
    }
  }

  private fun timestamp(date: Date): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(date)

  private fun safeBuildValue(value: String): String =
    value.takeIf { it.matches(Regex("[0-9A-Za-z.+-]{1,80}")) } ?: "unknown"
}
