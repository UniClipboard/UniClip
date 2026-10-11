package expo.modules.foregroundservice

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.nativeutil.NativeLogger
import expo.modules.ucengine.BackgroundServiceDiagnostics

/**
 * Recovery after a reboot or an app update, both of which end the service without a user action.
 *
 * It recovers only what the user had switched on, and only when the last stop was not the user's
 * own (Stop, Pause, or removing the app from recents). It is delivered after the first unlock, so
 * the credential-protected state it reads is available. Synchronisation itself needs the JS
 * runtime, so recovery is a notification that resumes it with one tap and an observable outcome,
 * never a silent claim that the service is running.
 */
class BootRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val trigger = when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> "boot"
            Intent.ACTION_MY_PACKAGE_REPLACED -> "package_replaced"
            else -> return
        }
        val outcome = decide(context)
        NativeLogger.d("BootRecoveryReceiver", "recovery trigger=$trigger outcome=$outcome")
        BackgroundServiceDiagnostics.recoveryDecision(context, trigger, outcome == OUTCOME_PROMPTED)
        if (outcome == OUTCOME_PROMPTED) RestartNotifier.show(context)
    }

    private fun decide(context: Context): String {
        if (!BackgroundIntent.enabled(context)) return "skipped_disabled"
        val reason = ServiceStopRecord.read(context)["lastStopReason"] as? String
        if (reason in ServiceStopRecord.USER_CHOSEN) return "skipped_user_stopped"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return "skipped_notifications_denied"
        return OUTCOME_PROMPTED
    }

    private companion object {
        const val OUTCOME_PROMPTED = "prompted"
    }
}
