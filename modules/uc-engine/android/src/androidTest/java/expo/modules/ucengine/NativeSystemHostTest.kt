package expo.modules.ucengine

import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.util.Base64
import java.io.File
import java.security.ProviderException
import java.security.MessageDigest
import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.uc_engine_uniffi.HostBindingException

@RunWith(AndroidJUnit4::class)
class NativeSystemHostTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

  @Test
  fun keystoreRoundTripUsesAndroidKeystore() {
    val storage = KeystoreSecureStorage(context)
    val key = "instrumentation-${UUID.randomUUID()}"
    val value = "android-keystore-value".toByteArray()

    assertNull(storage.get(key))
    storage.set(key, value)
    assertArrayEquals(value, storage.get(key))
    storage.delete(key)
    assertNull(storage.get(key))
  }

  @Test
  fun keystoreUnavailableDuringReadReturnsStableFailure() {
    val key = "instrumentation-${UUID.randomUUID()}"
    val writer = KeystoreSecureStorage(context)
    writer.set(key, "encrypted-value".toByteArray())
    val unavailable = KeystoreSecureStorage(context) {
      throw ProviderException("AndroidKeyStore unavailable")
    }

    assertThrows(HostBindingException.Unavailable::class.java) { unavailable.get(key) }
    writer.delete(key)
  }

  @Test
  fun corruptEncryptedPayloadRemainsIoFailure() {
    val key = "instrumentation-${UUID.randomUUID()}"
    val storageId = Base64.encodeToString(
      MessageDigest.getInstance("SHA-256").digest(key.toByteArray()),
      Base64.NO_WRAP or Base64.URL_SAFE
    )
    val preferences = context.getSharedPreferences("uc_engine_secure", android.content.Context.MODE_PRIVATE)
    check(
      preferences.edit()
        .putString(storageId, Base64.encodeToString(byteArrayOf(1, 0, 1), Base64.NO_WRAP))
        .commit()
    )

    assertThrows(HostBindingException.Io::class.java) {
      KeystoreSecureStorage(context).get(key)
    }
    check(preferences.edit().remove(storageId).commit())
  }

  @Test
  fun outputContentUriWritesAndReadsBackIdenticalContent() {
    val destination = File(
      context.cacheDir,
      "uc-engine-clipboard/host-tests/${UUID.randomUUID()}/export.bin"
    )
    check(destination.parentFile?.mkdirs() == true)
    check(destination.createNewFile())
    destination.deleteOnExit()
    val uri = FileProvider.getUriForFile(
      context,
      "${context.packageName}.ucengine.files",
      destination
    )
    val files = FileHandleRegistry(context)
    val handle = files.register(uri.toString(), true)
    val expected = ByteArray(32_769) { (it % 251).toByte() }

    files.write(handle, 0, expected.copyOfRange(0, 16_384))
    files.write(handle, 16_384, expected.copyOfRange(16_384, expected.size))
    files.finishWrite(handle)

    assertArrayEquals(expected, files.read(handle, 0, expected.size + 1))
    assertArrayEquals(expected, destination.readBytes())
    assertFalse(handle.contains(destination.absolutePath))
  }

  @Test
  fun lifecycleHostRecoversPersistedSessionBeforeUse() {
    val engine = FakeEngineLifecycle(EngineLifecycleState.RUNNING).apply {
      recovery = EngineSessionRecovery(unlocked = true, resumed = true)
    }
    val host = NativeLifecycleHost { throw AssertionError("Recovery must not be reported") }

    host.prepare(engine)

    assertEquals(1, engine.recoverCalls)
  }

  @Test
  fun lifecycleHostForwardsOnlyLegalSystemTransitions() {
    val engine = FakeEngineLifecycle(EngineLifecycleState.RUNNING)
    val host = NativeLifecycleHost { throw AssertionError("Transition must not fail") }

    host.enterForeground(engine)
    host.enterBackground(engine)
    engine.state = EngineLifecycleState.SUSPENDED
    host.enterForeground(engine)

    assertEquals(1, engine.suspendCalls)
    assertEquals(1, engine.resumeCalls)
  }

  @Test
  fun lifecycleHostReportsTransitionFailures() {
    val engine = FakeEngineLifecycle(EngineLifecycleState.RUNNING).apply {
      transitionError = IllegalStateException("failed")
    }
    var reported: Throwable? = null
    val host = NativeLifecycleHost { reported = it }

    host.enterBackground(engine)

    assertNotNull(reported)
  }
}

private class FakeEngineLifecycle(var state: EngineLifecycleState) : EngineLifecycle {
  var recovery = EngineSessionRecovery(unlocked = false, resumed = false)
  var transitionError: Throwable? = null
  var recoverCalls = 0
  var suspendCalls = 0
  var resumeCalls = 0

  override fun recoverSession(): EngineSessionRecovery {
    recoverCalls += 1
    return recovery
  }

  override fun lifecycleState(): EngineLifecycleState = state

  override fun suspend() {
    suspendCalls += 1
    transitionError?.let { throw it }
  }

  override fun resume() {
    resumeCalls += 1
    transitionError?.let { throw it }
  }
}
