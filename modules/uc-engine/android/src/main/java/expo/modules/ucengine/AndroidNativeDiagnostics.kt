package expo.modules.ucengine

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.os.Build
import java.io.File
import uniffi.uc_engine_uniffi.BindingException

/** Process-owned capture continues while the React runtime is unavailable. */
internal object AndroidNativeDiagnostics {
  private var journal: NativeRuntimeDiagnostics? = null
  private var callback: ConnectivityManager.NetworkCallback? = null

  @Synchronized fun get(context: Context): NativeRuntimeDiagnostics {
    journal?.let { return it }
    val application = context.applicationContext
    val info = runCatching { application.packageManager.getPackageInfo(application.packageName, 0) }.getOrNull()
    val build = info?.let {
      if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString()
      else @Suppress("DEPRECATION") it.versionCode.toString()
    } ?: "unknown"
    val directory = runCatching { application.cacheDir?.let { File(it, "uc-engine/logs") } }.getOrNull()
    val created = NativeRuntimeDiagnostics(directory, info?.versionName ?: "unknown", build)
    journal = created
    runCatching { observeNetwork(application, created) }.onFailure {
      created.record(NativeDiagnosticEvent.NETWORK_OBSERVATION, NativeDiagnosticTrigger.APP_STARTUP,
        NativeDiagnosticOutcome.FAILED, failure(it))
    }
    return created
  }

  fun failure(error: Throwable): NativeDiagnosticFailure = when (error) {
    is BindingException.Engine -> NativeDiagnosticFailure(NativeDiagnosticFailureReason.ENGINE_FAILURE, error.code.toLong(), error.retryable)
    is SecurityException -> NativeDiagnosticFailure(NativeDiagnosticFailureReason.PERMISSION_DENIED)
    else -> NativeDiagnosticFailure(NativeDiagnosticFailureReason.NATIVE_FAILURE)
  }

  fun <T> observe(journal: NativeRuntimeDiagnostics, event: NativeDiagnosticEvent,
                  trigger: NativeDiagnosticTrigger = NativeDiagnosticTrigger.UNSPECIFIED, block: () -> T): T {
    val observation = journal.begin(event, trigger)
    return try {
      block().also { journal.finish(observation, NativeDiagnosticOutcome.SUCCEEDED) }
    } catch (error: Throwable) {
      journal.finish(observation, NativeDiagnosticOutcome.FAILED, failure(error))
      throw error
    }
  }

  private fun observeNetwork(context: Context, journal: NativeRuntimeDiagnostics) {
    val manager = context.getSystemService(ConnectivityManager::class.java)
    if (manager == null) {
      journal.record(NativeDiagnosticEvent.NETWORK_OBSERVATION, NativeDiagnosticTrigger.APP_STARTUP,
        NativeDiagnosticOutcome.FAILED, NativeDiagnosticFailure(NativeDiagnosticFailureReason.NATIVE_FAILURE))
      return
    }
    var previous: NativeDiagnosticNetwork? = null
    var previousNetwork: Network? = null
    var previousProperties: LinkProperties? = null
    fun capture(force: NativeDiagnosticNetwork.Change? = null) {
      val currentNetwork = manager.activeNetwork
      val capabilities = currentNetwork?.let { manager.getNetworkCapabilities(it) }
      val next = NativeDiagnosticNetwork(
        available = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
        kind = when {
          capabilities == null -> NativeDiagnosticNetwork.Kind.NONE
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NativeDiagnosticNetwork.Kind.WIFI
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NativeDiagnosticNetwork.Kind.CELLULAR
          capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NativeDiagnosticNetwork.Kind.WIRED
          else -> NativeDiagnosticNetwork.Kind.OTHER
        },
        expensive = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
      )
      synchronized(this) {
        if (next == previous && currentNetwork == previousNetwork && force == null) return
        val change = if (previous == null) NativeDiagnosticNetwork.Change.INITIAL
          else force ?: if (currentNetwork != previousNetwork) NativeDiagnosticNetwork.Change.DEFAULT_NETWORK
          else NativeDiagnosticNetwork.Change.CAPABILITIES
        if (currentNetwork != previousNetwork) previousProperties = null
        previousNetwork = currentNetwork
        previous = next
        journal.record(NativeDiagnosticEvent.NETWORK_CHANGED, NativeDiagnosticTrigger.NETWORK_CHANGE, network = next.copy(change = change))
      }
    }
    fun report(error: Throwable) {
      journal.record(NativeDiagnosticEvent.NETWORK_OBSERVATION, NativeDiagnosticTrigger.NETWORK_CHANGE,
        NativeDiagnosticOutcome.FAILED, failure(error))
    }
    val observer = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) { runCatching { capture() }.onFailure(::report) }
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { runCatching { capture() }.onFailure(::report) }
      override fun onLost(network: Network) { runCatching { capture() }.onFailure(::report) }
      override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
        runCatching {
          if (network != manager.activeNetwork) return
          val changed = synchronized(AndroidNativeDiagnostics) {
            val changed = previousProperties != null && previousProperties != properties
            previousProperties = properties
            changed
          }
          if (changed) capture(NativeDiagnosticNetwork.Change.PROPERTIES)
        }.onFailure(::report)
      }
    }
    try {
      manager.registerDefaultNetworkCallback(observer)
      callback = observer
      capture()
      journal.record(NativeDiagnosticEvent.NETWORK_OBSERVATION, NativeDiagnosticTrigger.APP_STARTUP, NativeDiagnosticOutcome.SUCCEEDED)
    } catch (error: Exception) {
      journal.record(NativeDiagnosticEvent.NETWORK_OBSERVATION, NativeDiagnosticTrigger.APP_STARTUP,
        NativeDiagnosticOutcome.FAILED, failure(error))
    }
  }
}
