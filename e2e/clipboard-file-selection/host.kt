import java.io.File
import java.util.UUID
import org.json.JSONObject

// API doubles backed by real temporary files. No Android system service runs.
class Uri(val value: String, val file: File? = null) {
  val scheme get() = runCatching { java.net.URI(value).scheme }.getOrNull()
  val path get() = file?.path ?: runCatching { java.net.URI(value).path }.getOrNull()
  companion object { fun parse(value: String) = Uri(value) }
}
class Resolver {
  fun openInputStream(uri: Uri) = uri.file?.inputStream()
}
class Context(val filesDir: File, val cacheDir: File) {
  val packageName = "isolated.clipboard.replay"
  val contentResolver = Resolver()
}
object FileProvider {
  fun getUriForFile(context: Context, authority: String, file: File) = Uri("content://$authority/${file.name}", file)
}
class ClipData(val item: Item) {
  class Item(val uri: Uri? = null, val text: String? = null)
  fun getItemAt(index: Int): Item { check(index == 0); return item }
  companion object {
    fun newUri(resolver: Resolver, name: String, uri: Uri) = ClipData(Item(uri = uri))
    fun newPlainText(label: String, text: String) = ClipData(Item(text = text))
  }
}
class MimeTypeMap {
  fun getExtensionFromMimeType(mime: String?) = if (mime == "text/html") "html" else null
  companion object { fun getSingleton() = MimeTypeMap() }
}
sealed class HostBindingException: RuntimeException() {
  class Io: HostBindingException()
  class Unavailable: HostBindingException()
  class InvalidHandle: HostBindingException()
}
sealed class BindingClipboardRepresentation {
  data class Inline(val format: String, val mimeType: String?, val bytes: ByteArray): BindingClipboardRepresentation()
  data class File(val format: String, val handle: String, val displayName: String, val mimeType: String?, val sizeBytes: ULong): BindingClipboardRepresentation()
}
class FileHandleRegistry(val handles: Map<String, Uri> = emptyMap()) {
  fun uri(handle: String) = handles[handle] ?: throw HostBindingException.InvalidHandle()
}
// PRODUCTION_FUNCTIONS
fun main(args: Array<String>) {
  val root = File(args[0]).also { it.mkdirs() }
  val context = Context(File(root, "files").also { it.mkdirs() }, File(root, "cache").also { it.mkdirs() })
  val source = File(context.filesDir, "00000000")
  val expected = ByteArray(793) { (it % 239).toByte() }
  source.writeBytes(expected)
  val files = FileHandleRegistry(mapOf("valid" to Uri("file://${source.path}", source)))
  fun inline(format: String, mime: String?, value: String) = BindingClipboardRepresentation.Inline(format, mime, value.toByteArray())
  val text = inline("text/plain", "text/plain", "/sender/private/path.txt")
  val file = inline("files", "text/uri-list", source.toURI().toString())
  val mimeOnly = inline("text/uri-list", "text/uri-list", source.toURI().toString())
  val metadata = inline(FILE_DISPLAY_METADATA_FORMAT, FILE_DISPLAY_METADATA_MIME, """{"files":[{"storage_name":"00000000","display_name":"原始文件.txt"}]}""")
  val missing = inline("files", "text/uri-list", File(context.filesDir, "missing").toURI().toString())
  val directory = inline("files", "text/uri-list", context.filesDir.toURI().toString())
  val remote = inline("files", "text/uri-list", "https://example.invalid/file")
  val outside = File(root, "outside.bin").also { it.writeBytes(expected) }
  val link = File(context.filesDir, "escape-link")
  link.delete()
  java.nio.file.Files.createSymbolicLink(link.toPath(), outside.toPath())
  val escaped = inline("files", "text/uri-list", link.toURI().toString())
  val malformed = inline("files", "text/uri-list", "not a file URL")
  val handle = BindingClipboardRepresentation.File("application/octet-stream", "valid", "原始文件.txt", null, 793uL)
  val results = mutableListOf<Map<String, Any>>()
  fun run(name: String, reps: List<BindingClipboardRepresentation>, assertion: (ClipData) -> Boolean) {
    try { results += mapOf("case" to name, "passed" to assertion(clipDataForSnapshot(context, files, reps))) }
    catch (e: Exception) { results += mapOf("case" to name, "passed" to false, "error" to e.toString()) }
  }
  fun checkFile(clip: ClipData): Boolean {
    val uri = clip.getItemAt(0).uri ?: return false
    return uri.file?.name == "原始文件.txt" && context.contentResolver.openInputStream(uri)?.use { it.readBytes() }?.contentEquals(expected) == true
  }
  run("text-first-bytes-and-filename", listOf(metadata, text, file), ::checkFile)
  run("file-first-bytes-and-filename", listOf(file, text, metadata), ::checkFile)
  run("handle-after-text", listOf(text, handle), ::checkFile)
  run("mime-only-file", listOf(text, mimeOnly, metadata), ::checkFile)
  run("missing-before-valid", listOf(missing, text, file, metadata), ::checkFile)
  for ((name, reps) in listOf("text-only" to listOf(text), "symlink-escape-text-fallback" to listOf(escaped, text), "malformed-file-text-fallback" to listOf(malformed, text), "missing-file-text-fallback" to listOf(missing, text), "directory-text-fallback" to listOf(directory, text), "remote-uri-text-fallback" to listOf(remote, text))) {
    run(name, reps) { it.getItemAt(0).text == "/sender/private/path.txt" && it.getItemAt(0).uri == null }
  }
  val html = "<p>中文</p>"
  run("rich-text-fallback-preserved", listOf(inline("text/html", "text/html", html), text)) {
    it.getItemAt(0).uri?.let { uri -> context.contentResolver.openInputStream(uri)?.use { stream -> stream.readBytes().contentEquals(html.toByteArray()) } } == true
  }
  run("metadata-only", listOf(metadata)) { it.getItemAt(0).text == "" }
  for ((name, candidate) in listOf("unsupported-file-only" to remote, "missing-file-only" to missing, "invalid-handle" to handle.copy(handle = "invalid"))) {
    try { clipDataForSnapshot(context, files, listOf(candidate)); results += mapOf("case" to name, "passed" to false) }
    catch (e: HostBindingException) { results += mapOf("case" to name, "passed" to true) }
  }
  println(org.json.JSONArray(results).toString(2))
  if (results.any { it["passed"] != true }) kotlin.system.exitProcess(1)
}
