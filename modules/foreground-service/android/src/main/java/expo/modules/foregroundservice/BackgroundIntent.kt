package expo.modules.foregroundservice

import android.content.Context

/**
 * Whether the user has background sync switched on. Written by the JS side when it starts or
 * stops the service on the user's behalf; read by native recovery (boot, package update) that runs
 * before any JS exists. Kept apart from [ServiceStopRecord], which is cleared on every start.
 */
internal object BackgroundIntent {
    private const val FILE = "uc_background_intent"
    private const val KEY_ENABLED = "enabled"

    fun set(context: Context, enabled: Boolean) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun enabled(context: Context): Boolean =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)
}
