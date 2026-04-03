package expo.modules.smsforwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsForwarderModule : Module() {

    private var smsReceiver: BroadcastReceiver? = null
    private var listening = false

    override fun definition() = ModuleDefinition {
        Name("SmsForwarderModule")

        Events("onSmsReceived")

        Function("startListening") {
            if (listening) return@Function true
            val context = appContext.reactContext ?: return@Function false

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
                context.registerReceiver(smsReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(smsReceiver, filter)
            }

            listening = true
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
            listening = false
            true
        }

        Function("isListening") {
            listening
        }

        OnDestroy {
            if (listening) {
                val context = appContext.reactContext
                smsReceiver?.let {
                    try {
                        context?.unregisterReceiver(it)
                    } catch (_: Exception) {}
                }
                smsReceiver = null
                listening = false
            }
        }
    }
}
