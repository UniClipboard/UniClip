package expo.modules.foregroundservice

import android.content.Context

/**
 * The last reason the background service stopped, kept across process death so the next launch can
 * say why sync is not running instead of guessing. One small record; the journal keeps the history.
 */
internal object ServiceStopRecord {
    const val USER_STOP = "user_stop"
    const val USER_PAUSE = "user_pause"
    const val TASK_REMOVED = "task_removed"
    const val SYSTEM_TIMEOUT = "system_timeout"
    const val START_DENIED = "start_denied"
    const val SYSTEM_RESTART = "system_restart"
    const val POLICY = "policy"
    const val RUNTIME_STOP = "runtime_stop"

    /** Stops the user chose; recovery after a reboot must respect them. */
    val USER_CHOSEN = setOf(USER_STOP, USER_PAUSE, TASK_REMOVED, POLICY)

    private const val FILE = "uc_background_service"
    private const val KEY_REASON = "last_stop_reason"
    private const val KEY_AT = "last_stop_at"

    fun write(context: Context, reason: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(KEY_REASON, reason)
            .putLong(KEY_AT, System.currentTimeMillis())
            .apply()
    }

    /** Cleared when the service enters the foreground, so a stale reason never describes a running service. */
    fun clear(context: Context) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun read(context: Context): Map<String, Any?> {
        val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        return mapOf(
            "lastStopReason" to preferences.getString(KEY_REASON, null),
            "lastStopAt" to preferences.getLong(KEY_AT, 0L).takeIf { it > 0L }
        )
    }
}
