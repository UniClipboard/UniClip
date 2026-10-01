package expo.modules.smsverificationcode

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * The user's manual opt-in for copying codes from incoming SMS. Off by default.
 *
 * The receiver component stays disabled until the switch is on, and the receiver re-checks
 * both the stored choice and the runtime permission on every broadcast, so revoking
 * RECEIVE_SMS in system settings effectively turns the feature off.
 */
object SmsCodeAutoCopy {
    private const val PREFS = "sms_code_auto_copy"
    private const val KEY_ENABLED = "enabled"

    fun hasReceivePermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /** True only when the user switched it on and the permission is still granted. */
    fun isActive(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, false) && hasReceivePermission(context)

    /** Returns false (and stays off) when enabling without the SMS permission. */
    fun setEnabled(context: Context, enabled: Boolean): Boolean {
        val effective = enabled && hasReceivePermission(context)
        prefs(context).edit().putBoolean(KEY_ENABLED, effective).apply()
        context.packageManager.setComponentEnabledSetting(
            ComponentName(context, SmsCodeReceiver::class.java),
            if (effective) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
        return effective == enabled
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
