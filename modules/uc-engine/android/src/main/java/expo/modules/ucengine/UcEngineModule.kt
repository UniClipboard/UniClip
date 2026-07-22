package expo.modules.ucengine

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import uniffi.uc_engine_uniffi.BindingClipboardRepresentation
import uniffi.uc_engine_uniffi.BindingClipboardRestoreMode
import uniffi.uc_engine_uniffi.BindingClipboardRestoreOutcome
import uniffi.uc_engine_uniffi.BindingClipboardSnapshot
import uniffi.uc_engine_uniffi.BindingConfig
import uniffi.uc_engine_uniffi.BindingEngineState
import uniffi.uc_engine_uniffi.BindingEvent
import uniffi.uc_engine_uniffi.BindingFailure
import uniffi.uc_engine_uniffi.BindingFileMetadata
import uniffi.uc_engine_uniffi.BindingHost
import uniffi.uc_engine_uniffi.HostBindingException
import uniffi.uc_engine_uniffi.MobileEngine
import uniffi.uc_engine_uniffi.SendReport
import uniffi.uc_engine_uniffi.coreVersion

class UcEngineModule : Module() {
  companion object {
    init {
      System.loadLibrary("uc_engine_uniffi")
    }

    @JvmStatic
    private external fun nativeInstallAndroidContext(context: Context): Boolean
  }

  private val lock = Any()
  private var engine: MobileEngine? = null
  private var files: FileHandleRegistry? = null

  override fun definition() = ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { config: Map<String, String> ->
      val context = requireContext()
      check(nativeInstallAndroidContext(context)) { "Failed to initialize the Android P2P runtime" }
      val registry = FileHandleRegistry(context)
      val started = MobileEngine.start(
        BindingConfig(
          config["appVersion"] ?: "unknown",
          config["profileId"] ?: "default"
        ),
        AndroidEngineHost(context, registry)
      )
      synchronized(lock) {
        if (engine != null) {
          started.close()
          throw UcEngineAlreadyStartedException()
        }
        files = registry
        engine = started
      }
    }

    AsyncFunction("shutdown") { deadlineMs: Long -> shutdown(deadlineMs) }
    AsyncFunction("suspend") { requireEngine().suspend() }
    AsyncFunction("resume") { requireEngine().resume() }

