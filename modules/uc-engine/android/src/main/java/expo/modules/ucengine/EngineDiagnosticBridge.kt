package expo.modules.ucengine

import uniffi.uc_engine_uniffi.*
import java.util.Locale

internal object EngineDiagnosticBridge {
  fun register() { runCatching { registerHostDiagnosticSource(BindingHostDiagnosticSource.APPLICATION, BindingSourceCapability.PARTIAL) } }
  fun record(event: BindingHostDiagnosticEvent) { runCatching { recordHostDiagnostic(BindingHostDiagnosticSource.APPLICATION, event) } }
  fun begin(action: BindingHostDiagnosticAction): String? = runCatching {
    recordHostDiagnostic(BindingHostDiagnosticSource.APPLICATION, BindingHostDiagnosticEvent.Begin(action)).token
  }.getOrNull()
  fun finish(token: String?, succeeded: Boolean) {
    if (token == null) return
    record(BindingHostDiagnosticEvent.Finish(token, if (succeeded) BindingHostDiagnosticOutcome.Completed else BindingHostDiagnosticOutcome.Failed(BindingHostDiagnosticFailure.UNKNOWN)))
  }
  fun <T> observe(action: BindingHostDiagnosticAction, operation: () -> T): T {
    val token = begin(action)
    return try { operation().also { finish(token, true) } } catch (error: Throwable) { finish(token, false); throw error }
  }

  private fun name(value: Enum<*>): String = value.name.lowercase(Locale.ROOT).split("_").let { parts -> parts.first() + parts.drop(1).joinToString("") { it.replaceFirstChar(Char::uppercaseChar) } }
  fun map(value: BindingStopCaptureResult): String = name(value)
  fun map(value: BindingLocalCaptureStatus): Map<String, Any?> = mapOf(
    "mode" to name(value.mode),
    "captureId" to value.captureId,
    "remainingMs" to value.remainingMs.toDouble(),
    "startedAtUtc" to value.startedAtUtc,
    "endReason" to value.endReason?.let { name(it) },
    "lastCaptureId" to value.lastCaptureId,
    "revision" to value.revision.toDouble(),
  )
  fun map(value: BindingSourceCoverage): Map<String, Any?> = mapOf(
    "source" to name(value.source),
    "capability" to name(value.capability),
    "collection" to name(value.collection),
    "observedCount" to value.observedCount.toDouble(),
    "policyFilteredCount" to value.policyFilteredCount.toDouble(),
  )
  fun map(value: BindingFileSourceCounts): Map<String, Any?> = mapOf(
    "source" to name(value.source),
    "acceptedCount" to value.acceptedCount.toDouble(),
    "writtenCount" to value.writtenCount.toDouble(),
    "queueDroppedCount" to value.queueDroppedCount.toDouble(),
    "quotaDroppedCount" to value.quotaDroppedCount.toDouble(),
    "writeFailedCount" to value.writeFailedCount.toDouble(),
    "lastWrittenAtMs" to value.lastWrittenAtMs?.toDouble(),
  )
  fun map(value: BindingLocalDiagnosticStatus): Map<String, Any?> = mapOf(
    "runId" to value.runId,
    "capture" to map(value.capture),
    "observedRecords" to value.observedRecords.toDouble(),
    "policyFilteredRecords" to value.policyFilteredRecords.toDouble(),
    "schemaRejectedRecords" to value.schemaRejectedRecords.toDouble(),
    "correlationLimitedRecords" to value.correlationLimitedRecords.toDouble(),
    "engineVersion" to value.engineVersion,
    "sourceCommit" to value.sourceCommit,
    "counterScope" to value.counterScope,
    "sources" to value.sources.map { map(it) },
    "localFile" to name(value.localFile),
    "closed" to value.closed,
  )
  fun map(value: BindingLocalDiagnosticExportReport): Map<String, Any?> = mapOf(
    "flush" to name(value.flush),
    "status" to map(value.status),
    "requestedAtUtc" to value.requestedAtUtc,
    "completedAtUtc" to value.completedAtUtc,
    "otherProcessesFlushed" to value.otherProcessesFlushed,
    "files" to value.files.map { map(it) },
  )
}
