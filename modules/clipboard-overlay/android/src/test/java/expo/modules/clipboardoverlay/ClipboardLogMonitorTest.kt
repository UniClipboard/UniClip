package expo.modules.clipboardoverlay

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class ClipboardLogMonitorTest {
    private val packageName = "app.uniclipboard.android.test"

    @Test fun exitedReaderIsUnhealthyAndAnExplicitStartRepairsIt() {
        val calls = AtomicInteger()
        val failed = CountDownLatch(1)
        val listening = CountDownLatch(1)
        val triggered = CountDownLatch(1)
        val live = FakeProcess()
        val monitor = ClipboardLogMonitor(packageName, { triggered.countDown() }, {
            if (it.state == "failed") failed.countDown()
            if (it.state == "listening" && calls.get() == 2) listening.countDown()
        }, spawn = {
            if (calls.incrementAndGet() == 1) FakeProcess(exit = 9, error = "reader terminated") else live
        }, retryDelaysMs = emptyList())
        try {
            monitor.start()
            await(failed)
            assertFalse(monitor.isActive())
            assertEquals(9, monitor.getStatus().exitCode)
            assertEquals("reader terminated", monitor.getStatus().detail)

            monitor.start()
            await(listening)
            assertTrue(monitor.isActive())
            val generation = monitor.getStatus().generation
            monitor.start()
            assertEquals(2, calls.get())
            assertEquals(generation, monitor.getStatus().generation)
            live.pipe.line("ClipboardService: Denying clipboard access to $packageName")
            await(triggered)
            assertNotNull(monitor.getStatus().lastEventAtMs)
        } finally {
            monitor.stop()
        }
        assertFalse(monitor.isActive())
        assertEquals("stopped", monitor.getStatus().state)
    }

    @Test fun unexpectedEofAutomaticallyRestartsTheEventReader() {
        val calls = AtomicInteger()
        val recovered = CountDownLatch(1)
        val live = FakeProcess()
        val monitor = ClipboardLogMonitor(packageName, {}, {
            if (it.state == "listening" && it.attempt == 2) recovered.countDown()
        }, spawn = {
            if (calls.incrementAndGet() == 1) FakeProcess(exit = 1) else live
        }, retryDelaysMs = listOf(0))
        try {
            monitor.start()
            await(recovered)
            assertTrue(monitor.isActive())
            assertEquals(2, calls.get())
        } finally { monitor.stop() }
    }

    @Test fun repeatedFailuresExhaustABoundedRetryBudget() {
        val calls = AtomicInteger()
        val failed = CountDownLatch(1)
        val monitor = ClipboardLogMonitor(packageName, {}, {
            if (it.state == "failed") failed.countDown()
        }, spawn = {
            calls.incrementAndGet()
            FakeProcess(exit = 1)
        }, retryDelaysMs = listOf(0, 0))
        try {
            monitor.start()
            await(failed)
            assertEquals(3, calls.get())
            assertEquals(3, monitor.getStatus().attempt)
            assertFalse(monitor.isActive())
        } finally { monitor.stop() }
    }

    @Test fun explicitLogAccessDenialDoesNotRetryOrDiscardTheDiagnostic() {
        val calls = AtomicInteger()
        val failed = CountDownLatch(1)
        val monitor = ClipboardLogMonitor(packageName, {}, {
            if (it.state == "failed") failed.countDown()
        }, spawn = {
            calls.incrementAndGet()
            FakeProcess(exit = 1, error = "Permission denied: " + "x".repeat(1_000))
        }, retryDelaysMs = listOf(0, 0))
        try {
            monitor.start()
            await(failed)
            assertEquals(1, calls.get())
            assertEquals("access-denied", monitor.getStatus().reason)
            assertTrue(monitor.getStatus().detail!!.startsWith("Permission denied"))
            assertTrue(monitor.getStatus().detail!!.length <= 512)
        } finally { monitor.stop() }
    }

    @Test fun stopCancelsBackoffAndCannotStopTheNextSession() {
        val calls = AtomicInteger()
        val retrying = CountDownLatch(1)
        val recovered = CountDownLatch(1)
        val monitor = ClipboardLogMonitor(packageName, {}, {
            if (it.state == "retrying") retrying.countDown()
            if (it.state == "listening" && calls.get() == 2) recovered.countDown()
        }, spawn = {
            if (calls.incrementAndGet() == 1) FakeProcess(exit = 1) else FakeProcess()
        }, retryDelaysMs = listOf(60_000))
        try {
            monitor.start()
            await(retrying)
            monitor.stop()
            monitor.start()
            await(recovered)
            assertEquals(2, calls.get())
            assertTrue(monitor.isActive())
            assertEquals("listening", monitor.getStatus().state)
        } finally { monitor.stop() }
    }

    @Test fun aLateProcessFromAStoppedSessionCannotReplaceOrDestroyTheNewReader() {
        val calls = AtomicInteger()
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val oldDestroyed = CountDownLatch(1)
        val secondListening = CountDownLatch(1)
        val monitor = ClipboardLogMonitor(packageName, {}, {
            if (it.state == "listening" && it.generation == 2L) secondListening.countDown()
        }, spawn = {
            if (calls.incrementAndGet() == 1) {
                firstStarted.countDown()
                // ProcessBuilder can finish after cancellation has already been requested.
                while (true) {
                    try { releaseFirst.await(); break } catch (_: InterruptedException) { }
                }
                FakeProcess(onDestroy = { oldDestroyed.countDown() })
            } else FakeProcess()
        })
        try {
            monitor.start()
            await(firstStarted)
            monitor.stop()
            monitor.start()
            await(secondListening)
            releaseFirst.countDown()
            await(oldDestroyed)
            assertEquals(2L, monitor.getStatus().generation)
            assertEquals("listening", monitor.getStatus().state)
            assertTrue(monitor.isActive())
        } finally {
            releaseFirst.countDown()
            monitor.stop()
        }
    }

    private fun await(latch: CountDownLatch) {
        assertTrue("reader transition did not complete", latch.await(3, TimeUnit.SECONDS))
    }

    private class LogPipe : InputStream() {
        private val lock = Object()
        private val bytes = ArrayDeque<Int>()
        private var closed = false
        fun line(text: String) = synchronized(lock) {
            (text + "\n").toByteArray().forEach { bytes.add(it.toInt() and 0xff) }
            lock.notifyAll()
        }
        override fun read(): Int = synchronized(lock) {
            while (bytes.isEmpty() && !closed) lock.wait()
            if (bytes.isEmpty()) -1 else bytes.removeFirst()
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            val first = read()
            if (first < 0) return -1
            buffer[offset] = first.toByte()
            var count = 1
            synchronized(lock) {
                while (count < length && bytes.isNotEmpty()) {
                    buffer[offset + count++] = bytes.removeFirst().toByte()
                }
            }
            return count
        }
        override fun close() = synchronized(lock) { closed = true; lock.notifyAll() }
    }

    private class FakeProcess(
        exit: Int? = null,
        error: String = "",
        private val onDestroy: () -> Unit = {},
    ) : Process() {
        val pipe = LogPipe()
        private val lock = Object()
        private var code = exit
        private val errors = ByteArrayInputStream(error.toByteArray())
        init { if (exit != null) pipe.close() }
        override fun getInputStream() = pipe
        override fun getErrorStream() = errors
        override fun getOutputStream() = ByteArrayOutputStream()
        override fun waitFor(): Int = synchronized(lock) {
            while (code == null) lock.wait()
            code!!
        }
        override fun exitValue(): Int = synchronized(lock) {
            code ?: throw IllegalThreadStateException("still running")
        }
        override fun destroy() {
            synchronized(lock) { if (code == null) code = 143; lock.notifyAll() }
            pipe.close()
            onDestroy()
        }
    }
}