    AsyncFunction("createSpace") { deviceName: String?, passphrase: String ->
      val result = requireEngine().createSpace(deviceName, passphrase)
      mapOf(
        "spaceId" to result.spaceId,
        "selfDeviceId" to result.selfDeviceId,
        "identityFingerprint" to result.identityFingerprint
      )
    }
    AsyncFunction("issueInvitation") {
      val result = requireEngine().issueInvitation()
      mapOf("invitationCode" to result.invitationCode, "expiresAtMs" to result.expiresAtMs)
    }
    AsyncFunction("joinSpace") { invitationCode: String, deviceName: String?, passphrase: String ->
      val result = requireEngine().joinSpace(invitationCode, deviceName, passphrase)
      mapOf(
        "sponsorDeviceId" to result.sponsorDeviceId,
        "sponsorIdentityFingerprint" to result.sponsorIdentityFingerprint,
        "spaceId" to result.spaceId,
        "selfDeviceId" to result.selfDeviceId,
        "selfIdentityFingerprint" to result.selfIdentityFingerprint,
        "migratedRecords" to result.migratedRecords?.toLong()
      )
    }
    AsyncFunction("nextEvent") { timeoutMs: Long ->
      requireEngine().nextEvent(timeoutMs.toULong())?.let(::eventMap)
    }
    AsyncFunction("sendText") { text: String, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendText(text, targetDevices))
    }
    AsyncFunction("sendImage") { bytes: ByteArray, mimeType: String, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendImage(bytes, mimeType, targetDevices))
    }
    Function("registerInputFile") { uri: String -> requireFiles().register(uri, false) }
    Function("registerOutputFile") { uri: String -> requireFiles().register(uri, true) }
    Function("releaseFileHandle") { handle: String -> requireFiles().remove(handle) }
    AsyncFunction("sendFiles") { fileHandles: List<String>, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendFiles(fileHandles, targetDevices))
    }
    AsyncFunction("captureCurrentClipboard") { requireEngine().captureCurrentClipboard() }
    AsyncFunction("restoreClipboard") { entryId: String, mode: String ->
      restoreOutcome(requireEngine().restoreClipboard(entryId, restoreMode(mode)))
    }
    AsyncFunction("exportEntry") { entryId: String, destinationHandle: String ->
      requireEngine().exportEntry(entryId, destinationHandle)
    }

    OnActivityEntersBackground { runCatching { currentEngine()?.suspend() } }
    OnActivityEntersForeground { runCatching { currentEngine()?.resume() } }
    OnDestroy { runCatching { shutdown(2_000) } }
  }

  private fun requireContext(): Context =
    appContext.reactContext?.applicationContext ?: throw UcEngineUnavailableException()

  private fun currentEngine(): MobileEngine? = synchronized(lock) { engine }

  private fun requireEngine(): MobileEngine = currentEngine() ?: throw UcEngineNotStartedException()

  private fun requireFiles(): FileHandleRegistry =
    synchronized(lock) { files } ?: throw UcEngineNotStartedException()

  private fun shutdown(deadlineMs: Long) {
    val active: MobileEngine?
    val registry: FileHandleRegistry?
    synchronized(lock) {
      active = engine
      registry = files
      engine = null
      files = null
    }
    active?.shutdown(deadlineMs.toULong())
    active?.close()
    registry?.removeAll()
  }

  private fun sendReportMap(report: SendReport): Map<String, Any> = mapOf(
    "entryId" to report.entryId,
    "atMs" to report.atMs,
    "totalAccepted" to report.totalAccepted.toLong(),
    "totalDuplicate" to report.totalDuplicate.toLong(),
    "totalOffline" to report.totalOffline.toLong(),
    "totalErrored" to report.totalErrored.toLong(),
    "totalPending" to report.totalPending.toLong()
  )

  private fun failureMap(failure: BindingFailure): Map<String, Any> = mapOf(
    "code" to failure.code.toLong(),
    "category" to failure.category.name,
    "retryable" to failure.retryable
  )

  private fun eventMap(event: BindingEvent): Map<String, Any?> = when (event) {
    is BindingEvent.StateChanged -> mapOf(
      "type" to "stateChanged",
      "state" to stateName(event.state)
    )
    is BindingEvent.OperationFinished -> mapOf(
      "type" to "operationFinished",
      "operationId" to event.operationId,
      "terminal" to event.terminal.name,
      "failure" to event.failure?.let(::failureMap)
    )
    is BindingEvent.RefreshRequired -> mapOf(
      "type" to "refreshRequired",
      "reason" to event.reason.name
    )
    is BindingEvent.Fatal -> mapOf("type" to "fatal", "failure" to failureMap(event.failure))
    is BindingEvent.Changed -> mapOf("type" to "changed", "kind" to event.kind)
  }

  private fun stateName(state: BindingEngineState): String = when (state) {
    BindingEngineState.RUNNING -> "running"
    BindingEngineState.QUIESCING -> "quiescing"
    BindingEngineState.QUIESCED -> "quiesced"
    BindingEngineState.SUSPENDED -> "suspended"
    BindingEngineState.SHUTTING_DOWN -> "shuttingDown"
    BindingEngineState.STOPPED -> "stopped"
  }

  private fun restoreMode(value: String): BindingClipboardRestoreMode = when (value) {
    "plainText" -> BindingClipboardRestoreMode.PLAIN_TEXT
    "filePaths" -> BindingClipboardRestoreMode.FILE_PATHS
    else -> BindingClipboardRestoreMode.STANDARD
  }

  private fun restoreOutcome(value: BindingClipboardRestoreOutcome): String = when (value) {
    BindingClipboardRestoreOutcome.RESTORED -> "restored"
    BindingClipboardRestoreOutcome.PAYLOAD_UNAVAILABLE -> "payloadUnavailable"
    BindingClipboardRestoreOutcome.NOT_APPLICABLE -> "notApplicable"
  }
}

