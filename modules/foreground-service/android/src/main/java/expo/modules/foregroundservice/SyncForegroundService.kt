package expo.modules.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

class SyncForegroundService : Service() {

    companion object {
        private const val TAG = "SyncForegroundService"
        const val CHANNEL_ID = "syncclipboard_foreground"
        const val CHANNEL_NAME = "后台任务"
        const val NOTIFY_ID = 0x2020
        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"
        const val ACTION_TEMP_STOP = "TEMP_STOP"
        const val ACTION_UPDATE = "UPDATE"
        const val EXTRA_CONTENT = "content"

        var isRunning = false
            private set
    }

    private var notificationManager: NotificationManager? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service onCreate")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action} flags=$flags startId=$startId")
        when (intent?.action) {
            ACTION_START, null -> {
                Log.d(TAG, "Starting foreground")
                val notification = createNotification("后台任务运行中")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFY_ID, notification)
                }
                Log.d(TAG, "startForeground called successfully")
                isRunning = true
            }
            ACTION_STOP -> {
                Log.d(TAG, "Stopping foreground service (permanent)")
                if (!isRunning) {
                    val notification = createNotification("正在停止...")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    } else {
                        startForeground(NOTIFY_ID, notification)
                    }
                }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                isRunning = false
                // Send event to JS to disable background tasks permanently
                ForegroundServiceModule.sendStopEvent()
            }
            ACTION_TEMP_STOP -> {
                Log.d(TAG, "Stopping foreground service (temporary)")
                if (!isRunning) {
                    val notification = createNotification("正在停止...")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    } else {
                        startForeground(NOTIFY_ID, notification)
                    }
                }
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                isRunning = false
                // Send temp stop event to JS (no settings change, service restarts next time)
                ForegroundServiceModule.sendTempStopEvent()
            }
            ACTION_UPDATE -> {
                val content = intent.getStringExtra(EXTRA_CONTENT) ?: "后台任务运行中"
                updateNotification(content)
            }
            else -> {
                // Unknown action - still need to call startForeground to prevent crash
                val notification = createNotification("后台任务运行中")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFY_ID, notification)
                }
                isRunning = true
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "SyncClipboard 后台同步服务"
                setShowBadge(false)
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(content: String): Notification {
        // PendingIntent to open the app when notification is tapped
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingLaunchIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Temp stop action
        val tempStopIntent = Intent(this, SyncForegroundService::class.java).apply {
            action = ACTION_TEMP_STOP
        }
        val tempStopPendingIntent = PendingIntent.getService(
            this, 2, tempStopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action
        val stopIntent = Intent(this, SyncForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = applicationContext.resources.getIdentifier(
            "ic_notification", "drawable", packageName
        ).takeIf { it != 0 }
            ?: applicationContext.resources.getIdentifier(
                "ic_launcher_foreground", "mipmap", packageName
            ).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        Log.d(TAG, "Notification icon resId=$iconResId")

        // 内容以 \n 分割为标题和正文
        val lines = content.split("\n", limit = 2)
        val title = lines[0]
        val body = if (lines.size > 1) lines[1] else ""

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingLaunchIntent)
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, "临时停止", tempStopPendingIntent)
            .addAction(0, "永久停止", stopPendingIntent)
            .setStyle(NotificationCompat.BigTextStyle()
                .setBigContentTitle(title)
                .bigText(body)
            )
            .build()
    }

    private fun updateNotification(content: String) {
        val notification = createNotification(content)
        notificationManager?.notify(NOTIFY_ID, notification)
    }
}
