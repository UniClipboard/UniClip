package expo.modules.ucengine

import android.content.Context
import uniffi.uc_engine_uniffi.BindingHostDiagnosticEvent
import uniffi.uc_engine_uniffi.BindingHostDiagnosticSource
import uniffi.uc_engine_uniffi.BindingHostLifecycleState

object BackgroundServiceDiagnostics {
  private val source = BindingHostDiagnosticSource.BACKGROUND_SERVICE

  fun started(context: Context) {
    EngineDiagnosticBridge.register(source)
    EngineDiagnosticBridge.record(
      BindingHostDiagnosticEvent.Lifecycle(BindingHostLifecycleState.BACKGROUND),
      source
    )
    record(context, NativeDiagnosticEvent.BACKGROUND_SERVICE_STARTED, NativeDiagnosticTrigger.USER_REQUEST)
    powerService(context, true)
  }

  private fun powerService(context: Context, running: Boolean) {
    runCatching { AndroidPowerMetrics.get(context).setServiceRunning(running) }
  }

  fun systemRestarted(context: Context) = record(
    context,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_SYSTEM_RESTART,
    NativeDiagnosticTrigger.SYSTEM_RESTART
  )

  fun stoppedPermanently(context: Context) = stopped(context, NativeDiagnosticTrigger.USER_REQUEST)

  /** The notification's Pause action: a policy pause the user chose, distinct from a fault. */
  fun stoppedTemporarily(context: Context) = stopped(context, NativeDiagnosticTrigger.USER_PAUSE)

  fun timedOut(context: Context) = stopped(
    context,
    NativeDiagnosticTrigger.SYSTEM_TIMEOUT,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_TIMED_OUT
  )

  fun taskRemoved(context: Context) = stopped(
    context,
    NativeDiagnosticTrigger.TASK_REMOVED,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_TASK_REMOVED
  )

  /** An auxiliary task (quick action, restart prompt) ended; the service keeps running. */
  fun auxTaskRemoved(context: Context) = record(
    context,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_AUX_TASK_REMOVED,
    NativeDiagnosticTrigger.TASK_REMOVED
  )

  /** The system refused the foreground start (background start restriction, missing permission). */
  fun startDenied(context: Context) = record(
    context,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_START_DENIED,
    NativeDiagnosticTrigger.SYSTEM_POLICY,
    NativeDiagnosticOutcome.FAILED
  )

  /**
   * Native recovery after a reboot or app update. A prompt means the one-tap resume notification
   * was posted; a skip means the user's own stop, disabled state or a missing permission applies.
   */
  fun recoveryDecision(context: Context, trigger: String, prompted: Boolean) = record(
    context,
    if (prompted) NativeDiagnosticEvent.BACKGROUND_SERVICE_RECOVERY_PROMPTED
    else NativeDiagnosticEvent.BACKGROUND_SERVICE_RECOVERY_SKIPPED,
    if (trigger == "boot") NativeDiagnosticTrigger.SYSTEM_BOOT else NativeDiagnosticTrigger.PACKAGE_REPLACED
  )

  fun destroyed(context: Context, expected: Boolean) {
    powerService(context, false)
    record(
      context,
      NativeDiagnosticEvent.BACKGROUND_SERVICE_DESTROYED,
      NativeDiagnosticTrigger.CONTEXT_DESTROYED,
      if (expected) NativeDiagnosticOutcome.SUCCEEDED else NativeDiagnosticOutcome.FAILED
    )
  }

  private fun stopped(
    context: Context,
    trigger: NativeDiagnosticTrigger,
    event: NativeDiagnosticEvent = NativeDiagnosticEvent.BACKGROUND_SERVICE_STOPPED
  ) {
    EngineDiagnosticBridge.record(BindingHostDiagnosticEvent.OwnershipReleased, source)
    record(context, event, trigger, NativeDiagnosticOutcome.SUCCEEDED)
    powerService(context, false)
  }

  private fun record(
    context: Context,
    event: NativeDiagnosticEvent,
    trigger: NativeDiagnosticTrigger,
    outcome: NativeDiagnosticOutcome = NativeDiagnosticOutcome.OBSERVED
  ) {
    AndroidNativeDiagnostics.get(context).record(event, trigger, outcome)
  }
}
