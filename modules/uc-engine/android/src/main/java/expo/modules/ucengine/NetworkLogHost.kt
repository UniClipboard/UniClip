package expo.modules.ucengine

import android.content.Context
import uniffi.uc_engine_uniffi.BindingNetworkLogConfig
import uniffi.uc_engine_uniffi.BindingNetworkLogException
import uniffi.uc_engine_uniffi.BindingNetworkLogExportReport
import uniffi.uc_engine_uniffi.BindingNetworkLogState
import uniffi.uc_engine_uniffi.BindingNetworkLogStatus
import uniffi.uc_engine_uniffi.BindingNetworkProcessRole
import uniffi.uc_engine_uniffi.BindingObservabilitySignalResult
import uniffi.uc_engine_uniffi.configureNetworkLog
import uniffi.uc_engine_uniffi.prepareNetworkLogExport
import uniffi.uc_engine_uniffi.queryNetworkLogStatus
import uniffi.uc_engine_uniffi.startNetworkCapture
import uniffi.uc_engine_uniffi.stopNetworkCapture
import java.io.File

/**
 * Native host side of the Engine's independent network-library log.
 *
 * The network log has its own configuration, state, control and export source. Nothing here is
 * reached from, or fails, the business-log install: a configuration problem only changes what
 * [status] reports.
 */
internal object NetworkLogHost {
  /** Result of the pre-install configuration step in this process. */
  sealed class Configuration(val wire: String) {
    object NotAttempted : Configuration("notAttempted")
    /** No budget was supplied for this build, so the Engine runs without a network log. */
    object NotConfigured : Configuration("notConfigured")
    class Configured(role: String) : Configuration("configured:$role")
    class Rejected(reason: String) : Configuration("rejected:$reason")
  }

  private val lock = Any()
  private var configuration: Configuration = Configuration.NotAttempted

  fun configurationSnapshot(): Configuration = synchronized(lock) { configuration }

  /**
   * Release and debug builds use the same budget: 8 KiB per record, 1,024 queued records, 4 MiB per
   * file, 16 MiB per run, 64 MiB for the root, 7 days. These are the recommended values from the
   * network-log proposal, adopted because release builds need the log; change them here only.
   */
  internal fun budget(role: BindingNetworkProcessRole): BindingNetworkLogConfig = BindingNetworkLogConfig(
    role = role, recordBytes = 8u * 1024u, queueRecords = 1_024u,
    fileBytes = 4uL * 1024uL * 1024uL, runBytes = 16uL * 1024uL * 1024uL,
    rootBytes = 64uL * 1024uL * 1024uL, retentionSeconds = 7uL * 24uL * 60uL * 60uL
  )

  /**
   * Must run before `installProcessObservability` in every process that hosts an Engine. The role
   * of an Android process is fixed by whichever start installs first: a start without a JS runtime
   * (service recovery, boot) is the background service, everything else is the app.
   * `explicit` replaces the build's budget; it exists for real-process verification.
   */
  fun configureBeforeInstall(role: BindingNetworkProcessRole, explicit: BindingNetworkLogConfig? = null): Configuration {
    val config = explicit ?: budget(role)
    val outcome: Configuration = run {
      try {
        configureNetworkLog(config)
        Configuration.Configured(roleName(config.role))
      } catch (error: BindingNetworkLogException.AlreadyInstalled) {
        // The process subscriber is already installed (diagnostics and engine start both pass
        // through here); the first outcome stays authoritative for this process. Nothing
        // configured before the install means the call order was violated: say so.
        return synchronized(lock) {
          if (configuration === Configuration.NotAttempted) configuration = Configuration.Rejected("alreadyInstalled")
          configuration
        }
      } catch (error: BindingNetworkLogException) {
        Configuration.Rejected(errorName(error))
      }
    }
    synchronized(lock) { configuration = outcome }
    return outcome
  }

  // Control

  fun status(): Map<String, Any?> = attempt { ok(map(queryNetworkLogStatus())) }

