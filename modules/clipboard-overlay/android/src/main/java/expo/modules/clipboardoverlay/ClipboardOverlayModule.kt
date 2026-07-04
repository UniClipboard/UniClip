package expo.modules.clipboardoverlay

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ClipboardOverlayModule : Module() {

    companion object {
        private const val RETRY_DELAY_MS = 10L  // Short interval like AutoJs6 to minimize focus steal time
        private const val DEFAULT_MAX_RETRIES = 5
        // Window focus is granted asynchronously by WM (observed 100-300ms on HyperOS),
        // far later than the RETRY_DELAY_MS*maxRetries window — so wait for the actual
        // onWindowFocusChanged callback before touching the clipboard.
        private const val FOCUS_WAIT_TIMEOUT_MS = 1000L
    }

    private var debugMode = false
    private var maxRetries = DEFAULT_MAX_RETRIES

    // Persistent overlay state
    private var persistentView: View? = null
    private var persistentWindowManager: WindowManager? = null
    private var persistentParams: WindowManager.LayoutParams? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    // Event-driven clipboard monitor state (ClipCascade-style trigger layer)
    private var clipboardManagerRef: ClipboardManager? = null
    private var clipChangedListener: ClipboardManager.OnPrimaryClipChangedListener? = null
    private var logcatThread: Thread? = null
    private var logcatProcess: Process? = null
    @Volatile private var stopLogcat = false
    private var isMonitoring = false
    // Debounce repeated logcat denial lines for a single copy event.
    private var lastTriggerTime = 0L
    private val triggerDebounceMs = 1000L
    // Dedup identical clipboard content across the foreground listener and the
    // overlay re-read triggered by the same copy (mirrors KDE Connect behavior).
    private var lastEmittedContent: String? = null

    override fun definition() = ModuleDefinition {
        Name("ClipboardOverlayModule")

        // Emitted whenever a clipboard change is observed, either in the foreground
        // (OnPrimaryClipChangedListener) or in the background (logcat-triggered
        // overlay read). Payload: { "type": "text|image|files", "content": String }.
        Events("onClipboardChange")

        OnDestroy {
            mainHandler.post { stopMonitorInternal() }
        }

        // Whether READ_LOGS is granted (only grantable via adb). Required for the
        // background logcat trigger; without it the monitor only works foreground.
        Function("hasReadLogsPermission") {
            val context = appContext.reactContext ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                context.checkSelfPermission(Manifest.permission.READ_LOGS) ==
                    PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
        }

        Function("isClipboardMonitoring") { isMonitoring }

        AsyncFunction("startClipboardMonitor") { promise: Promise ->
            mainHandler.post {
                try {
                    startMonitorInternal()
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERR_MONITOR_START", e.message ?: "Unknown error", e)
                }
            }
        }

        AsyncFunction("stopClipboardMonitor") { promise: Promise ->
            mainHandler.post {
                try {
                    stopMonitorInternal()
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERR_MONITOR_STOP", e.message ?: "Unknown error", e)
                }
            }
        }

        Function("setDebugMode") { enabled: Boolean ->
            debugMode = enabled
            // Update persistent overlay appearance if showing
            mainHandler.post { updatePersistentOverlayAppearance() }
            true
        }

        Function("setMaxRetries") { retries: Int ->
            maxRetries = retries.coerceIn(1, 50)
            true
        }

        Function("hasOverlayPermission") {
            val context = appContext.reactContext ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(context)
            } else {
                true
            }
        }

        Function("requestOverlayPermission") {
            val context = appContext.reactContext ?: return@Function false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
            true
        }

        Function("isOverlayShowing") {
            persistentView != null
        }

        AsyncFunction("showOverlayWindow") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.reject("ERR_NO_CONTEXT", "React context is null", null)
                return@AsyncFunction
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
                promise.reject("ERR_NO_PERMISSION", "Overlay permission not granted", null)
                return@AsyncFunction
            }
            mainHandler.post {
                try {
                    if (persistentView != null) {
                        // Already showing
                        promise.resolve(true)
                        return@post
                    }
                    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                    val view = View(context).apply {
                        isFocusable = true
                        isFocusableInTouchMode = true
                    }

                    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    } else {
                        @Suppress("DEPRECATION")
                        WindowManager.LayoutParams.TYPE_PHONE
                    }

                    val overlaySize = if (debugMode) 200 else 1

                    if (debugMode) {
                        view.setBackgroundColor(0xFFFF0000.toInt())
                    }

                    val params = WindowManager.LayoutParams(
                        overlaySize, overlaySize,
                        layoutType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                        PixelFormat.TRANSLUCENT
                    ).apply {
                        alpha = if (debugMode) 0.7f else 0f
                        gravity = Gravity.START or Gravity.TOP
                        x = 0
                        y = 0
                    }

                    wm.addView(view, params)

                    persistentView = view
                    persistentWindowManager = wm
                    persistentParams = params

                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERR_OVERLAY_SHOW", e.message ?: "Unknown error", e)
                }
            }
        }

        AsyncFunction("hideOverlayWindow") { promise: Promise ->
            mainHandler.post {
                try {
                    removePersistentOverlay()
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERR_OVERLAY_HIDE", e.message ?: "Unknown error", e)
                }
            }
        }

        AsyncFunction("getStringViaOverlay") { promise: Promise ->
            withOverlayClipboard("getStringViaOverlay", promise) { context, clip ->
                if (clip != null && clip.itemCount > 0) {
                    val text = clip.getItemAt(0).coerceToText(context)?.toString() ?: ""
                    promise.resolve(text)
                } else {
                    promise.resolve("")
                }
            }
        }

        AsyncFunction("hasStringViaOverlay") { promise: Promise ->
            withOverlayClipboard("hasStringViaOverlay", promise) { _, clip ->
                if (clip != null && clip.itemCount > 0) {
                    val desc = clip.description
                    val hasText = desc.hasMimeType("text/*") ||
                        clip.getItemAt(0).text != null
                    promise.resolve(hasText)
                } else {
                    promise.resolve(false)
                }
            }
        }

        AsyncFunction("hasImageViaOverlay") { promise: Promise ->
            withOverlayClipboard("hasImageViaOverlay", promise) { _, clip ->
                if (clip != null && clip.itemCount > 0) {
                    val desc = clip.description
                    val hasImage = desc.hasMimeType("image/*")
                    promise.resolve(hasImage)
                } else {
                    promise.resolve(false)
                }
            }
        }

        AsyncFunction("getImageViaOverlay") { promise: Promise ->
            withOverlayClipboard("getImageViaOverlay", promise) { context, clip ->
                if (clip == null || clip.itemCount == 0) {
                    promise.resolve(null)
                    return@withOverlayClipboard
                }

                val item = clip.getItemAt(0)
                val uri = item.uri
                if (uri == null) {
                    promise.resolve(null)
                    return@withOverlayClipboard
                }

                try {
                    val mimeType = context.contentResolver.getType(uri)
                    if (mimeType == null || !mimeType.startsWith("image/")) {
                        promise.resolve(null)
                        return@withOverlayClipboard
                    }

                    val inputStream = context.contentResolver.openInputStream(uri)
                    if (inputStream == null) {
                        promise.resolve(null)
                        return@withOverlayClipboard
                    }

                    val bitmap = BitmapFactory.decodeStream(inputStream)
                    inputStream.close()

                    if (bitmap == null) {
                        promise.resolve(null)
                        return@withOverlayClipboard
                    }

                    val width = bitmap.width
                    val height = bitmap.height
                    val baos = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos)
                    val base64Data = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                    bitmap.recycle()

                    val result = mapOf(
                        "data" to base64Data,
                        "size" to mapOf(
                            "width" to width,
                            "height" to height
                        )
                    )
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.resolve(null)
                }
            }
        }

        AsyncFunction("setStringViaOverlay") { text: String, promise: Promise ->
            withOverlayFocus("setStringViaOverlay", promise) { context, done ->
                writeClipWithRetry(context, mainHandler, text, 0) { ok ->
                    done()
                    promise.resolve(ok)
                }
            }
        }

        AsyncFunction("saveImageToFileViaOverlay") { destDirPath: String, promise: Promise ->
            withOverlayClipboard("saveImageToFileViaOverlay", promise) { context, clip ->
                if (clip == null || clip.itemCount == 0) {
                    promise.resolve(null)
                    return@withOverlayClipboard
                }

                val item = clip.getItemAt(0)
                val uri = item.uri
                if (uri == null) {
                    promise.resolve(null)
                    return@withOverlayClipboard
                }

                try {
                    val mimeType = context.contentResolver.getType(uri)
                    if (mimeType == null || !mimeType.startsWith("image/")) {
                        promise.resolve(null)
                        return@withOverlayClipboard
                    }

                    val inputStream = context.contentResolver.openInputStream(uri)
                    if (inputStream == null) {
                        promise.resolve(null)
                        return@withOverlayClipboard
                    }

                    // 根据 mimeType 确定扩展名
                    val ext = when {
                        mimeType.contains("png") -> "png"
                        mimeType.contains("jpeg") || mimeType.contains("jpg") -> "jpg"
                        mimeType.contains("gif") -> "gif"
                        mimeType.contains("webp") -> "webp"
                        mimeType.contains("bmp") -> "bmp"
                        else -> "png"
                    }
                    val path = if (destDirPath.startsWith("file://", ignoreCase = true)) {
                        Uri.parse(destDirPath).path ?: destDirPath.removePrefix("file://")
                    } else {
                        destDirPath
                    }
                    val dir = File(path)
                    dir.mkdirs()
                    val fileName = "tmp_${System.currentTimeMillis()}_${(Math.random() * 100000).toInt()}.$ext"
                    val file = File(dir, fileName)
                    FileOutputStream(file).use { fos ->
                        inputStream.copyTo(fos, bufferSize = 8192)
                    }
                    inputStream.close()

                    // 仅读取尺寸（不分配像素内存）
                    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.absolutePath, opts)

                    val result = mapOf(
                        "width" to (opts.outWidth),
                        "height" to (opts.outHeight),
                        "filePath" to "file://" + file.absolutePath,
                        "mimeType" to mimeType
                    )
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.resolve(null)
                }
            }
        }
    }

    /**
     * Update the persistent overlay appearance based on current debug mode.
     * Must be called on main thread.
     */
    private fun updatePersistentOverlayAppearance() {
        val view = persistentView ?: return
        val wm = persistentWindowManager ?: return
        val params = persistentParams ?: return

        val overlaySize = if (debugMode) 200 else 1
        params.width = overlaySize
        params.height = overlaySize
        params.alpha = if (debugMode) 0.7f else 0f

        if (debugMode) {
            view.setBackgroundColor(0xFFFF0000.toInt())
        } else {
            view.setBackgroundColor(0x00000000)
        }

        try {
            wm.updateViewLayout(view, params)
        } catch (_: Exception) {}
    }

    /**
     * Remove the persistent overlay window.
     * Must be called on main thread.
     */
    private fun removePersistentOverlay() {
        val view = persistentView ?: return
        val wm = persistentWindowManager ?: return
        try {
            wm.removeView(view)
        } catch (_: Exception) {}
        persistentView = null
        persistentWindowManager = null
        persistentParams = null
    }

    /**
     * Reads the primary clip with fast retry logic.
     * Uses short intervals (10ms like AutoJs6) to minimize time the window has focus.
     */
    private fun readClipWithRetry(
        context: Context,
        handler: Handler,
        attempt: Int,
        callback: (ClipData?) -> Unit
    ) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip
        if (clip != null || attempt >= maxRetries) {
            callback(clip)
        } else {
            handler.postDelayed({
                readClipWithRetry(context, handler, attempt + 1, callback)
            }, RETRY_DELAY_MS)
        }
    }

    /**
     * Writes text to the primary clip with fast retry logic.
     * setPrimaryClip fails silently when the caller has no window focus,
     * so each attempt is verified by reading the clip back while the
     * overlay still holds focus.
     */
    private fun writeClipWithRetry(
        context: Context,
        handler: Handler,
        text: String,
        attempt: Int,
        callback: (Boolean) -> Unit
    ) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        try {
            cm.setPrimaryClip(ClipData.newPlainText("text", text))
        } catch (_: Exception) {}
        val clip = cm.primaryClip
        val ok = clip != null && clip.itemCount > 0 &&
            clip.getItemAt(0).coerceToText(context)?.toString() == text
        if (ok || attempt >= maxRetries) {
            callback(ok)
        } else {
            handler.postDelayed({
                writeClipWithRetry(context, handler, text, attempt + 1, callback)
            }, RETRY_DELAY_MS)
        }
    }

    /**
     * Reads the clipboard using the overlay window focus trick.
     */
    private fun withOverlayClipboard(
        tag: String,
        promise: Promise,
        action: (Context, ClipData?) -> Unit
    ) {
        withOverlayFocus(tag, promise) { context, done ->
            readClipWithRetry(context, mainHandler, 0) { clip ->
                done()
                try {
                    action(context, clip)
                } catch (e: Exception) {
                    promise.reject("ERR_OVERLAY_$tag", e.message ?: "Unknown error", e)
                }
            }
        }
    }

    /**
     * Waits until the view's window actually receives input focus (or the
     * timeout elapses), then runs [then] exactly once on the main thread.
     */
    private fun runWhenFocused(view: View, then: () -> Unit) {
        if (view.hasWindowFocus()) {
            then()
            return
        }
        var settled = false
        var listener: android.view.ViewTreeObserver.OnWindowFocusChangeListener? = null
        val timeout = Runnable {
            if (!settled) {
                settled = true
                try {
                    listener?.let { view.viewTreeObserver.removeOnWindowFocusChangeListener(it) }
                } catch (_: Exception) {}
                then()
            }
        }
        listener = android.view.ViewTreeObserver.OnWindowFocusChangeListener { hasFocus ->
            if (hasFocus && !settled) {
                settled = true
                mainHandler.removeCallbacks(timeout)
                try {
                    listener?.let { view.viewTreeObserver.removeOnWindowFocusChangeListener(it) }
                } catch (_: Exception) {}
                then()
            }
        }
        view.viewTreeObserver.addOnWindowFocusChangeListener(listener)
        mainHandler.postDelayed(timeout, FOCUS_WAIT_TIMEOUT_MS)
    }

    /**
     * Runs a clipboard operation while the overlay window holds focus.
     *
     * If a persistent overlay is showing, reuses it by toggling focus flags.
     * Otherwise, falls back to creating a temporary overlay (legacy behavior).
     *
     * Persistent overlay flow:
     * 1. Remove FLAG_NOT_FOCUSABLE from existing overlay (gains window focus)
     * 2. Run the clipboard operation
     * 3. `done()` re-adds FLAG_NOT_FOCUSABLE (releases focus back to foreground app)
     *
     * Legacy flow (no persistent overlay):
     * 1. Create temporary 1px overlay with FLAG_NOT_FOCUSABLE
     * 2. Remove FLAG_NOT_FOCUSABLE
     * 3. Run the clipboard operation
     * 4. `done()` destroys the temporary overlay
     *
     * The operation MUST call `done()` exactly once (before resolving/rejecting
     * the promise) and is responsible for settling the promise itself.
     */
    private fun withOverlayFocus(
        tag: String,
        promise: Promise,
        op: (Context, () -> Unit) -> Unit
    ) {
        withOverlayFocusInternal(tag, { code, message, e -> promise.reject(code, message, e) }, op)
    }

    /**
     * Promise-agnostic core of [withOverlayFocus]. Used both by the AsyncFunction
     * clipboard reads (via [withOverlayFocus]) and by the background monitor's
     * logcat-triggered read, which has no Promise to settle.
     */
    private fun withOverlayFocusInternal(
        tag: String,
        onError: (code: String, message: String, e: Throwable?) -> Unit,
        op: (Context, () -> Unit) -> Unit
    ) {
        val context = appContext.reactContext
        if (context == null) {
            onError("ERR_NO_CONTEXT", "React context is null", null)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            onError("ERR_NO_PERMISSION", "Overlay permission not granted", null)
            return
        }

        mainHandler.post {
            val view = persistentView
            val wm = persistentWindowManager
            val params = persistentParams

            if (view != null && wm != null && params != null) {
                // Persistent overlay path: toggle focus on existing window
                try {
                    // Step 1: Remove FLAG_NOT_FOCUSABLE to gain window focus
                    params.flags = params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
                    wm.updateViewLayout(view, params)
                    view.requestLayout()

                    // Step 2: Wait for real window focus, then run; done() releases focus
                    runWhenFocused(view) {
                        op(context) {
                            try {
                                params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                wm.updateViewLayout(view, params)
                            } catch (_: Exception) {}
                        }
                    }
                } catch (e: Exception) {
                    // Restore FLAG_NOT_FOCUSABLE on error
                    try {
                        params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        wm.updateViewLayout(view, params)
                    } catch (_: Exception) {}
                    onError("ERR_OVERLAY_$tag", e.message ?: "Unknown error", e)
                }
            } else {
                // Legacy path: create temporary overlay
                var overlayView: View? = null
                var tempWm: WindowManager? = null
                try {
                    tempWm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                    overlayView = View(context).apply {
                        isFocusable = true
                        isFocusableInTouchMode = true
                    }

                    val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    } else {
                        @Suppress("DEPRECATION")
                        WindowManager.LayoutParams.TYPE_PHONE
                    }

                    val overlaySize = if (debugMode) 200 else 1
                    if (debugMode) {
                        overlayView.setBackgroundColor(0xFFFF0000.toInt())
                    }

                    val tempParams = WindowManager.LayoutParams(
                        overlaySize, overlaySize,
                        layoutType,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                        PixelFormat.TRANSLUCENT
                    ).apply {
                        alpha = if (debugMode) 0.7f else 0f
                        gravity = Gravity.START or Gravity.TOP
                        x = 0
                        y = 0
                    }

                    tempWm.addView(overlayView, tempParams)

                    val finalWm = tempWm
                    val finalView = overlayView

                    finalView.post {
                        try {
                            tempParams.flags = tempParams.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
                            finalWm.updateViewLayout(finalView, tempParams)
                            finalView.requestLayout()

                            runWhenFocused(finalView) {
                                op(context) {
                                    try {
                                        finalWm.removeView(finalView)
                                    } catch (_: Exception) {}
                                }
                            }
                        } catch (e: Exception) {
                            try {
                                finalWm.removeView(finalView)
                            } catch (_: Exception) {}
                            onError("ERR_OVERLAY_$tag", e.message ?: "Unknown error", e)
                        }
                    }
                } catch (e: Exception) {
                    try {
                        if (overlayView != null && tempWm != null) {
                            tempWm.removeView(overlayView)
                        }
                    } catch (_: Exception) {}
                    onError("ERR_OVERLAY_$tag", e.message ?: "Unknown error", e)
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // ClipCascade-style event-driven clipboard monitor
    //
    // Two triggers feed a single "onClipboardChange" event:
    //   1. OnPrimaryClipChangedListener — fires while the app is foreground/focused,
    //      where primaryClip is readable directly (no overlay needed).
    //   2. logcat "ClipboardService:E" — while backgrounded, another app's copy makes
    //      the system deny our listener's read and log a line naming our package.
    //      That line is our signal to grab focus via the overlay and read once.
    // Must be started/stopped on the main thread.
    // ---------------------------------------------------------------------------

    private fun startMonitorInternal() {
        if (isMonitoring) return
        val context = appContext.reactContext ?: return
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardManagerRef = cm

        // 1) Foreground realtime path.
        val listener = ClipboardManager.OnPrimaryClipChangedListener {
            try {
                val map = buildClipMap(context, cm.primaryClip)
                if (map != null) emitClip(map)
            } catch (_: Exception) {
                // Backgrounded: read denied. The logcat trigger will handle it.
            }
        }
        cm.addPrimaryClipChangedListener(listener)
        clipChangedListener = listener

        // 2) Background trigger path (requires READ_LOGS, adb-granted only).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            context.checkSelfPermission(Manifest.permission.READ_LOGS) == PackageManager.PERMISSION_GRANTED
        ) {
            stopLogcat = false
            logcatThread = Thread {
                try {
                    val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
                    // Only ClipboardService errors from now on; silence everything else.
                    val process = Runtime.getRuntime()
                        .exec(arrayOf("logcat", "-T", ts, "ClipboardService:E", "*:S"))
                    logcatProcess = process
                    val reader = BufferedReader(InputStreamReader(process.inputStream))
                    reader.use { br ->
                        var line: String? = null
                        while (!stopLogcat && br.readLine().also { line = it } != null) {
                            val l = line
                            if (l != null && l.contains(context.packageName)) {
                                val now = System.currentTimeMillis()
                                if (now - lastTriggerTime > triggerDebounceMs) {
                                    lastTriggerTime = now
                                    mainHandler.post { triggerOverlayReadAndEmit() }
                                }
                            }
                        }
                    }
                } catch (_: Exception) {
                } finally {
                    try { logcatProcess?.destroy() } catch (_: Exception) {}
                }
            }.apply {
                isDaemon = true
                start()
            }
        }

        isMonitoring = true
    }

    private fun stopMonitorInternal() {
        clipChangedListener?.let { l ->
            try { clipboardManagerRef?.removePrimaryClipChangedListener(l) } catch (_: Exception) {}
        }
        clipChangedListener = null

        stopLogcat = true
        try { logcatThread?.interrupt() } catch (_: Exception) {}
        try { logcatProcess?.destroy() } catch (_: Exception) {}
        logcatThread = null
        logcatProcess = null

        isMonitoring = false
    }

    /**
     * Background trigger handler: grab overlay focus, read the clip once, emit.
     * Reuses the same overlay focus mechanism as the on-demand reads.
     */
    private fun triggerOverlayReadAndEmit() {
        withOverlayFocusInternal("monitor", { _, _, _ -> /* best-effort, no promise */ }) { context, done ->
            readClipWithRetry(context, mainHandler, 0) { clip ->
                done()
                try {
                    val map = buildClipMap(context, clip)
                    if (map != null) emitClip(map)
                } catch (_: Exception) {}
            }
        }
    }

    /**
     * Classifies the primary clip into { type, content } like ClipCascade.
     * Returns null (no emit) when the clip is empty or unreadable. Never contains
     * null values, so the FFI marshaller stays happy.
     */
    private fun buildClipMap(context: Context, clip: ClipData?): Map<String, Any>? {
        if (clip == null || clip.itemCount == 0) return null
        val desc = clip.description ?: return null
        val mime = desc.getMimeType(0) ?: return null
        val item = clip.getItemAt(0)
        return when {
            mime.startsWith("text/") && item.text != null ->
                mapOf("type" to "text", "content" to item.text.toString())
            mime.startsWith("image/") && item.uri != null ->
                mapOf("type" to "image", "content" to item.uri.toString())
            item.uri != null ->
                mapOf("type" to "files", "content" to item.uri.toString())
            item.text != null ->
                mapOf("type" to "text", "content" to item.coerceToText(context).toString())
            else -> null
        }
    }

    private fun emitClip(map: Map<String, Any>) {
        val content = map["content"] as? String
        if (content != null && content == lastEmittedContent) return
        lastEmittedContent = content
        sendEvent("onClipboardChange", map)
    }
}
