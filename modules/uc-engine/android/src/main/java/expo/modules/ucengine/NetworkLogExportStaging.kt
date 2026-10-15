package expo.modules.ucengine

import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** How a staged copy relates to the file list the Engine reported when it flushed. */
internal enum class NetworkLogEngineCheck(val wire: String) {
  /** The staged bytes hash to exactly what the Engine reported. */
  EXACT("exact"),
  /** The first reported bytes hash to the reported value; the writer appended afterwards. */
  APPENDED_AFTER_SNAPSHOT("appendedAfterSnapshot"),
  /** The reported prefix does not hash to the reported value, or the file is shorter than reported. */
  MISMATCH("mismatch"),
  /** The Engine did not list this file (another run, or no flush happened). */
  NOT_REPORTED("notReported")
}

internal data class NetworkLogEngineFile(val name: String, val bytes: Long, val sha256: String)

internal data class NetworkLogStagedFile(
  val role: String,
  val runId: String,
  val name: String,
  val bytes: Long,
  val sha256: String,
  val stagedPath: String,
  val isCurrentRun: Boolean,
  val engineCheck: NetworkLogEngineCheck
)

internal data class NetworkLogStagedExport(
  val exportId: String,
  val files: List<NetworkLogStagedFile>,
  /** Run directories that were found, whether or not any file could be staged. */
  val discoveredRunCount: Int,
  /** Entries that are not part of the export contract (lease locks, foreign files, links). */
  val skippedEntryCount: Int,
  val unreadableFileCount: Int
)

/**
 * Copies only the allowlisted files of `<root>/<role>/<run>/` into a private staging directory.
 *
 * A recursive copy of the network directory would carry the active-writer `lease.lock`, the root
 * `.cleanup.lock` and any unexpected file into the diagnostic package. Staging also gives the
 * exporter a stable snapshot: the live writer keeps appending while the package is built.
 */
internal object NetworkLogExportStaging {
  private const val MANIFEST_NAME = "run.json"
  private const val STALE_AFTER_MS = 3_600_000L

  private fun isSafeComponent(value: String): Boolean =
    value.isNotEmpty() && value.length <= 64 && value.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' || it == '-' }

  /** `network.<8 digit UTC date>.<3 or more digit sequence>.jsonl`, or the run manifest. */
  fun isExportableName(name: String): Boolean {
    if (name == MANIFEST_NAME) return true
    val parts = name.split('.')
    if (parts.size != 4 || parts[0] != "network" || parts[3] != "jsonl") return false
    val date = parts[1]
    val sequence = parts[2]
    return date.length == 8 && date.all { it in '0'..'9' } && sequence.length >= 3 && sequence.all { it in '0'..'9' }
  }

  private fun isPlain(file: File, parent: File): Boolean =
    runCatching { file.canonicalFile == File(parent.canonicalFile, file.name) }.getOrDefault(false)

  private fun subdirectories(directory: File, skipped: () -> Unit): List<File> =
    directory.listFiles().orEmpty().sortedBy { it.name }.filter {
      val usable = it.isDirectory && isPlain(it, directory)
      if (!usable) skipped()
      usable
    }

  fun stage(
    root: File,
    currentRunDirectory: File?,
    engineFiles: List<NetworkLogEngineFile>,
    stagingRoot: File
  ): NetworkLogStagedExport {
    pruneStale(stagingRoot)
    val exportId = UUID.randomUUID().toString()
    val directory = File(stagingRoot, exportId)
    check(directory.mkdirs()) { "staging directory unavailable" }
    val reported = engineFiles.associateBy { it.name }
    val currentPath = currentRunDirectory?.let { runCatching { it.canonicalPath }.getOrNull() }

    val files = mutableListOf<NetworkLogStagedFile>()
    var runCount = 0
    var skipped = 0
    var unreadable = 0
    for (role in subdirectories(root) { skipped += 1 }) {
      if (!isSafeComponent(role.name)) { skipped += 1; continue }
      for (run in subdirectories(role) { skipped += 1 }) {
        if (!isSafeComponent(run.name)) { skipped += 1; continue }
        runCount += 1
        val isCurrent = runCatching { run.canonicalPath }.getOrNull() == currentPath
        for (entry in run.listFiles().orEmpty().sortedBy { it.name }) {
          if (!isExportableName(entry.name) || !entry.isFile || !isPlain(entry, run)) {
            skipped += 1
            continue
          }
          val target = File(directory, "${role.name}__${run.name}__${entry.name}")
          try {
            val copy = copyHashing(entry, target, if (isCurrent) reported[entry.name] else null)
            files += NetworkLogStagedFile(role.name, run.name, entry.name, copy.bytes, copy.sha256, target.absolutePath, isCurrent, copy.check)
          } catch (error: Exception) {
            target.delete()
            unreadable += 1
          }
        }
      }
    }
    return NetworkLogStagedExport(exportId, files, runCount, skipped, unreadable)
  }

  fun release(exportId: String, stagingRoot: File) {
    val parsed = runCatching { UUID.fromString(exportId) }.getOrNull() ?: return
    File(stagingRoot, parsed.toString()).deleteRecursively()
  }

  /** A package that was never released (the process was killed mid-export) must not leak logs. */
  fun pruneStale(stagingRoot: File, nowMs: Long = System.currentTimeMillis()) {
    stagingRoot.listFiles().orEmpty().forEach { if (nowMs - it.lastModified() > STALE_AFTER_MS) it.deleteRecursively() }
  }

  private fun hex(digest: MessageDigest): String = digest.digest().joinToString("") { "%02x".format(it) }

  private class Copy(val bytes: Long, val sha256: String, val check: NetworkLogEngineCheck)

  private fun copyHashing(source: File, target: File, reported: NetworkLogEngineFile?): Copy {
    val hasher = MessageDigest.getInstance("SHA-256")
    var total = 0L
    var prefixDigest: String? = if (reported != null && reported.bytes == 0L) hex(hasher.clone() as MessageDigest) else null
    val buffer = ByteArray(64 * 1024)
    source.inputStream().use { input ->
      target.outputStream().use { output ->
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (reported != null && prefixDigest == null && total + read >= reported.bytes) {
            val head = (reported.bytes - total).toInt()
            val prefix = hasher.clone() as MessageDigest
            prefix.update(buffer, 0, head)
            prefixDigest = hex(prefix)
          }
          hasher.update(buffer, 0, read)
          total += read
          output.write(buffer, 0, read)
        }
      }
    }
    val digest = hex(hasher)
    val check = when {
      reported == null -> NetworkLogEngineCheck.NOT_REPORTED
      total == reported.bytes && digest == reported.sha256 -> NetworkLogEngineCheck.EXACT
      total > reported.bytes && prefixDigest == reported.sha256 -> NetworkLogEngineCheck.APPENDED_AFTER_SNAPSHOT
      else -> NetworkLogEngineCheck.MISMATCH
    }
    return Copy(total, digest, check)
  }
}
