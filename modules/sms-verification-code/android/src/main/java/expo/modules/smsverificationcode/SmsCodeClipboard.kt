package expo.modules.smsverificationcode

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle

internal object SmsCodeClipboard {
    /** Returns whether the system accepted the write; never throws. */
    fun copy(context: Context, code: String): Boolean = try {
        val clip = ClipData.newPlainText("", code)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Keeps the code out of the clipboard preview overlay.
            clip.description.extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .setPrimaryClip(clip)
        true
    } catch (_: Exception) {
        false
    }
}
