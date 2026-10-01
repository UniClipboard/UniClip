package expo.modules.smsverificationcode

import android.app.Activity
import android.os.Bundle

/**
 * Copies the code once the window has focus (the only time Android 10+ accepts the write),
 * then reports the real outcome in the notification and lets JS record the copy.
 */
class SmsCodeCopyActivity : Activity() {
    companion object {
        const val EXTRA_CODE = "code"
    }

    private var handled = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.getStringExtra(EXTRA_CODE) == null) finish()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || handled) return
        handled = true
        val code = intent?.getStringExtra(EXTRA_CODE)
        if (code != null) {
            val copied = SmsCodeClipboard.copy(this, code)
            SmsCodeNotifier.showCode(this, code, if (copied) CopyState.COPIED else CopyState.FAILED)
            if (copied) SmsCodeHeadlessTaskService.start(this, code, tryWrite = false)
        }
        finish()
    }
}