  fun startCapture(durationMs: Long): Map<String, Any?> = attempt {
    require(durationMs >= 0) { "duration" }
    val capture = startNetworkCapture(durationMs.toULong())
    ok(mapOf(
      "captureId" to capture.captureId, "startedAtUtc" to capture.startedAtUtc,
      "durationMs" to capture.durationMs.toDouble(), "alreadyActive" to capture.alreadyActive
    ))
  }

  fun stopCapture(captureId: String): Map<String, Any?> = attempt { stopNetworkCapture(captureId); ok(emptyMap()) }

  // Export

  /**
   * Flushes this process's network log, then stages the allowlisted files of every run found
   * under the network log root. Other processes are not flushed.
   */
  fun prepareExport(context: Context, deadlineMs: Long): Map<String, Any?> {
    var engineReport: BindingNetworkLogExportReport? = null
    var engineError: String? = null
    try {
      engineReport = prepareNetworkLogExport(deadlineMs.toULong())
    } catch (error: BindingNetworkLogException) {
      engineError = errorName(error)
    } catch (error: Exception) {
      engineError = "internal"
    }
    val currentRun = engineReport?.let { File(it.runDirectory) }
    // The Engine's own report names the root; filesDir is the fallback when it is not installed.
    val root = currentRun?.parentFile?.parentFile ?: networkRoot(context)
    val engine = engineReport?.let(::mapReport)
    val base = mutableMapOf<String, Any?>("engine" to engine, "engineError" to engineError, "flushScope" to "currentProcessOnly")
    if (!root.isDirectory) {
      return ok(base + mapOf(
        "rootAvailable" to false, "exportId" to null, "files" to emptyList<Any>(),
        "discoveredRunCount" to 0, "skippedEntryCount" to 0, "unreadableFileCount" to 0
      ))
    }
    return try {
      val staged = NetworkLogExportStaging.stage(
        root, currentRun,
        engineReport?.files?.map { NetworkLogEngineFile(it.name, it.bytes.toLong(), it.sha256) }.orEmpty(),
        stagingRoot(context)
      )
      ok(base + mapOf(
        "rootAvailable" to true, "exportId" to staged.exportId, "files" to staged.files.map(::mapStaged),
        "discoveredRunCount" to staged.discoveredRunCount, "skippedEntryCount" to staged.skippedEntryCount,
        "unreadableFileCount" to staged.unreadableFileCount
      ))
    } catch (error: Exception) {
      mapOf("ok" to false, "error" to "stagingFailed")
    }
  }

  fun releaseExport(context: Context, exportId: String) = NetworkLogExportStaging.release(exportId, stagingRoot(context))

  // Mapping

  /** Matches `AndroidEngineHost.privateDataDirectory()` plus the Engine's `logs/network`. */
  internal fun networkRoot(context: Context): File = File(context.filesDir, "uc-engine/logs/network")

  private fun stagingRoot(context: Context): File = File(context.cacheDir, "uc-network-log-export")

  private fun ok(value: Map<String, Any?>): Map<String, Any?> = mapOf("ok" to true, "value" to value)

  private inline fun attempt(block: () -> Map<String, Any?>): Map<String, Any?> = try {
    block()
  } catch (error: BindingNetworkLogException) {
    mapOf("ok" to false, "error" to errorName(error), "configuration" to configurationSnapshot().wire)
  } catch (error: IllegalArgumentException) {
    mapOf("ok" to false, "error" to "invalidDuration", "configuration" to configurationSnapshot().wire)
  } catch (error: Exception) {
    mapOf("ok" to false, "error" to "internal", "configuration" to configurationSnapshot().wire)
  }

