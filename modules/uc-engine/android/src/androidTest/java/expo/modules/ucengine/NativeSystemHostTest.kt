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
}
