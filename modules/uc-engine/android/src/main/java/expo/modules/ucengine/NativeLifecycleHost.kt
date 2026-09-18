package expo.modules.ucengine

internal enum class EngineLifecycleState {
  RUNNING,
  QUIESCING,
  QUIESCED,
  SUSPENDED,
  SHUTTING_DOWN,
  STOPPED
}

internal data class EngineSessionRecovery(val unlocked: Boolean, val resumed: Boolean)

internal interface EngineLifecycle {
  val isStartupLifecycle: Boolean get() = false
  fun recoverSession(): EngineSessionRecovery
  fun lifecycleState(): EngineLifecycleState
  fun suspend(deadlineMs: ULong)
  fun resume()
}

internal class NativeLifecycleHost(private val report: (Throwable) -> Unit) {
  companion object {
    private const val BACKGROUND_SUSPEND_DEADLINE_MS = 2_000L
  }
  private var appIsBackground = false
  private var backgroundSyncEnabled = false

  fun prepare(engine: EngineLifecycle) {
    val recovery = engine.recoverSession()
    check(!recovery.unlocked || recovery.resumed) { "P2P session did not resume after unlock" }
  }

  @Synchronized
  fun setBackgroundSyncEnabled(
    engine: EngineLifecycle?,
    enabled: Boolean,
    isBackground: Boolean
  ) {
    backgroundSyncEnabled = enabled
    appIsBackground = isBackground
    applyBackgroundPolicy(engine)
  }

  @Synchronized
  fun enterBackground(engine: EngineLifecycle?) {
    appIsBackground = true
    applyBackgroundPolicy(engine)
  }

  @Synchronized
  fun enterForeground(engine: EngineLifecycle?) {
    appIsBackground = false
    if (engine == null) return
    try {
      if (engine.isStartupLifecycle || engine.lifecycleState() == EngineLifecycleState.SUSPENDED) {
        engine.resume()
      }
    } catch (error: Throwable) {
      report(error)
    }
  }

  private fun applyBackgroundPolicy(engine: EngineLifecycle?) {
    if (engine == null || !appIsBackground) return
    try {
      if (backgroundSyncEnabled) {
        if (engine.isStartupLifecycle || engine.lifecycleState() == EngineLifecycleState.SUSPENDED) {
          engine.resume()
        }
        return
      }

      if (engine.isStartupLifecycle) {
        engine.suspend(BACKGROUND_SUSPEND_DEADLINE_MS.toULong())
        return
      }
      when (engine.lifecycleState()) {
        EngineLifecycleState.RUNNING,
        EngineLifecycleState.QUIESCED -> engine.suspend(BACKGROUND_SUSPEND_DEADLINE_MS.toULong())
        EngineLifecycleState.QUIESCING,
        EngineLifecycleState.SUSPENDED,
        EngineLifecycleState.SHUTTING_DOWN,
        EngineLifecycleState.STOPPED -> Unit
      }
    } catch (error: Throwable) {
      report(error)
    }
  }
}