  internal fun errorName(error: BindingNetworkLogException): String = when (error) {
    is BindingNetworkLogException.AlreadyInstalled -> "alreadyInstalled"
    is BindingNetworkLogException.InvalidConfig -> "invalidConfig"
    is BindingNetworkLogException.NotInstalled -> "notInstalled"
    is BindingNetworkLogException.NotConfigured -> "notConfigured"
    is BindingNetworkLogException.InvalidDuration -> "invalidDuration"
    is BindingNetworkLogException.CaptureMismatch -> "captureMismatch"
    is BindingNetworkLogException.AlreadyShutdown -> "alreadyShutdown"
    is BindingNetworkLogException.InvalidDeadline -> "invalidDeadline"
  }

  internal fun roleName(role: BindingNetworkProcessRole): String = when (role) {
    BindingNetworkProcessRole.DAEMON -> "daemon"
    BindingNetworkProcessRole.MOBILE_APP -> "mobile_app"
    BindingNetworkProcessRole.KEYBOARD_EXTENSION -> "keyboard_extension"
    BindingNetworkProcessRole.SHARE_EXTENSION -> "share_extension"
    BindingNetworkProcessRole.BACKGROUND_SERVICE -> "background_service"
  }

  private fun map(status: BindingNetworkLogStatus): Map<String, Any?> {
    val counters = status.counters
    return mapOf(
      "schemaVersion" to status.schemaVersion.toDouble(),
      "state" to when (status.state) {
        BindingNetworkLogState.STARTING -> "starting"
        BindingNetworkLogState.READY -> "ready"
        BindingNetworkLogState.UNAVAILABLE -> "unavailable"
        BindingNetworkLogState.CLOSED -> "closed"
      },
      "runId" to status.runId, "role" to roleName(status.role),
      "mode" to status.mode.name.lowercase(java.util.Locale.ROOT),
      "detailedRemainingMs" to status.detailedRemainingMs?.toDouble(),
      "counters" to mapOf(
        "accepted" to counters.accepted.toDouble(), "written" to counters.written.toDouble(),
        "policyFiltered" to counters.policyFiltered.toDouble(), "rateLimited" to counters.rateLimited.toDouble(),
        "oversized" to counters.oversized.toDouble(), "queueDropped" to counters.queueDropped.toDouble(),
        "closedDropped" to counters.closedDropped.toDouble(), "writeFailed" to counters.writeFailed.toDouble(),
        "rotatedOutFiles" to counters.rotatedOutFiles.toDouble(), "pathRecovered" to counters.pathRecovered.toDouble(),
        "unreviewedCallsites" to counters.unreviewedCallsites.toDouble()
      ),
      "libraries" to status.libraries.map {
        mapOf(
          "library" to it.library, "versionDir" to it.versionDir,
          "approvedRules" to it.approvedRules.toDouble(), "observedRecords" to it.observedRecords.toDouble()
        )
      },
      "sampledAtUtc" to status.sampledAtUtc
    )
  }

  private fun mapReport(report: BindingNetworkLogExportReport): Map<String, Any?> = mapOf(
    "flush" to when (report.flush) {
      BindingObservabilitySignalResult.COMPLETED -> "completed"
      BindingObservabilitySignalResult.FAILED -> "failed"
      BindingObservabilitySignalResult.TIMED_OUT -> "timedOut"
      BindingObservabilitySignalResult.ALREADY_SHUTDOWN -> "alreadyShutdown"
    },
    "status" to map(report.status), "requestedAtUtc" to report.requestedAtUtc,
    "completedAtUtc" to report.completedAtUtc, "otherProcessesFlushed" to report.otherProcessesFlushed,
    "files" to report.files.map { mapOf("name" to it.name, "bytes" to it.bytes.toDouble(), "sha256" to it.sha256) }
  )

  private fun mapStaged(file: NetworkLogStagedFile): Map<String, Any?> = mapOf(
    "role" to file.role, "runId" to file.runId, "name" to file.name,
    "bytes" to file.bytes.toDouble(), "sha256" to file.sha256,
    "uri" to File(file.stagedPath).toURI().toString(),
    "isCurrentRun" to file.isCurrentRun, "engineCheck" to file.engineCheck.wire
  )
}
