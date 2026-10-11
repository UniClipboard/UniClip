package expo.modules.ucengine

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What the app's own access path (overlay focus, Shizuku) read for one clipboard change. */
internal data class CapturedClipboard(
  val text: String?,
  val fileUri: String?,
  val mimeType: String?,
  val displayName: String?
)

/**
 * A background app cannot read the system clipboard through the plain ClipboardManager, so the Engine
 * host must not read it again for a change the app has already captured through its privileged path.
 * The capture is visible to the host's clipboard read only while one observation runs; observations
 * are serialised so a second capture can never be read in place of the first.
 */
internal object CapturedClipboardHandoff {
  private val lock = ReentrantLock()
  @Volatile private var staged: CapturedClipboard? = null

  fun <T> whileStaged(captured: CapturedClipboard?, observation: () -> T): T = lock.withLock {
    staged = captured
    try {
      observation()
    } finally {
      staged = null
    }
  }

  fun current(): CapturedClipboard? = staged
}
