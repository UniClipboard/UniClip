package expo.modules.smsverificationcode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Receives SMS, runs the shared recognizer and, only on an unambiguous match, shows the code in a
 * notification and hands it to JS to copy, record and sync per the user's settings.
 * Never logs the body, sender or code.
 */
class SmsCodeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!SmsCodeAutoCopy.isActive(context)) return

        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val body = parts.joinToString(separator = "") { it.messageBody.orEmpty() }
        val code = (SmsVerificationCodeRecognizer.recognize(body) as? SmsCodeResult.Match)?.code
            ?: return

        // Android 10+ drops clipboard writes from an unfocused app without any error, so a native
        // write here could not be trusted. Show the code with a Copy action, then let JS try the
        // app's background clipboard access; the notification turns to "copied" only on success.
        SmsCodeNotifier.showCode(context, code, CopyState.NEEDS_TAP)
        SmsCodeHeadlessTaskService.start(context, code, tryWrite = true)
    }
}