private class AndroidEngineHost(
  private val context: Context,
  private val files: FileHandleRegistry
) : BindingHost {
  private val secureStorage = KeystoreSecureStorage(context)

  override fun privateDataDirectory(): String = directory(context.filesDir, "uc-engine").absolutePath
  override fun cacheDirectory(): String = directory(context.cacheDir, "uc-engine").absolutePath
  override fun temporaryDirectory(): String = directory(context.cacheDir, "uc-engine-tmp").absolutePath

  override fun secureStorageGet(key: String): ByteArray? = secureStorage.get(key)
  override fun secureStorageSet(key: String, value: ByteArray) = secureStorage.set(key, value)
  override fun secureStorageDelete(key: String) = secureStorage.delete(key)
  override fun fileMetadata(handle: String): BindingFileMetadata = files.metadata(handle)
  override fun fileReadChunk(handle: String, offset: ULong, maxBytes: UInt): ByteArray =
    files.read(handle, offset.toLong(), maxBytes.toInt())
  override fun fileWriteChunk(handle: String, offset: ULong, bytes: ByteArray) =
    files.write(handle, offset.toLong(), bytes)
  override fun fileFinishWrite(handle: String) = files.finishWrite(handle)

  override fun clipboardRead(): BindingClipboardSnapshot {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
      ?: throw HostBindingException.Unavailable()
    try {
      val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
        ?: return BindingClipboardSnapshot(System.currentTimeMillis(), emptyList())
      val uri = item.uri
      val representations = if (uri != null) {
        val handle = files.register(uri.toString(), false)
        val metadata = files.metadata(handle)
        listOf(
          BindingClipboardRepresentation.File(
            metadata.mimeType ?: "application/octet-stream",
            handle,
            metadata.displayName,
            metadata.mimeType,
            metadata.sizeBytes
          )
        )
      } else {
        val text = item.coerceToText(context)?.toString().orEmpty()
        listOf(BindingClipboardRepresentation.Inline("text/plain", "text/plain", text.toByteArray()))
      }
      return BindingClipboardSnapshot(System.currentTimeMillis(), representations)
    } catch (_: SecurityException) {
      throw HostBindingException.PermissionDenied()
    }
  }

  override fun clipboardWrite(snapshot: BindingClipboardSnapshot) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
      ?: throw HostBindingException.Unavailable()
    val first = snapshot.representations.firstOrNull()
      ?: return clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
    try {
      val clip = when (first) {
        is BindingClipboardRepresentation.Inline -> {
          if (first.format == "text/plain") {
            ClipData.newPlainText("", first.bytes.toString(Charsets.UTF_8))
          } else {
            val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(first.mimeType)
              ?: "bin"
            val directory = directory(context.cacheDir, "uc-engine-clipboard")
            val file = File(directory, "clipboard-${UUID.randomUUID()}.$extension")
            file.writeBytes(first.bytes)
            val uri = FileProvider.getUriForFile(
              context,
              "${context.packageName}.ucengine.files",
              file
            )
            ClipData.newUri(context.contentResolver, "", uri)
          }
        }
        is BindingClipboardRepresentation.File ->
          ClipData.newUri(context.contentResolver, first.displayName, files.uri(first.handle))
      }
      clipboard.setPrimaryClip(clip)
    } catch (_: SecurityException) {
      throw HostBindingException.PermissionDenied()
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  private fun directory(parent: File, name: String): File =
    File(parent, name).also { if (!it.exists() && !it.mkdirs()) throw HostBindingException.Io() }
}

private class KeystoreSecureStorage(context: Context) {
  private val preferences = context.getSharedPreferences("uc_engine_secure", Context.MODE_PRIVATE)
  private val alias = "${context.packageName}.uc-engine.master"
  private val lock = Any()

  fun get(key: String): ByteArray? = synchronized(lock) {
    val encoded = preferences.getString(storageId(key), null) ?: return@synchronized null
    try {
      val payload = Base64.decode(encoded, Base64.NO_WRAP)
      val ivSize = payload.first().toInt() and 0xff
      val iv = payload.copyOfRange(1, ivSize + 1)
      val ciphertext = payload.copyOfRange(ivSize + 1, payload.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
      cipher.doFinal(ciphertext)
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  fun set(key: String, value: ByteArray) = synchronized(lock) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, secretKey())
      val encrypted = cipher.doFinal(value)
      val payload = ByteBuffer.allocate(1 + cipher.iv.size + encrypted.size)
        .put(cipher.iv.size.toByte())
        .put(cipher.iv)
        .put(encrypted)
        .array()
      val storageId = storageId(key)
      if (!preferences.edit().putString(storageId, Base64.encodeToString(payload, Base64.NO_WRAP)).commit()) {
        throw HostBindingException.Io()
      }
    } catch (error: HostBindingException) {
      throw error
    } catch (_: Exception) {
      throw HostBindingException.Unavailable()
    }
  }

  fun delete(key: String) = synchronized(lock) {
    if (!preferences.edit().remove(storageId(key)).commit()) throw HostBindingException.Io()
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  private fun storageId(key: String): String = Base64.encodeToString(
    MessageDigest.getInstance("SHA-256").digest(key.toByteArray()),
    Base64.NO_WRAP or Base64.URL_SAFE
  )
}

private class FileHandleRegistry(private val context: Context) {
  private data class Entry(val uri: Uri, val writable: Boolean)
  private val entries = ConcurrentHashMap<String, Entry>()

  fun register(value: String, writable: Boolean): String {
    val parsed = Uri.parse(value)
    val uri = if (parsed.scheme == null) Uri.fromFile(File(value)) else parsed
    val handle = UUID.randomUUID().toString()
    entries[handle] = Entry(uri, writable)
    return handle
  }

  fun remove(handle: String) { entries.remove(handle) }
  fun removeAll() { entries.clear() }
  fun uri(handle: String): Uri = entry(handle).uri

  fun metadata(handle: String): BindingFileMetadata {
    val uri = entry(handle).uri
    try {
      var name = uri.lastPathSegment ?: "file"
      var size = -1L
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) {
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let {
              name = cursor.getString(it) ?: name
            }
            cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let {
              size = cursor.getLong(it)
            }
          }
        }
      if (size < 0) size = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: 0
      return BindingFileMetadata(name, size.coerceAtLeast(0).toULong(), context.contentResolver.getType(uri))
    } catch (_: SecurityException) {
      throw HostBindingException.PermissionDenied()
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  fun read(handle: String, offset: Long, maxBytes: Int): ByteArray {
    val uri = entry(handle).uri
    try {
      context.contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
        FileInputStream(descriptor.fileDescriptor).channel.use { channel ->
          channel.position(offset)
          val buffer = ByteBuffer.allocate(maxBytes)
          val count = channel.read(buffer)
          return if (count <= 0) ByteArray(0) else buffer.array().copyOf(count)
        }
      }
      throw HostBindingException.Io()
    } catch (error: HostBindingException) {
      throw error
    } catch (_: SecurityException) {
      throw HostBindingException.PermissionDenied()
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  fun write(handle: String, offset: Long, bytes: ByteArray) {
    val target = entry(handle)
    if (!target.writable) throw HostBindingException.PermissionDenied()
    try {
      context.contentResolver.openFileDescriptor(target.uri, "rw")?.use { descriptor ->
        FileOutputStream(descriptor.fileDescriptor).channel.use { channel ->
          channel.position(offset)
          channel.write(ByteBuffer.wrap(bytes))
          channel.force(true)
          return
        }
      }
      throw HostBindingException.Io()
    } catch (error: HostBindingException) {
      throw error
    } catch (_: SecurityException) {
      throw HostBindingException.PermissionDenied()
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  fun finishWrite(handle: String) {
    if (!entry(handle).writable) throw HostBindingException.PermissionDenied()
  }

  private fun entry(handle: String): Entry = entries[handle] ?: throw HostBindingException.InvalidHandle()
}

private class UcEngineNotStartedException : CodedException("The shared P2P engine has not been started")
private class UcEngineAlreadyStartedException : CodedException("The shared P2P engine is already running")
private class UcEngineUnavailableException : CodedException("The Android application context is unavailable")
