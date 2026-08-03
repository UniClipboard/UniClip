package expo.modules.ucengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.uc_engine_uniffi.BindingAnalyticsEvent
import uniffi.uc_engine_uniffi.BindingAnalyticsGroupIdentify
import uniffi.uc_engine_uniffi.BindingAnalyticsHostException
import uniffi.uc_engine_uniffi.BindingAnalyticsIdentify

@RunWith(AndroidJUnit4::class)
class NativeAnalyticsHostTest {
  private lateinit var context: Context
  private lateinit var preferencesName: String
  private lateinit var queueDirectory: File

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    preferencesName = "native-analytics-test-${UUID.randomUUID()}"
    queueDirectory = File(context.cacheDir, preferencesName)
  }

  @After
  fun tearDown() {
    context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE).edit().clear().commit()
    queueDirectory.deleteRecursively()
  }

  @Test
  fun identitiesPersistAcrossHostInstances() {
    val first = host()
    first.capture(BindingAnalyticsEvent("app_opened", "{}"))
    val firstBody = bodies().single()
    first.setConsentEnabled(false)
    first.setConsentEnabled(true)

    val second = host()
    second.capture(BindingAnalyticsEvent("app_opened", "{}"))
    val secondBody = bodies().single()

    assertEquals(firstBody.getString("distinct_id"), secondBody.getString("distinct_id"))
    assertEquals(
      firstBody.getJSONObject("properties").getString("analytics_device_id"),
      secondBody.getJSONObject("properties").getString("analytics_device_id")
    )
  }

  @Test
  fun consentStopsCaptureAndClearsPendingEvents() {
    val host = host()
    host.capture(BindingAnalyticsEvent("app_opened", "{}"))
    assertEquals(1, bodies().size)

    host.setConsentEnabled(false)
    assertTrue(bodies().isEmpty())
    host.capture(BindingAnalyticsEvent("app_opened", "{}"))
    assertTrue(bodies().isEmpty())
  }

  @Test
  fun resetRotatesIdentityWithoutEnqueuingAnAlias() {
    val host = host()
    val adopted = UUID.randomUUID().toString()
    host.adoptSpacePerson(adopted)
    host.capture(BindingAnalyticsEvent("app_opened", "{}"))
    val previousDistinctId = bodies().single().getString("distinct_id")

    host.resetAndIdentify()

    assertTrue(bodies().isEmpty())
    assertNull(host.currentSpacePersonId())
    host.capture(BindingAnalyticsEvent("app_opened", "{}"))
    assertNotEquals(previousDistinctId, bodies().single().getString("distinct_id"))
    assertEquals(1, bodies().size)
  }

  @Test
  fun identifyGroupAndCaptureRemainOrderedAndDeduplicated() {
    val host = host()
    host.identify(BindingAnalyticsIdentify(
      UUID.randomUUID().toString(),
      UUID.randomUUID().toString(),
      "{}",
      "{}"
    ))
    host.groupIdentify(BindingAnalyticsGroupIdentify(
      "space",
      "0123456789abcdef",
      "{\"device_count\":2}"
    ))
    host.capture(BindingAnalyticsEvent("sync_succeeded", "{\"direction\":\"outbound\"}"))

    val bodies = bodies()
    assertEquals(listOf("${'$'}identify", "${'$'}groupidentify", "sync_succeeded"),
      bodies.map { it.getString("event") })
    bodies.forEach { body ->
      assertNotNull(body.getJSONObject("properties").getString("${'$'}insert_id"))
    }
    val capture = bodies.last().getJSONObject("properties")
    assertEquals("1.2.3", capture.getString("app_version"))
    assertTrue(capture.getBoolean("${'$'}geoip_disable"))
  }

  @Test
  fun sensitivePropertiesAndPathValuesAreRejected() {
    val host = host()
    assertDeliveryFailure {
      host.capture(BindingAnalyticsEvent("sync_succeeded", "{\"device_name\":\"Private Phone\"}"))
    }
    assertDeliveryFailure {
      host.capture(BindingAnalyticsEvent("sync_succeeded", "{\"value\":\"content://private/file\"}"))
    }
    assertTrue(bodies().isEmpty())
  }

  private fun host() = AndroidPostHogAnalyticsHost(
    context = context,
    appVersion = "1.2.3",
    preferencesName = preferencesName,
    queueDirectoryOverride = queueDirectory,
    projectKeyOverride = "phc_native_test",
    endpoint = "http://127.0.0.1:1/i/v0/e/"
  )

  private fun bodies(): List<JSONObject> = queueDirectory.listFiles { file -> file.extension == "json" }
    ?.sortedBy { it.name }
    ?.map { JSONObject(it.readText()) }
    .orEmpty()

  private fun assertDeliveryFailure(operation: () -> Unit) {
    var failure: Throwable? = null
    try {
      operation()
    } catch (error: Throwable) {
      failure = error
    }
    assertTrue(failure is BindingAnalyticsHostException.DeliveryFailed)
  }
}
