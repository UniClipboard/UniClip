package expo.modules.smsverificationcode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Boots the JS runtime without UI so the code is copied through the app's background clipboard
 * access, recorded in history and offered to the existing clipboard observer, which applies the
 * user's own sync settings. The notification's Copy action remains available if this fails.
 */
class SmsCodeHeadlessTaskService : HeadlessJsTaskService() {
    companion object {
        private const val TASK_KEY = "SmsCodeReceived"
        private const val EXTRA_CODE = "code"
        private const val EXTRA_TRY_WRITE = "tryWrite"
        private const val CHANNEL_ID = "sms_code_processing"
        private const val NOTIFY_ID = 0x2031
        private const val TIMEOUT_MS = 60_000L

        /** [tryWrite]: JS should first try the app's background clipboard write (false when already copied). */
        fun start(context: Context, code: String, tryWrite: Boolean) {
            val intent = Intent(context, SmsCodeHeadlessTaskService::class.java)
                .putExtra(EXTRA_CODE, code)
                .putExtra(EXTRA_TRY_WRITE, tryWrite)
            try {
                acquireWakeLockNow(context)
                ContextCompat.startForegroundService(context, intent)
            } catch (_: Exception) {
                // Background start not allowed right now: the code is already copied and shown.
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        promoteToForeground()
        return super.onStartCommand(intent, flags, startId)
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val code = intent?.getStringExtra(EXTRA_CODE) ?: return null
        val data = Arguments.createMap().apply {
            putString("code", code)
            putBoolean("tryWrite", intent.getBooleanExtra(EXTRA_TRY_WRITE, false))
        }
        return HeadlessJsTaskConfig(TASK_KEY, data, TIMEOUT_MS, true)
    }

    private fun promoteToForeground() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.sms_code_channel_name), NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.sms_code_processing))
            .setSmallIcon(SmsCodeNotifier.iconRes(this))
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE else 0
        ServiceCompat.startForeground(this, NOTIFY_ID, notification, type)
    }
}
