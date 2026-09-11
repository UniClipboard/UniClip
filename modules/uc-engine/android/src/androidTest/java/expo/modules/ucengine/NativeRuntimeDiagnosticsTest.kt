package expo.modules.ucengine

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import android.net.Uri
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeRuntimeDiagnosticsTest {
  @Test fun recordsBoundariesAndBoundsRotation() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val root = File(context.cacheDir, "native-diagnostics-test-${UUID.randomUUID()}")
    val journal = NativeRuntimeDiagnostics(root, maxFileBytes = 1200, maxFiles = 2)
    try {
      val operation = journal.begin(NativeDiagnosticEvent.ENGINE_START, NativeDiagnosticTrigger.APP_STARTUP)
      journal.finish(operation, NativeDiagnosticOutcome.FAILED, NativeDiagnosticFailure(NativeDiagnosticFailureReason.ENGINE_FAILURE, 1214))
      assertTrue(journal.flush())
      val export = journal.exportSnapshot()
      @Suppress("UNCHECKED_CAST")
      val uris = export["fileUris"] as List<String>
      assertTrue(uris.isNotEmpty())
      assertTrue(uris.all { Uri.parse(it).scheme == "file" })
      val boundaries = journal.files().flatMap { it.readLines() }.map(::JSONObject)
        .filter { it.getString("event") == "engine.start" }
      assertEquals(2, boundaries.size)
      assertEquals(boundaries[0].getString("operationId"), boundaries[1].getString("operationId"))
      assertEquals(1214, boundaries[1].getJSONObject("failure").getInt("code"))
      assertFalse(boundaries.toString().contains(root.path))
      repeat(20) {
        journal.record(NativeDiagnosticEvent.APP_FOREGROUND, NativeDiagnosticTrigger.APP_FOREGROUND)
        assertTrue(journal.flush())
      }
      assertTrue(journal.files().size <= 2)
      assertTrue((journal.snapshot()["prunedFiles"] as Long) > 0)
    } finally { journal.close(); root.deleteRecursively() }
  }

  @Test fun unavailableStorageKeepsFixedFailureState() {
    val journal = NativeRuntimeDiagnostics(null)
    try {
      journal.record(NativeDiagnosticEvent.APP_BACKGROUND, NativeDiagnosticTrigger.APP_BACKGROUND)
      assertTrue(journal.flush())
      assertEquals("unavailable", journal.snapshot()["writerStatus"])
      assertTrue((journal.snapshot()["droppedRecords"] as Long) > 0)
      assertTrue(journal.files().isEmpty())
    } finally { journal.close() }
  }
}
