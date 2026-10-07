package expo.modules.ucengine

import android.content.Context
import android.os.BatteryManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Failure modes of docs/specs/006-android-power-metrics.md that the emulator cannot produce on demand. */
@RunWith(AndroidJUnit4::class)
class PowerMetricsRecorderTest {
  private lateinit var context: Context
  private lateinit var root: File

  @Before fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    root = File(context.cacheDir, "power-test-${UUID.randomUUID()}")
  }
  @After fun tearDown() { root.deleteRecursively() }

  private fun lines(): List<JSONObject> =
    File(root, "samples.jsonl").readLines().filter { it.isNotBlank() }.map(::JSONObject)

  private fun recorder(max: Int = 1500, burst: Int = 30, retentionMs: Long = 7L * 24 * 60 * 60 * 1000, reader: BatteryPropertyReader) =
    PowerMetricsRecorder(context, root, maxSamples = max, retentionMs = retentionMs, burstPerMinute = burst, batteryProperty = reader)

  @Test fun missingSensorIsUnavailableNeverZero() {
    val r = recorder { Long.MIN_VALUE }
    r.record(PowerSampleReason.QUERY); assertTrue(r.flush())
    val dev = lines().single().getJSONObject("dev")
    for (key in listOf("chargeUah", "energyNwh", "currentNowUa", "currentAvgUa")) assertTrue("$key must be null", dev.isNull(key))
    assertEquals("unsupported", (r.snapshot()["sources"] as Map<*, *>)["chargeCounter"])
    r.close()
  }

  @Test fun permissionDeniedIsReportedPerSource() {
    val r = recorder { throw SecurityException("denied") }
    r.record(PowerSampleReason.QUERY); assertTrue(r.flush())
    assertTrue(lines().single().getJSONObject("dev").isNull("chargeUah"))
    assertEquals("denied", (r.snapshot()["sources"] as Map<*, *>)["chargeCounter"])
    r.close()
  }

  @Test fun impossibleZeroCounterIsAbsent() {
    val r = recorder { id -> if (id == BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER || id == BatteryManager.BATTERY_PROPERTY_ENERGY_COUNTER) 0L else 5L }
    r.record(PowerSampleReason.QUERY); assertTrue(r.flush())
    val dev = lines().single().getJSONObject("dev")
    assertTrue(dev.isNull("chargeUah")); assertTrue(dev.isNull("energyNwh")); assertEquals(5L, dev.getLong("currentNowUa"))
    r.close()
  }

  @Test fun flappingSourceIsRateLimitedAndCounted() {
    val r = recorder(burst = 10) { 1L }
    repeat(50) { r.record(PowerSampleReason.NETWORK_CHANGED) }
    assertTrue(r.flush())
    val written = lines()
    assertEquals(10, written.size)
    assertTrue(written.last().getJSONObject("cnt").getLong("droppedSamples") >= 0)
    r.record(PowerSampleReason.QUERY) // still rate limited, so the drop count must be visible in the snapshot
    assertTrue((r.snapshot()["droppedSamples"] as Long) >= 40)
    r.close()
  }

  @Test fun retentionKeepsNewestAndMarksTruncation() {
    val r = recorder(max = 20, burst = 1000) { 1L }
    repeat(60) { r.record(PowerSampleReason.QUERY) }
    assertTrue(r.flush())
    val written = lines()
    assertTrue(written.size <= 22)
    assertTrue(written.first().optBoolean("trunc"))
    assertEquals(written.map { it.getLong("seq") }, written.map { it.getLong("seq") }.sorted())
    assertEquals(59L, written.last().getLong("seq"))
    r.close()
  }

  @Test fun ageCutoffNeverErasesTheNewestSamples() {
    // A clock set far forward makes every sample look old; compaction must still bound the file and keep the newest.
    val r = recorder(max = 20, burst = 1000, retentionMs = 1L) { 1L }
    repeat(60) { r.record(PowerSampleReason.QUERY) }
    assertTrue(r.flush())
    val written = lines()
    assertTrue("file must stay bounded, was ${written.size}", written.size <= 22)
    assertEquals(59L, written.last().getLong("seq"))
    r.close()
  }

  @Test fun resetReportsFailureWhenTheFileCannotBeDeleted() {
    val r = recorder { 1L }
    r.record(PowerSampleReason.QUERY); assertTrue(r.flush())
    val target = File(root, "samples.jsonl")
    target.delete(); target.mkdirs() // a non-empty directory in place of the file cannot be deleted as a file
    File(target, "keep").writeText("x")
    assertFalse(r.reset())
    r.close()
  }

  @Test fun resetLeavesOneResetSampleAndNoOlderHistory() {
    val r = recorder { 1L }
    repeat(5) { r.record(PowerSampleReason.QUERY) }
    assertTrue(r.flush())
    assertTrue(r.reset()); assertTrue(r.flush())
    val written = lines()
    assertEquals(listOf("reset"), written.map { it.getString("reason") })
    r.close()
  }

  @Test fun samplesCarryOnlyTheClosedSchema() {
    val r = recorder { 1L }
    r.record(PowerSampleReason.QUERY); assertTrue(r.flush())
    val allowed = setOf("v", "seq", "reason", "wallMs", "elapsedMs", "uptimeMs", "epoch", "ctx", "dev", "app", "cnt", "self", "trunc", "prevExit")
    assertTrue(allowed.containsAll(lines().single().keys().asSequence().toSet()))
    r.close()
  }
}
