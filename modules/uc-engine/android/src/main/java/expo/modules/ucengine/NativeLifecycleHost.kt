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
  fun recoverSession(): EngineSessionRecovery
  fun lifecycleState(): EngineLifecycleState
  fun suspend()
  fun resume()
}

internal class NativeLifecycleHost(private val report: (Throwable) -> Unit) {
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
      if (engine.lifecycleState() == EngineLifecycleState.SUSPENDED) {
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
        if (engine.lifecycleState() == EngineLifecycleState.SUSPENDED) {
          engine.resume()
        }
        return
      }

      when (engine.lifecycleState()) {
        EngineLifecycleState.RUNNING,
        EngineLifecycleState.QUIESCED -> engine.suspend()
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
