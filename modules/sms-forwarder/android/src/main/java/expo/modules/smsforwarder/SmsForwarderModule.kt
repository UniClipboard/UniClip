package expo.modules.smsforwarder

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

class SmsForwarderModule : Module() {

    companion object {
        private const val TAG = "SmsForwarderModule"

        /**
         * JS 线程是否正在监听短信。
         * 静态字段：进程被杀后自动重置为 false，比 SharedPreferences 更可靠。
         * StaticSmsReceiver 通过此字段判断 JS 是否存活。
         */
        @Volatile
        var isJsListening: Boolean = false
            private set
    }

    private var smsReceiver: BroadcastReceiver? = null
    private var staticRelayReceiver: BroadcastReceiver? = null
    private var listening = false

    override fun definition() = ModuleDefinition {
        Name("SmsForwarderModule")

        Events("onSmsReceived")

        Function("readRecentSms") { count: Int ->
            val context = appContext.reactContext ?: return@Function emptyList<Map<String, String>>()
            val messages = mutableListOf<Map<String, String>>()

            val cursor = context.contentResolver.query(
                Uri.parse("content://sms"),
                arrayOf("address", "body", "date"),
                null,
                null,
                "date DESC"
            )

            cursor?.use {
                val addressIdx = it.getColumnIndexOrThrow("address")
                val bodyIdx = it.getColumnIndexOrThrow("body")
                var read = 0
                while (it.moveToNext() && read < count) {
                    messages.add(mapOf(
                        "from" to (it.getString(addressIdx) ?: ""),
                        "body" to (it.getString(bodyIdx) ?: "")
                    ))
                    read++
                }
            }

            messages
        }

        Function("startListening") {
            if (listening) return@Function true
            val context = appContext.reactContext ?: return@Function false

            // 动态接收器：app 运行时直接接收短信
            smsReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

                    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                    if (messages.isNullOrEmpty()) return

                    val from = messages[0].displayOriginatingAddress ?: ""
                    val body = messages.joinToString("") { it.messageBody ?: "" }

                    sendEvent("onSmsReceived", mapOf(
                        "from" to from,
                        "body" to body
                    ))
                }
            }

            val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
            filter.priority = Int.MAX_VALUE

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(smsReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                context.registerReceiver(smsReceiver, filter)
            }

            // 中继接收器：接收从 StaticSmsReceiver 转发的本地广播
            staticRelayReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    if (intent.action != StaticSmsReceiver.ACTION_STATIC_SMS) return
                    val from = intent.getStringExtra(StaticSmsReceiver.EXTRA_FROM) ?: ""
                    val body = intent.getStringExtra(StaticSmsReceiver.EXTRA_BODY) ?: ""
                    Log.d(TAG, "Relay receiver got static SMS from=$from")
                    // 静态 Receiver 已存入 pending，这里处理后清除
                    clearPendingSms(ctx)
                    sendEvent("onSmsReceived", mapOf(
                        "from" to from,
                        "body" to body
                    ))
                }
            }

            val relayFilter = IntentFilter(StaticSmsReceiver.ACTION_STATIC_SMS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(staticRelayReceiver, relayFilter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(staticRelayReceiver, relayFilter)
            }

            listening = true

            // 标记 JS 线程正在监听
            isJsListening = true

            // 检查是否有待处理的短信（app 被杀期间由静态 Receiver 存储的）
            emitPendingSms(context)

            true
        }

        Function("stopListening") {
            if (!listening) return@Function true
            val context = appContext.reactContext ?: return@Function false

            smsReceiver?.let {
                try {
                    context.unregisterReceiver(it)
                } catch (_: Exception) {}
            }
            smsReceiver = null

            staticRelayReceiver?.let {
                try {
                    context.unregisterReceiver(it)
                } catch (_: Exception) {}
            }
            staticRelayReceiver = null

            listening = false
            isJsListening = false
            true
        }

        Function("isListening") {
            listening
        }

        Function("setStaticReceiverEnabled") { enabled: Boolean ->
            val context = appContext.reactContext ?: return@Function false
            val component = ComponentName(context, StaticSmsReceiver::class.java)
            val newState = if (enabled) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            } else {
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            }
            context.packageManager.setComponentEnabledSetting(
                component,
                newState,
                PackageManager.DONT_KILL_APP
            )
            Log.d(TAG, "StaticSmsReceiver enabled=$enabled")
            true
        }

        Function("isStaticReceiverEnabled") {
            val context = appContext.reactContext ?: return@Function false
            val component = ComponentName(context, StaticSmsReceiver::class.java)
            val state = context.packageManager.getComponentEnabledSetting(component)
            state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        }

        OnDestroy {
            val context = appContext.reactContext
            if (listening) {
                smsReceiver?.let {
                    try {
                        context?.unregisterReceiver(it)
                    } catch (_: Exception) {}
                }
                staticRelayReceiver?.let {
                    try {
                        context?.unregisterReceiver(it)
                    } catch (_: Exception) {}
                }
                smsReceiver = null
                staticRelayReceiver = null
                listening = false
            }
            context?.let { isJsListening = false }
        }
    }

    private fun emitPendingSms(context: Context) {
        val prefs = context.getSharedPreferences(StaticSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(StaticSmsReceiver.KEY_PENDING_SMS, "[]") ?: "[]"
        val array = try {
            JSONArray(json)
        } catch (_: Exception) {
            JSONArray()
        }

        if (array.length() == 0) return

        Log.d(TAG, "Emitting ${array.length()} pending SMS")
        for (i in 0 until array.length()) {
            val sms = array.optJSONObject(i) ?: continue
            sendEvent("onSmsReceived", mapOf(
                "from" to (sms.optString("from", "")),
                "body" to (sms.optString("body", ""))
            ))
        }

        clearPendingSms(context)
    }

    private fun clearPendingSms(context: Context) {
        context.getSharedPreferences(StaticSmsReceiver.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(StaticSmsReceiver.KEY_PENDING_SMS, "[]")
            .apply()
    }
}
