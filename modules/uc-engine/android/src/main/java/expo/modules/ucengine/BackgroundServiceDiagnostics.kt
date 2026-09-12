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
  }

  fun systemRestarted(context: Context) = record(
    context,
    NativeDiagnosticEvent.BACKGROUND_SERVICE_SYSTEM_RESTART,
    NativeDiagnosticTrigger.SYSTEM_RESTART
  )

  fun stoppedPermanently(context: Context) = stopped(context, NativeDiagnosticTrigger.USER_REQUEST)

  fun stoppedTemporarily(context: Context) = stopped(context, NativeDiagnosticTrigger.USER_REQUEST)

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

  fun destroyed(context: Context, expected: Boolean) {
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
