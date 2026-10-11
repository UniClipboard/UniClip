package expo.modules.foregroundservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.StringRes
import androidx.core.app.NotificationCompat
import expo.modules.nativeutil.NativeLogger

/**
 * The "tap to resume sync" notification. Shared by the service (system restart, timeout) and the
 * boot receiver, which both have to recover through the user because no JS runtime exists yet.
 */
internal object RestartNotifier {
    private const val TAG = "RestartNotifier"
    private const val NOTIFY_ID = 0x2021
    private const val ACTIVITY_SUFFIX = ".servicerestart.ServiceRestartActivity"

    fun show(
        context: Context,
        @StringRes contentResId: Int = R.string.foreground_service_restart_content
    ) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    SyncForegroundService.RESTART_CHANNEL_ID,
                    context.getString(R.string.foreground_service_restart_channel_name),
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = context.getString(R.string.foreground_service_restart_channel_description) }
            )
        }

        // ServiceRestartActivity resumes the service and then exits.
        val restartIntent = restartActivityIntent(context).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, restartIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = context.resources.getIdentifier("ic_notification", "drawable", context.packageName)
            .takeIf { it != 0 }
            ?: context.resources.getIdentifier("ic_launcher_foreground", "mipmap", context.packageName)
                .takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        val notification = NotificationCompat.Builder(context, SyncForegroundService.RESTART_CHANNEL_ID)
            .setContentTitle(context.getString(R.string.foreground_service_restart_title))
            .setContentText(context.getString(contentResId))
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        nm.notify(NOTIFY_ID, notification)
    }

    /**
     * ServiceRestartActivity is registered by the app (its class name follows the namespace and the
     * applicationId may carry a variant suffix), so it is found among this package's activities by
     * suffix. Without it the launch activity is used, so a tap always returns to the app.
     */
    private fun restartActivityIntent(context: Context): Intent {
        val packageManager = context.packageManager
        val packageName = context.packageName
        val activities = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(
                    packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_ACTIVITIES.toLong())
                ).activities
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, PackageManager.GET_ACTIVITIES).activities
            }
        }.getOrNull()
        val restartActivity = activities?.firstOrNull { it.name.endsWith(ACTIVITY_SUFFIX) }
        if (restartActivity != null) {
            return Intent().setClassName(packageName, restartActivity.name)
        }
        NativeLogger.w(TAG, "ServiceRestartActivity is not registered, falling back to the launch activity")
        return packageManager.getLaunchIntentForPackage(packageName) ?: Intent().setPackage(packageName)
    }
}
