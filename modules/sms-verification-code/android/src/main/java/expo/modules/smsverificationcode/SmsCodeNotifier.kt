package expo.modules.smsverificationcode

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

internal enum class CopyState { NEEDS_TAP, COPIED, FAILED }

internal object SmsCodeNotifier {
    private const val CHANNEL_ID = "sms_code"
    private const val NOTIFY_ID = 0x2030
    private const val TIMEOUT_MS = 60_000L

    /**
     * Title carries the plaintext code by the user's choice. The second line only claims "copied"
     * for a write known to have succeeded; otherwise a Copy action does the write with focus.
     */
    fun showCode(context: Context, code: String, state: CopyState) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        ensureChannel(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val contentIntent = launch?.let {
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(context.getString(R.string.sms_code_title, code))
            .setContentText(
                context.getString(
                    when (state) {
                        CopyState.COPIED -> R.string.sms_code_copied
                        CopyState.NEEDS_TAP -> R.string.sms_code_tap_to_copy
                        CopyState.FAILED -> R.string.sms_code_copy_failed
                    }
                )
            )
            .apply { if (state != CopyState.COPIED) addAction(0, context.getString(R.string.sms_code_action_copy), copyIntent(context, code)) }
            .setSmallIcon(iconRes(context))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setTimeoutAfter(TIMEOUT_MS)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        try {
            manager.notify(NOTIFY_ID, notification)
        } catch (_: SecurityException) {
            // Notification permission revoked between the check and the post.
        }
    }

    private fun copyIntent(context: Context, code: String): PendingIntent {
        val intent = android.content.Intent(context, SmsCodeCopyActivity::class.java)
            .putExtra(SmsCodeCopyActivity.EXTRA_CODE, code)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun iconRes(context: Context): Int =
        context.resources.getIdentifier("ic_notification", "drawable", context.packageName).takeIf { it != 0 }
            ?: context.resources.getIdentifier("ic_launcher_foreground", "mipmap", context.packageName).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.sms_code_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = context.getString(R.string.sms_code_channel_description) }
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }
}
