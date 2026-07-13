package expo.modules.shizukuclipboard

import android.app.Application
import android.content.ClipData
import android.content.ClipDescription
import android.net.Uri
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Log
import org.json.JSONObject
import java.io.FileOutputStream

class ClipboardUserService : IClipboardUserService.Stub() {
    companion object {
        private const val TAG = "ShizukuClipboardService"
        private const val PACKAGE_NAME = "com.android.shell"

        init {
            if (android.os.Process.myUid() == 0) {
                try {
                    android.system.Os.setgid(2000)
                    android.system.Os.setuid(2000)
                } catch (_: Exception) {
                }
            }
        }

        private var clipboardService: Any? = null

        private fun getClipboardService(): Any? {
            clipboardService?.let { return it }
            return try {
                val serviceManager = Class.forName("android.os.ServiceManager")
                val binder = serviceManager.getMethod("getService", String::class.java)
                    .invoke(null, "clipboard") as? IBinder ?: return null
                val stub = Class.forName("android.content.IClipboard\$Stub")
                stub.getMethod("asInterface", IBinder::class.java).invoke(null, binder).also {
                    clipboardService = it
                }
            } catch (error: Exception) {
                Log.e(TAG, "Failed to obtain clipboard service", error)
                null
            }
        }

        private fun application(): Application? {
            return try {
                val activityThread = Class.forName("android.app.ActivityThread")
                activityThread.getMethod("currentApplication").invoke(null) as? Application
            } catch (_: Exception) {
                try {
                    val appGlobals = Class.forName("android.app.AppGlobals")
                    appGlobals.getMethod("getInitialApplication").invoke(null) as? Application
            } catch (error: Exception) {
                Log.e(TAG, "Failed to obtain application context", error)
                null
            }
            }
        }
    }

    @Volatile
    private var lastClip: ClipData? = null

    override fun init(callerToken: IBinder) {
        try {
            callerToken.linkToDeath({ destroy() }, 0)
        } catch (_: Exception) {
        }
    }

    override fun getPrimaryClipJson(): String {
        val clip = invokeClipboard("getPrimaryClip") as? ClipData ?: return ""
        if (clip.itemCount == 0) return ""
        lastClip = clip

        val description = clip.description ?: return ""
        val item = clip.getItemAt(0)
        val mimeType = description.getMimeType(0) ?: "application/octet-stream"
        val uri = item.uri
        val type = when {
            mimeType.startsWith("text/") && item.text != null -> "text"
            mimeType.startsWith("image/") && uri != null -> "image"
            uri != null -> "files"
            item.text != null -> "text"
            else -> return ""
        }
        val content = if (type == "text") item.text?.toString().orEmpty() else uri.toString()

        return JSONObject().apply {
            put("type", type)
            put("content", content)
            put("mimeType", mimeType)
            if (uri != null) put("displayName", queryDisplayName(uri))
        }.toString()
    }

    override fun copyPrimaryClipToFile(destination: ParcelFileDescriptor): Boolean {
        val clip = lastClip ?: (invokeClipboard("getPrimaryClip") as? ClipData) ?: return false
        if (clip.itemCount == 0) return false
        val uri = clip.getItemAt(0).uri ?: return false
        val resolver = application()?.contentResolver ?: return false

        return try {
            resolver.openInputStream(uri)?.use { input ->
                FileOutputStream(destination.fileDescriptor).use { output -> input.copyTo(output) }
            } ?: return false
            true
        } catch (_: Exception) {
            false
        }
    }

    override fun setPrimaryClipText(text: String): Boolean {
        return invokeClipboard("setPrimaryClip", ClipData.newPlainText("UniClip", text)) != null
    }

    override fun destroy() {
        lastClip = null
        clipboardService = null
        System.exit(0)
    }

    private fun queryDisplayName(uri: Uri): String {
        val resolver = application()?.contentResolver ?: return ""
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else ""
            }.orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun invokeClipboard(methodName: String, clipData: ClipData? = null): Any? {
        val clipboard = getClipboardService() ?: return null
        val methods = clipboard.javaClass.methods
            .filter { it.name == methodName }
            .sortedByDescending { it.parameterCount }

        for (method in methods) {
            val args = arrayOfNulls<Any>(method.parameterCount)
            var stringIndex = 0
            var supported = true
            method.parameterTypes.forEachIndexed { index, type ->
                args[index] = when {
                    ClipData::class.java.isAssignableFrom(type) -> clipData
                    type == String::class.java -> if (stringIndex++ == 0) PACKAGE_NAME else null
                    type == Int::class.javaPrimitiveType || type == Int::class.java -> 0
                    type == Long::class.javaPrimitiveType || type == Long::class.java -> 0L
                    type == Boolean::class.javaPrimitiveType || type == Boolean::class.java -> false
                    else -> {
                        supported = false
                        null
                    }
                }
            }
            if (!supported || (methodName == "setPrimaryClip" && clipData == null)) continue

            try {
                val result = method.invoke(clipboard, *args)
                return result ?: if (method.returnType == Void.TYPE) true else null
            } catch (error: Exception) {
                Log.e(
                    TAG,
                    "Failed ${method.name}(${method.parameterTypes.joinToString { it.simpleName }})",
                    error.cause ?: error
                )
            }
        }
        Log.e(TAG, "No compatible clipboard method found for $methodName")
        return null
    }
}
