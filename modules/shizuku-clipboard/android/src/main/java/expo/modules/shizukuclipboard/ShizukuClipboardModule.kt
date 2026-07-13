package expo.modules.shizukuclipboard

import android.content.ComponentName
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ShizukuClipboardModule : Module() {
    companion object {
        private const val REQUEST_CODE_PERMISSION = 10086
        private const val POLL_INTERVAL_MS = 500L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val callerToken = Binder()
    private var clipboardService: IClipboardUserService? = null
    private var connectionLatch = CountDownLatch(1)
    private var binding = false
    private var monitoring = false
    private var lastSnapshot = ""

    private val userServiceArgs by lazy {
        Shizuku.UserServiceArgs(
            ComponentName(
                appContext.reactContext?.packageName ?: "app.uniclipboard.android",
                ClipboardUserService::class.java.name
            )
        )
            .daemon(false)
            .processNameSuffix("clipboard")
            .debuggable(BuildConfig.DEBUG)
            .version(2)
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            binding = false
            clipboardService = binder?.let(IClipboardUserService.Stub::asInterface)
            try {
                clipboardService?.init(callerToken)
            } catch (_: Exception) {
            }
            connectionLatch.countDown()
            emitState("connected")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            binding = false
            clipboardService = null
            emitState("disconnected")
        }
    }

    private val permissionListener = Shizuku.OnRequestPermissionResultListener { requestCode, result ->
        if (requestCode == REQUEST_CODE_PERMISSION) {
            if (result == PackageManager.PERMISSION_GRANTED) bindUserService()
            emitState(if (result == PackageManager.PERMISSION_GRANTED) "authorized" else "denied")
        }
    }

    private val binderReceivedListener = Shizuku.OnBinderReceivedListener {
        if (hasPermission()) bindUserService()
        emitState("available")
    }

    private val binderDeadListener = Shizuku.OnBinderDeadListener {
        clipboardService = null
        binding = false
        emitState("unavailable")
    }

    private val pollRunnable = object : Runnable {
        override fun run() {
            if (!monitoring) return
            val snapshot = try {
                clipboardService?.primaryClipJson.orEmpty()
            } catch (_: Exception) {
                ""
            }
            if (snapshot.isNotEmpty() && snapshot != lastSnapshot) {
                lastSnapshot = snapshot
                sendSnapshot(snapshot)
            }
            mainHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    override fun definition() = ModuleDefinition {
        Name("ShizukuClipboardModule")
        Events("onClipboardChange", "onShizukuStateChange")

        OnCreate {
            Shizuku.addRequestPermissionResultListener(permissionListener)
            Shizuku.addBinderReceivedListenerSticky(binderReceivedListener)
            Shizuku.addBinderDeadListener(binderDeadListener)
        }

        OnDestroy {
            stopMonitoring()
            unbindUserService()
            Shizuku.removeRequestPermissionResultListener(permissionListener)
            Shizuku.removeBinderReceivedListener(binderReceivedListener)
            Shizuku.removeBinderDeadListener(binderDeadListener)
        }

        Function("isShizukuAvailable") { isAvailable() }
        Function("hasShizukuPermission") { hasPermission() }
        Function("isBackgroundClipboardRestricted") { isBackgroundClipboardRestricted() }
        Function("requestShizukuPermission") {
            if (!isAvailable() || Shizuku.isPreV11()) return@Function false
            Shizuku.requestPermission(REQUEST_CODE_PERMISSION)
            true
        }

        AsyncFunction("startClipboardMonitor") { promise: Promise ->
            val service = ensureConnected()
            if (service == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            lastSnapshot = try { service.primaryClipJson.orEmpty() } catch (_: Exception) { "" }
            monitoring = true
            mainHandler.removeCallbacks(pollRunnable)
            mainHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
            promise.resolve(true)
        }

        AsyncFunction("stopClipboardMonitor") { promise: Promise ->
            stopMonitoring()
            promise.resolve(true)
        }

        AsyncFunction("getStringViaShizuku") { promise: Promise ->
            val snapshot = snapshotJson()
            promise.resolve(if (snapshot.optString("type") == "text") snapshot.optString("content") else "")
        }

        AsyncFunction("hasStringViaShizuku") { promise: Promise ->
            promise.resolve(snapshotJson().optString("type") == "text")
        }

        AsyncFunction("hasImageViaShizuku") { promise: Promise ->
            promise.resolve(snapshotJson().optString("type") == "image")
        }

        AsyncFunction("saveImageToFileViaShizuku") { destDirPath: String, promise: Promise ->
            val service = ensureConnected()
            if (service == null) {
                promise.resolve(null)
                return@AsyncFunction
            }
            val snapshot = snapshotJson()
            if (snapshot.optString("type") != "image") {
                promise.resolve(null)
                return@AsyncFunction
            }
            val mimeType = snapshot.optString("mimeType", "image/png")
            val extension = when {
                mimeType.contains("jpeg") || mimeType.contains("jpg") -> "jpg"
                mimeType.contains("gif") -> "gif"
                mimeType.contains("webp") -> "webp"
                else -> "png"
            }
            val dir = File(destDirPath.removePrefix("file://"))
            dir.mkdirs()
            val file = File(dir, "clipboard_${UUID.randomUUID()}.$extension")
            val descriptor = ParcelFileDescriptor.open(
                file,
                ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or
                    ParcelFileDescriptor.MODE_READ_WRITE
            )
            val copied = try { service.copyPrimaryClipToFile(descriptor) } catch (_: Exception) { false }
            descriptor.close()
            if (!copied) {
                file.delete()
                promise.resolve(null)
            } else {
                promise.resolve(mapOf("filePath" to "file://${file.absolutePath}", "mimeType" to mimeType))
            }
        }

        AsyncFunction("setStringViaShizuku") { text: String, promise: Promise ->
            val service = ensureConnected()
            promise.resolve(try { service?.setPrimaryClipText(text) == true } catch (_: Exception) { false })
        }
    }

    private fun isAvailable(): Boolean = try { Shizuku.pingBinder() } catch (_: Exception) { false }

    private fun hasPermission(): Boolean = try {
        isAvailable() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (_: Exception) {
        false
    }

    private fun isBackgroundClipboardRestricted(): Boolean {
        return try {
            val developmentMiui =
                Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true) &&
                    Build.VERSION.INCREMENTAL.endsWith(".DEV", ignoreCase = true)
            if (!developmentMiui) return false
            val context = appContext.reactContext ?: return false
            Settings.Secure.getInt(
                context.contentResolver,
                "mi_lab_ai_clipboard_enable",
                1
            ) == 1
        } catch (_: Exception) {
            false
        }
    }

    private fun bindUserService() {
        if (clipboardService != null || binding || !hasPermission()) return
        binding = true
        connectionLatch = CountDownLatch(1)
        try {
            Shizuku.bindUserService(userServiceArgs, serviceConnection)
        } catch (_: Exception) {
            binding = false
            connectionLatch.countDown()
        }
    }

    private fun ensureConnected(): IClipboardUserService? {
        clipboardService?.let { return it }
        bindUserService()
        try { connectionLatch.await(3, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
        return clipboardService
    }

    private fun unbindUserService() {
        if (clipboardService == null && !binding) return
        try { Shizuku.unbindUserService(userServiceArgs, serviceConnection, true) } catch (_: Exception) {}
        clipboardService = null
        binding = false
    }

    private fun stopMonitoring() {
        monitoring = false
        mainHandler.removeCallbacks(pollRunnable)
        lastSnapshot = ""
    }

    private fun snapshotJson(): JSONObject {
        val json = try { ensureConnected()?.primaryClipJson.orEmpty() } catch (_: Exception) { "" }
        return if (json.isEmpty()) JSONObject() else try { JSONObject(json) } catch (_: Exception) { JSONObject() }
    }

    private fun sendSnapshot(json: String) {
        try {
            val snapshot = JSONObject(json)
            sendEvent(
                "onClipboardChange",
                mapOf(
                    "type" to snapshot.optString("type"),
                    "content" to snapshot.optString("content"),
                    "mimeType" to snapshot.optString("mimeType"),
                    "displayName" to snapshot.optString("displayName")
                )
            )
        } catch (_: Exception) {
        }
    }

    private fun emitState(state: String) {
        sendEvent("onShizukuStateChange", mapOf("type" to state, "content" to ""))
    }
}
