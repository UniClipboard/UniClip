package expo.modules.clipboardoverlay

import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/** Owns the blocking log reader, not a clipboard polling timer. Callbacks must not block. */
internal class ClipboardLogMonitor(
    private val packageName: String,
    private val onTrigger: (Long) -> Unit,
    private val onStatus: (Status) -> Unit,
    private val spawn: () -> Process = {
        val since = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
        ProcessBuilder("logcat", "-T", since, "ClipboardService:E", "*:S").start()
    },
    private val retryDelaysMs: List<Long> = listOf(1_000, 5_000, 15_000),
) {
    data class Status(
        val state: String = "stopped",
        val generation: Long = 0,
        val attempt: Int = 0,
        val lastEventAtMs: Long? = null,
        val reason: String? = null,
        val exitCode: Int? = null,
        val detail: String? = null,
        val retryInMs: Long? = null,
    ) {
        fun toMap(): Map<String, Any?> = mapOf(
            "state" to state, "generation" to generation, "attempt" to attempt,
            "lastEventAtMs" to lastEventAtMs, "reason" to reason, "exitCode" to exitCode,
            "detail" to detail, "retryInMs" to retryInMs,
        )
    }

    private class Session(val generation: Long) {
        var worker: Thread? = null
        var process: Process? = null
        var cancelled = false
    }

    private data class Failure(val reason: String, val exitCode: Int?, val detail: String)

    private val lock = Object()
    private var session: Session? = null
    private var generation = 0L
    private var status = Status()

    fun getStatus(): Status = synchronized(lock) { status }

    fun isActive(): Boolean = synchronized(lock) {
        val current = session ?: return@synchronized false
        current.worker?.isAlive == true && when (status.state) {
            "starting", "retrying" -> true
            "listening" -> current.process?.let(::isAlive) == true
            else -> false
        }
    }

    fun start() = synchronized(lock) {
        if (isActive()) return@synchronized
        cancelLocked()
        val current = Session(++generation)
        session = current
        publishLocked(Status(state = "starting", generation = current.generation, attempt = 1))
        current.worker = Thread({ run(current) }, "UniClip-logcat-${current.generation}").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() = synchronized(lock) {
        cancelLocked()
        publishLocked(Status(generation = generation))
    }

    private fun cancelLocked() {
        val old = session
        session = null
        old?.cancelled = true
        old?.process?.destroy()
        old?.worker?.interrupt()
        lock.notifyAll()
    }

    private fun owns(current: Session): Boolean = synchronized(lock) {
        session === current && !current.cancelled
    }

    private fun publishLocked(next: Status) {
        status = next
        onStatus(next)
    }

    private fun update(current: Session, transform: (Status) -> Status) = synchronized(lock) {
        if (session === current && !current.cancelled) publishLocked(transform(status))
    }

    private fun run(current: Session) {
        var retries = 0
        try {
            while (owns(current)) {
                val failure = readProcess(current) ?: return
                if (!owns(current)) return
                val permissionDenied = failure.detail.contains(
                    Regex("permission denied|operation not permitted|access (?:is )?denied", RegexOption.IGNORE_CASE)
                )
                if (permissionDenied || retries >= retryDelaysMs.size) {
                    update(current) { it.copy(
                        state = "failed", reason = if (permissionDenied) "access-denied" else failure.reason,
                        exitCode = failure.exitCode, detail = failure.detail, retryInMs = null,
                    ) }
                    return
                }
                val delay = retryDelaysMs[retries++]
                update(current) { it.copy(
                    state = "retrying", reason = failure.reason, exitCode = failure.exitCode,
                    detail = failure.detail, retryInMs = delay,
                ) }
                // Only wait after a failed reader. Healthy sessions block on readLine indefinitely.
                synchronized(lock) {
                    val deadline = System.nanoTime() + delay * 1_000_000
                    while (owns(current)) {
                        val remainingMs = (deadline - System.nanoTime()) / 1_000_000
                        if (remainingMs <= 0) break
                        lock.wait(remainingMs)
                    }
                }
                update(current) { it.copy(state = "starting", attempt = retries + 1, retryInMs = null) }
            }
        } catch (_: InterruptedException) {
            // stop()/a replacement session owns cancellation; never restart it from finally.
        } finally {
            synchronized(lock) {
                if (session === current && status.state != "failed" && !current.cancelled) {
                    publishLocked(status.copy(state = "failed", reason = "reader-interrupted", retryInMs = null))
                }
            }
        }
    }

    private fun readProcess(current: Session): Failure? {
        var process: Process? = null
        val stderr = AtomicReference("")
        var errorReader: Thread? = null
        try {
            process = spawn()
            synchronized(lock) {
                if (!owns(current)) {
                    process.destroy()
                    return null
                }
                current.process = process
            }
            val ownedProcess = process
            errorReader = Thread({
                stderr.set(readError(ownedProcess.errorStream))
            }, "UniClip-logcat-stderr-${current.generation}").apply { isDaemon = true; start() }
            update(current) { it.copy(state = "listening", reason = null, exitCode = null, detail = null) }
            var lastTrigger: Long? = null
            process.inputStream.bufferedReader().use { reader ->
                while (owns(current)) {
                    val line = reader.readLine() ?: break
                    if (!line.contains(packageName)) continue
                    val now = System.currentTimeMillis()
                    val previous = lastTrigger
                    if (previous != null && now - previous <= 1_000) continue
                    lastTrigger = now
                    update(current) { it.copy(lastEventAtMs = now) }
                    if (owns(current)) onTrigger(current.generation)
                }
            }
            if (!owns(current)) return null
            // An EOF also ends a process that closed stdout but did not exit itself.
            if (isAlive(process)) process.destroy()
            val exitCode = process.waitFor()
            errorReader.join(200)
            return Failure("process-exited", exitCode, stderr.get())
        } catch (error: InterruptedException) {
            throw error
        } catch (error: Exception) {
            return if (owns(current)) Failure(
                if (process == null) "start-failed" else "read-failed", null,
                "${error.javaClass.simpleName}: ${error.message.orEmpty()}".take(512),
            ) else null
        } finally {
            process?.destroy()
            errorReader?.interrupt()
            synchronized(lock) {
                if (current.process === process) current.process = null
            }
        }
    }

    private fun readError(input: InputStream): String {
        val text = StringBuilder()
        try {
            input.bufferedReader().use { reader ->
                val buffer = CharArray(256)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    if (text.length < 512) text.append(buffer, 0, minOf(count, 512 - text.length))
                }
            }
        } catch (_: Exception) {
            // The process may be deliberately destroyed while stderr is being drained.
        }
        // logcat stderr only: never retain system log lines or clipboard payloads.
        return text.toString().replace(Regex("[\\r\\n\\t]+"), " ").trim()
    }

    private fun isAlive(process: Process): Boolean = try {
        process.exitValue()
        false
    } catch (_: IllegalThreadStateException) {
        true
    }
}
