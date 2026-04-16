package expo.modules.smsforwarder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * 静态 BroadcastReceiver，在 AndroidManifest.xml 中注册。
 * 即使 app 进程被杀或处于 Doze 模式，系统仍会唤醒此 Receiver 处理短信。
 * （SMS_RECEIVED 属于隐式广播豁免列表，不受 Doze 限制）
 */
class StaticSmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "StaticSmsReceiver"
        const val PREFS_NAME = "sms_forwarder_pending"
        const val KEY_PENDING_SMS = "pending_sms"
        const val ACTION_STATIC_SMS = "expo.modules.smsforwarder.STATIC_SMS_RECEIVED"
        const val EXTRA_FROM = "from"
        const val EXTRA_BODY = "body"
        private const val SMS_NOTIFY_CHANNEL_ID = "syncclipboard_sms_restart"
        private const val SMS_NOTIFY_CHANNEL_NAME = "短信转发提醒"
        private const val SMS_NOTIFY_ID = 0x2021
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val from = messages[0].displayOriginatingAddress ?: ""
        val body = messages.joinToString("") { it.messageBody ?: "" }

        Log.d(TAG, "Static receiver got SMS from=$from")

        // 1. 存入 SharedPreferences 作为待处理短信
        savePendingSms(context, from, body)

        // 2. 发送本地广播，如果 SmsForwarderModule 正在监听则会立即处理
        val localIntent = Intent(ACTION_STATIC_SMS).apply {
            setPackage(context.packageName)
            putExtra(EXTRA_FROM, from)
            putExtra(EXTRA_BODY, body)
        }
        context.sendBroadcast(localIntent)

        // 3. 检查 JS 线程是否存活，不存活则发送通知引导用户重启
        if (!SmsForwarderModule.isJsListening) {
            Log.w(TAG, "JS runtime not listening, showing restart notification")
            showRestartNotification(context)
        }
    }

    private fun savePendingSms(context: Context, from: String, body: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_PENDING_SMS, "[]")
        val array = try {
            JSONArray(existing)
        } catch (_: Exception) {
            JSONArray()
        }

        val sms = JSONObject().apply {
            put("from", from)
            put("body", body)
            put("timestamp", System.currentTimeMillis())
        }
        array.put(sms)

        prefs.edit().putString(KEY_PENDING_SMS, array.toString()).apply()
        Log.d(TAG, "Saved pending SMS, total=${array.length()}")
    }

    private fun showRestartNotification(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                SMS_NOTIFY_CHANNEL_ID,
                SMS_NOTIFY_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "收到短信但应用未运行时提醒"
            }
            nm.createNotificationChannel(channel)
        }

        // 启动 ServiceRestartActivity 恢复 JS 运行时
        val restartIntent = Intent().apply {
            component = ComponentName(
                context.packageName,
                "${context.packageName}.servicerestart.ServiceRestartActivity"
            )
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, restartIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val iconResId = context.resources.getIdentifier(
            "ic_notification", "drawable", context.packageName
        ).takeIf { it != 0 }
            ?: context.resources.getIdentifier(
                "ic_launcher_foreground", "mipmap", context.packageName
            ).takeIf { it != 0 }
            ?: android.R.drawable.ic_menu_info_details

        val notification = NotificationCompat.Builder(context, SMS_NOTIFY_CHANNEL_ID)
            .setContentTitle("收到短信验证码")
            .setContentText("应用未运行，点击恢复自动转发")
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        nm.notify(SMS_NOTIFY_ID, notification)
    }
}
