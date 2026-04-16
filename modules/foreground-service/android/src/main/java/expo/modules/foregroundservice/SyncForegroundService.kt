package expo.modules.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
        private const val RESTART_NOTIFY_ID = 0x2021
        private const val RESTART_CHANNEL_ID = "syncclipboard_restart"
        private const val RESTART_CHANNEL_NAME = "服务重启提醒"

        var isRunning = false
            private set

        /** 标记是否为用户主动停止（ACTION_STOP / ACTION_TEMP_STOP），
         *  区分系统杀掉与用户操作，onDestroy 时据此决定是否发通知 */
        private var stoppedByUser = false
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
                Log.d(TAG, "Starting foreground, intent action=${intent?.action}")
                val notification = createNotification("后台任务运行中")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFY_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                } else {
                    startForeground(NOTIFY_ID, notification)
                }
                Log.d(TAG, "startForeground called successfully")
                isRunning = true

                // 系统 START_STICKY 重启时 intent 为 null，延迟检查 JS 线程是否存活
                if (intent == null) {
                    Log.w(TAG, "Service restarted by system (intent=null), checking JS runtime...")
                    Handler(Looper.getMainLooper()).postDelayed({
                        if (!ForegroundServiceModule.isJsRuntimeAlive()) {
                            Log.w(TAG, "JS runtime not available, showing restart notification")
                            showRestartNotification()
                        } else {
                            Log.d(TAG, "JS runtime is alive after system restart")
                        }
                    }, 3000)
                }
            }
            ACTION_STOP -> {
                Log.d(TAG, "Stopping foreground service (permanent)")
                stoppedByUser = true
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
                stoppedByUser = true
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
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.d(TAG, "onDestroy called, stoppedByUser=$stoppedByUser, isRunning=$isRunning")
        val wasRunning = isRunning
        isRunning = false
        // 非用户主动停止且之前确实在运行 → 可能被系统杀死，发通知引导重启
        if (!stoppedByUser && wasRunning) {
            Log.w(TAG, "Service destroyed unexpectedly, showing restart notification")
            showRestartNotification()
        }
        stoppedByUser = false
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

    private fun showRestartNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as? NotificationManager ?: return

        // 创建独立的通知渠道（重要性设为 HIGH 以弹出 heads-up）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                RESTART_CHANNEL_ID,
                RESTART_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "后台服务被系统终止后重启提醒"
            }
            nm.createNotificationChannel(channel)
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = applicationContext.resources.getIdentifier(
            "ic_notification", "drawable", packageName
        ).takeIf { it != 0 }
            ?: applicationContext.resources.getIdentifier(
                "ic_launcher_foreground", "mipmap", packageName
            ).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        val notification = NotificationCompat.Builder(this, RESTART_CHANNEL_ID)
            .setContentTitle("后台服务已停止")
            .setContentText("点击启动APP以恢复后台服务")
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        nm.notify(RESTART_NOTIFY_ID, notification)
    }
}
