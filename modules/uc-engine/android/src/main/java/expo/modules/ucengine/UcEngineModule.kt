package expo.modules.ucengine

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
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
import java.security.ProviderException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import uniffi.uc_engine_uniffi.BindingClipboardRepresentation
import uniffi.uc_engine_uniffi.BindingClipboardRestoreMode
import uniffi.uc_engine_uniffi.BindingClipboardRestoreOutcome
import uniffi.uc_engine_uniffi.BindingClipboardSnapshot
import uniffi.uc_engine_uniffi.BindingAnalyticsContext
import uniffi.uc_engine_uniffi.BindingAnalyticsDeviceType
import uniffi.uc_engine_uniffi.BindingAnalyticsOs
import uniffi.uc_engine_uniffi.BindingConfig
import uniffi.uc_engine_uniffi.BindingEngineState
import uniffi.uc_engine_uniffi.BindingEvent
import uniffi.uc_engine_uniffi.BindingException
import uniffi.uc_engine_uniffi.BindingFailure
import uniffi.uc_engine_uniffi.BindingFileMetadata
import uniffi.uc_engine_uniffi.BindingHost
import uniffi.uc_engine_uniffi.BindingLifecycleAction
import uniffi.uc_engine_uniffi.EntryNotResendableReason
import uniffi.uc_engine_uniffi.HostBindingException
import uniffi.uc_engine_uniffi.InvitationAvailability
import uniffi.uc_engine_uniffi.LegacyMemberRemovalOutcome
import uniffi.uc_engine_uniffi.LegacyMemberRemovalResult
import uniffi.uc_engine_uniffi.MobileEngine
import uniffi.uc_engine_uniffi.MemberRevocationOutcome
import uniffi.uc_engine_uniffi.MemberRevocationResult
import uniffi.uc_engine_uniffi.ResendEntryOutcome
import uniffi.uc_engine_uniffi.SendReport
import uniffi.uc_engine_uniffi.coreVersion

private fun uriListFile(
  context: Context,
  format: String,
  mimeType: String?,
  bytes: ByteArray
): File? {
  val knownFormat = format.equals("files", ignoreCase = true) ||
    format.equals("public.file-url", ignoreCase = true) ||
    format.equals("NSFilenamesPboardType", ignoreCase = true)
  val knownMime = mimeType.equals("text/uri-list", ignoreCase = true) ||
    mimeType.equals("file/uri-list", ignoreCase = true)
  if (!knownFormat || !knownMime) return null

  val uri = bytes.toString(Charsets.UTF_8)
    .lineSequence()
    .map(String::trim)
    .firstOrNull { it.isNotEmpty() && !it.startsWith('#') }
    ?.let(Uri::parse)
    ?.takeIf { it.scheme.equals("file", ignoreCase = true) }
    ?: return null
  val path = uri.path ?: return null
  val source = File(path).canonicalFile
  val allowedRoots = listOf(context.filesDir.canonicalFile, context.cacheDir.canonicalFile)
  if (allowedRoots.none { source.toPath().startsWith(it.toPath()) }) return null
  return source.takeIf { it.isFile }
}

private fun isPlainTextRepresentation(format: String): Boolean {
  val normalizedFormat = format.substringBefore(';').trim()
  return normalizedFormat.equals("text/plain", ignoreCase = true) ||
    normalizedFormat.equals("public.utf8-plain-text", ignoreCase = true) ||
    normalizedFormat.equals("text", ignoreCase = true)
}

private fun analyticsContext(): BindingAnalyticsContext = BindingAnalyticsContext(
  BindingAnalyticsOs.ANDROID,
  Build.VERSION.RELEASE,
  BindingAnalyticsDeviceType.MOBILE,
  Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown",
  if (BuildConfig.DEBUG) "development" else "production"
)

private fun memberRevocationResultMap(result: MemberRevocationResult): Map<String, Any?> = mapOf(
  "revocationId" to result.revocationId,
  "outcome" to when (result.outcome) {
    MemberRevocationOutcome.LOCAL_ONLY -> "localOnly"
    MemberRevocationOutcome.APPLIED -> "applied"
    MemberRevocationOutcome.COMPLETE -> "complete"
    MemberRevocationOutcome.RECOVERY_REQUIRED -> "recoveryRequired"
  },
  "pendingRecipients" to result.pendingRecipients.toLong(),
  "removedDeviceIds" to result.removedDeviceIds,
  "pendingRecipientDeviceIds" to result.pendingRecipientDeviceIds,
  "updatedAtMs" to result.updatedAtMs
)

private fun legacyMemberRemovalResultMap(result: LegacyMemberRemovalResult): Map<String, Any?> = mapOf(
  "bootstrapId" to result.bootstrapId,
  "outcome" to when (result.outcome) {
    LegacyMemberRemovalOutcome.AWAITING_READMISSION -> "awaitingReadmission"
    LegacyMemberRemovalOutcome.COMPLETE -> "complete"
    LegacyMemberRemovalOutcome.RECOVERY_REQUIRED -> "recoveryRequired"
  },
  "pendingReadmission" to result.pendingReadmission.toLong()
)

private const val CLIPBOARD_SHARE_MAX_ENTRIES = 64
private const val CLIPBOARD_SHARE_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1_000
private const val FILE_DISPLAY_METADATA_FORMAT = "uniclipboard-file-display-metadata"
private const val FILE_DISPLAY_METADATA_MIME =
  "application/x-uniclipboard-file-display-metadata+json"

private fun clipboardDisplayNames(
  representations: List<BindingClipboardRepresentation>
): Map<String, String> = representations.asSequence()
  .filterIsInstance<BindingClipboardRepresentation.Inline>()
  .firstOrNull {
    it.format == FILE_DISPLAY_METADATA_FORMAT || it.mimeType == FILE_DISPLAY_METADATA_MIME
  }
  ?.let { representation ->
    runCatching {
      val files = JSONObject(representation.bytes.toString(Charsets.UTF_8)).getJSONArray("files")
      buildMap {
        for (index in 0 until files.length()) {
          val file = files.getJSONObject(index)
          val storageName = file.optString("storage_name")
          val displayName = file.optString("display_name")
          if (storageName.isNotBlank() && displayName.isNotBlank()) {
            put(storageName, displayName)
          }
        }
      }
    }.getOrDefault(emptyMap())
  }
  .orEmpty()

private fun safeClipboardDisplayName(value: String): String {
  val leaf = value.substringAfterLast('/').substringAfterLast('\\').trim()
  val sanitized = buildString {
    leaf.codePoints().forEach { codePoint ->
      val replacement = codePoint < 0x20 || codePoint == 0x7f
      appendCodePoint(if (replacement) '_'.code else codePoint)
    }
  }
  val candidate = buildString {
    var byteCount = 0
    sanitized.codePoints().forEach { codePoint ->
      val character = String(Character.toChars(codePoint))
      val characterBytes = character.toByteArray(Charsets.UTF_8).size
      if (byteCount + characterBytes <= 240) {
        append(character)
        byteCount += characterBytes
      }
    }
  }.trim()
  return candidate.takeUnless { it.isBlank() || it == "." || it == ".." } ?: "file"
}

internal fun pruneClipboardShareCache(
  root: File,
  nowMs: Long = System.currentTimeMillis(),
  maxEntries: Int = CLIPBOARD_SHARE_MAX_ENTRIES
) {
  val entries = root.listFiles()?.sortedByDescending(File::lastModified).orEmpty()
  entries.forEachIndexed { index, entry ->
    val expired = nowMs - entry.lastModified() > CLIPBOARD_SHARE_MAX_AGE_MS
    if (expired || index >= maxEntries) entry.deleteRecursively()
  }
}

private fun createClipboardShareFile(
  context: Context,
  displayName: String,
  write: (File) -> Unit
): File {
  val root = File(context.cacheDir, "uc-engine-clipboard/shares")
    .also { if (!it.exists() && !it.mkdirs()) throw HostBindingException.Io() }
  pruneClipboardShareCache(root, maxEntries = CLIPBOARD_SHARE_MAX_ENTRIES - 1)
  val directory = File(root, UUID.randomUUID().toString())
    .also { if (!it.mkdirs()) throw HostBindingException.Io() }
  val target = File(directory, safeClipboardDisplayName(displayName))
  try {
    write(target)
    return target
  } catch (error: Exception) {
    directory.deleteRecursively()
    throw error
  }
}

private fun clipboardUri(context: Context, file: File): Uri = FileProvider.getUriForFile(
  context,
  "${context.packageName}.ucengine.files",
  file
)

internal fun clipDataForRepresentation(
  context: Context,
  files: FileHandleRegistry,
  representation: BindingClipboardRepresentation,
  displayNames: Map<String, String> = emptyMap()
): ClipData = when (representation) {
  is BindingClipboardRepresentation.Inline -> {
    val referencedFile = uriListFile(
      context,
      representation.format,
      representation.mimeType,
      representation.bytes
    )
    if (referencedFile != null) {
      val displayName = displayNames[referencedFile.name] ?: referencedFile.name
      val target = createClipboardShareFile(context, displayName) {
        referencedFile.copyTo(it)
      }
      val uri = clipboardUri(context, target)
      ClipData.newUri(context.contentResolver, displayName, uri)
    } else if (isPlainTextRepresentation(representation.format)) {
      ClipData.newPlainText("", representation.bytes.toString(Charsets.UTF_8))
    } else {
      val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(representation.mimeType)
        ?: "bin"
      val file = createClipboardShareFile(context, "clipboard.$extension") {
        it.writeBytes(representation.bytes)
      }
      val uri = clipboardUri(context, file)
      ClipData.newUri(context.contentResolver, "", uri)
    }
  }
  is BindingClipboardRepresentation.File -> {
    val file = createClipboardShareFile(context, representation.displayName) { target ->
      context.contentResolver.openInputStream(files.uri(representation.handle))?.use { input ->
        target.outputStream().use(input::copyTo)
      } ?: throw HostBindingException.Io()
    }
    ClipData.newUri(context.contentResolver, representation.displayName, clipboardUri(context, file))
  }
}

internal fun clipDataForSnapshot(
  context: Context,
  files: FileHandleRegistry,
  representations: List<BindingClipboardRepresentation>
): ClipData {
  val displayNames = clipboardDisplayNames(representations)
  val first = representations.firstOrNull {
    it !is BindingClipboardRepresentation.Inline ||
      (it.format != FILE_DISPLAY_METADATA_FORMAT && it.mimeType != FILE_DISPLAY_METADATA_MIME)
  } ?: return ClipData.newPlainText("", "")
  return clipDataForRepresentation(context, files, first, displayNames)
}

class UcEngineModule : Module() {
  companion object {
    init {
      System.loadLibrary("uc_engine_uniffi")
    }

    @JvmStatic
    private external fun nativeInstallAndroidContext(context: Context): Boolean
  }

  private val lock = Any()
  private val lifecycle = NativeLifecycleHost(::reportLifecycleError)
  private var engine: MobileEngine? = null
  private var files: FileHandleRegistry? = null
  private var analytics: AndroidPostHogAnalyticsHost? = null

  override fun definition() = ModuleDefinition {
    Name("UcEngine")

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { config: Map<String, String> ->
      val context = requireContext()
      check(nativeInstallAndroidContext(context)) { "Failed to initialize the Android P2P runtime" }
      val registry = FileHandleRegistry(context)
      val appVersion = config["appVersion"] ?: "unknown"
      val analytics = analyticsHost(context, appVersion)
      val started = MobileEngine.startWithAnalytics(
        BindingConfig(
          appVersion,
          config["profileId"] ?: "default"
        ),
        AndroidEngineHost(context, registry),
        analytics,
        analyticsContext()
      )
      try {
        lifecycle.prepare(AndroidEngineLifecycle(started))
        refreshAnalyticsContext(started, appVersion)
      } catch (error: Throwable) {
        try {
          started.shutdown(2_000u)
        } catch (shutdownError: Throwable) {
          reportLifecycleError(shutdownError)
        }
        started.close()
        throw error
      }
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
    AsyncFunction("setBackgroundSyncEnabled") { enabled: Boolean, appIsBackground: Boolean ->
      lifecycle.setBackgroundSyncEnabled(
        currentEngine()?.let(::AndroidEngineLifecycle),
        enabled,
        appIsBackground
      )
    }
    AsyncFunction("getAnalyticsConsent") {
      analyticsHost(requireContext()).consentEnabled()
    }
    AsyncFunction("getAnalyticsState") {
      analyticsHost(requireContext()).getAnalyticsState()
    }
    AsyncFunction("setAnalyticsConsent") { enabled: Boolean ->
      analyticsHost(requireContext()).setConsentEnabled(enabled)
    }
    AsyncFunction("resetAnalyticsIdentity") {
      analyticsHost(requireContext()).resetAndIdentify()
    }

    AsyncFunction("createSpace") { deviceName: String?, passphrase: String ->
      val engine = requireEngine()
      val result = engine.createSpace(deviceName, passphrase)
      refreshAnalyticsContext(engine)
      mapOf(
        "spaceId" to result.spaceId,
        "selfDeviceId" to result.selfDeviceId,
        "identityFingerprint" to result.identityFingerprint
      )
    }
    AsyncFunction("issueInvitation") {
      val result = requireEngine().issueInvitation()
      val availability = when (result.availability) {
        InvitationAvailability.CROSS_NETWORK -> "crossNetwork"
        InvitationAvailability.SAME_LOCAL_NETWORK -> "sameLocalNetwork"
      }
      mapOf(
        "invitationCode" to result.invitationCode,
        "expiresAtMs" to result.expiresAtMs,
        "availability" to availability
      )
    }
    AsyncFunction("joinSpace") { invitationCode: String, deviceName: String?, passphrase: String, preserveUnreadableHistory: Boolean ->
      val engine = requireEngine()
      val result = engine.joinSpace(
        invitationCode,
        deviceName,
        passphrase,
        preserveUnreadableHistory
      )
      refreshAnalyticsContext(engine)
      mapOf(
        "sponsorDeviceId" to result.sponsorDeviceId,
        "sponsorIdentityFingerprint" to result.sponsorIdentityFingerprint,
        "spaceId" to result.spaceId,
        "selfDeviceId" to result.selfDeviceId,
        "selfIdentityFingerprint" to result.selfIdentityFingerprint,
        "migratedRecords" to (result.migratedRecords?.toLong() ?: 0L),
        "preservedUnreadableRecords" to (result.preservedUnreadableRecords?.toLong() ?: 0L)
      )
    }
    AsyncFunction("nextEvent") { timeoutMs: Long ->
      requireEngine().nextEvent(timeoutMs.toULong())?.let(::eventMap)
    }.runOnQueue(appContext.backgroundCoroutineScope)
    AsyncFunction("refreshPeerConnections") {
      val result = requireEngine().refreshPeerConnections()
      mapOf(
        "total" to result.total.toLong(),
        "online" to result.online.toLong(),
        "offline" to result.offline.toLong(),
        "errors" to result.errors.toLong()
      )
    }
    AsyncFunction("querySpaceState") {
      val result = runSpaceRead("querySpaceState") { requireEngine().querySpaceState() }
      Log.i(
        "UcEngine",
        "space_read operation=querySpaceState outcome=success hasCompleted=${result.hasCompleted} hasSpace=${result.spaceId != null} hasInvitation=${result.currentInvitation != null}"
      )
      mapOf(
        "hasCompleted" to result.hasCompleted,
        "spaceId" to result.spaceId,
        "currentInvitation" to result.currentInvitation?.let {
          mapOf("invitationCode" to it.invitationCode, "expiresAtMs" to it.expiresAtMs)
        },
        "deviceName" to result.deviceName
      )
    }
    AsyncFunction("listDevices") {
      val engine = requireEngine()
      val devices = runSpaceRead("listDevices") {
        refreshAnalyticsContext(engine)
        val localDeviceId = engine.queryLocalDevice().deviceId
        engine.listDevices().map {
          mapOf(
            "deviceId" to it.deviceId,
            "displayName" to it.displayName,
            "isLocal" to (it.deviceId == localDeviceId),
            "online" to it.online
          )
        }
      }
      Log.i("UcEngine", "space_read operation=listDevices outcome=success deviceCount=${devices.size}")
      devices
    }
    AsyncFunction("removeMember") { deviceId: String ->
      val engine = requireEngine()
      val result = engine.removeMember(deviceId)
      refreshAnalyticsContext(engine)
      memberRevocationResultMap(result)
    }
    AsyncFunction("queryCurrentMemberRevocation") {
      val result = runSpaceRead("queryCurrentMemberRevocation") {
        requireEngine().queryCurrentMemberRevocation()
      }
      Log.i(
        "UcEngine",
        "space_read operation=queryCurrentMemberRevocation outcome=success hasRevocation=${result != null}"
      )
      result?.let(::memberRevocationResultMap)
    }
    AsyncFunction("continueMemberRevocation") {
      revocationId: String,
      permanentlyLostDeviceIds: List<String> ->
      val engine = requireEngine()
      val result = engine.continueMemberRevocation(revocationId, permanentlyLostDeviceIds)
      refreshAnalyticsContext(engine)
      memberRevocationResultMap(result)
    }
    AsyncFunction("secureRemoveLegacyMember") { deviceId: String ->
      val engine = requireEngine()
      val result = engine.secureRemoveLegacyMember(deviceId)
      refreshAnalyticsContext(engine)
      legacyMemberRemovalResultMap(result)
    }
    AsyncFunction("resendEntry") { entryId: String, targetDevices: List<String> ->
      resendOutcomeMap(requireEngine().resendEntry(entryId, targetDevices))
    }
    AsyncFunction("leaveSpace") {
      val engine = requireEngine()
      engine.leaveSpace()
      refreshAnalyticsContext(engine)
    }
    AsyncFunction("sendText") { text: String, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendText(text, targetDevices))
    }
    AsyncFunction("sendImage") { bytes: ByteArray, mimeType: String, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendImage(bytes, mimeType, targetDevices))
    }
    Function("registerInputFile") { uri: String, displayName: String? ->
      requireFiles().register(uri, false, displayName)
    }
    Function("registerOutputFile") { uri: String -> requireFiles().register(uri, true) }
    Function("releaseFileHandle") { handle: String -> requireFiles().remove(handle) }
    AsyncFunction("sendFiles") { fileHandles: List<String>, targetDevices: List<String> ->
      sendReportMap(requireEngine().sendFiles(fileHandles, targetDevices))
    }
    AsyncFunction("captureCurrentClipboard") { requireEngine().captureCurrentClipboard() }
    AsyncFunction("observeClipboardChange") { dispatch: Boolean ->
      requireEngine().observeClipboardChange(dispatch)?.let(::sendReportMap)
    }
    AsyncFunction("observeClipboardTextChange") { text: String, dispatch: Boolean ->
      if (dispatch) {
        sendReportMap(requireEngine().sendText(text, emptyList()))
      } else {
        requireEngine().observeClipboardChange(false)?.let(::sendReportMap)
      }
    }
    AsyncFunction("restoreClipboard") { entryId: String, mode: String ->
      restoreOutcome(requireEngine().restoreClipboard(entryId, restoreMode(mode)))
    }
    AsyncFunction("exportEntry") { entryId: String, destinationHandle: String ->
      requireEngine().exportEntry(entryId, destinationHandle)
    }

    OnActivityEntersBackground {
      lifecycle.enterBackground(currentEngine()?.let(::AndroidEngineLifecycle))
    }
    OnActivityEntersForeground {
      lifecycle.enterForeground(currentEngine()?.let(::AndroidEngineLifecycle))
    }
    OnDestroy {
      try {
        shutdown(2_000)
      } catch (error: Throwable) {
        reportLifecycleError(error)
      }
    }
  }

  private fun analyticsHost(context: Context, appVersion: String? = null): AndroidPostHogAnalyticsHost =
    synchronized(lock) {
      analytics?.also { host -> appVersion?.let { host.updateApplicationContext(it, 0) } }
        ?: AndroidPostHogAnalyticsHost(context, appVersion ?: applicationVersion())
          .also { analytics = it }
    }

  private fun refreshAnalyticsContext(engine: MobileEngine, appVersion: String? = null) {
    val count = runCatching { engine.listDevices().size }.getOrDefault(0)
    analytics?.updateApplicationContext(appVersion ?: applicationVersion(), count)
    val spaceId = runCatching { engine.querySpaceState().spaceId }.getOrNull()
    analytics?.ensureSpaceContext(spaceId, count)
  }

  private fun applicationVersion(): String = runCatching {
    val context = requireContext()
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
  }.getOrDefault("unknown")

  private fun requireContext(): Context =
    appContext.reactContext?.applicationContext ?: throw UcEngineUnavailableException()

  private fun currentEngine(): MobileEngine? = synchronized(lock) { engine }

  private fun requireEngine(): MobileEngine = currentEngine() ?: throw UcEngineNotStartedException()

  private fun requireFiles(): FileHandleRegistry =
    synchronized(lock) { files } ?: throw UcEngineNotStartedException()

  private fun <T> runSpaceRead(operation: String, read: () -> T): T = try {
    read()
  } catch (error: Throwable) {
    reportSpaceReadError(operation, error)
    throw error
  }

  private fun reportSpaceReadError(operation: String, error: Throwable) {
    when (error) {
      is BindingException.Engine -> Log.e(
        "UcEngine",
        "space_read operation=$operation outcome=failure errorKind=engine errorCode=${error.code} errorCategory=${error.category} retryable=${error.retryable}"
      )
      else -> Log.e(
        "UcEngine",
        "space_read operation=$operation outcome=failure errorKind=${error.javaClass.simpleName}"
      )
    }
  }

  private fun reportLifecycleError(error: Throwable) {
    Log.e("UcEngine", "P2P engine lifecycle transition failed", error)
  }

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

  private fun resendOutcomeMap(outcome: ResendEntryOutcome): Map<String, Any> = when (outcome) {
    is ResendEntryOutcome.Completed -> mapOf(
      "kind" to "completed",
      "accepted" to outcome.accepted.toLong(),
      "duplicate" to outcome.duplicate.toLong(),
      "offline" to outcome.offline.toLong(),
      "errored" to outcome.errored.toLong(),
      "pending" to outcome.pending.toLong()
    )
    is ResendEntryOutcome.EntryNotFound ->
      mapOf("kind" to "entryNotFound", "entryId" to outcome.entryId)
    is ResendEntryOutcome.EntryNotResendable -> mapOf(
      "kind" to "entryNotResendable",
      "entryId" to outcome.entryId,
      "reason" to when (outcome.reason) {
        EntryNotResendableReason.REMOTE_ORIGIN -> "remoteOrigin"
        EntryNotResendableReason.PAYLOAD_LOST -> "payloadLost"
      }
    )
    is ResendEntryOutcome.TargetNotTrusted ->
      mapOf("kind" to "targetNotTrusted", "deviceId" to outcome.deviceId)
    ResendEntryOutcome.NoEligibleTargets -> mapOf("kind" to "noEligibleTargets")
  }

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
    is BindingEvent.LifecycleFailed -> mapOf(
      "type" to "lifecycleFailed",
      "action" to lifecycleActionName(event.action),
      "failure" to failureMap(event.failure)
    )
    is BindingEvent.RefreshRequired -> mapOf(
      "type" to "refreshRequired",
      "reason" to event.reason.name
    )
    is BindingEvent.Fatal -> mapOf("type" to "fatal", "failure" to failureMap(event.failure))
    is BindingEvent.IncomingEntry -> mapOf(
      "type" to "incomingEntry",
      "entryId" to event.entryId,
      "attemptId" to event.attemptId,
      "preview" to event.preview,
      "origin" to event.origin.name.lowercase()
    )
    is BindingEvent.IncomingPending -> mapOf(
      "type" to "incomingPending",
      "entryId" to event.entryId,
      "attemptId" to event.attemptId,
      "fromDevice" to event.fromDevice,
      "totalBytes" to event.totalBytes?.toLong(),
      "filenames" to event.filenames
    )
    is BindingEvent.ReceiveAttemptStateChanged -> mapOf(
      "type" to "receiveAttemptStateChanged",
      "entryId" to event.entryId,
      "attemptId" to event.attemptId,
      "state" to event.state
    )
    is BindingEvent.DeliveryStatusChanged -> mapOf(
      "type" to "deliveryStatusChanged",
      "entryId" to event.entryId,
      "targetDeviceId" to event.targetDeviceId
    )
    is BindingEvent.PeerPresenceChanged -> mapOf(
      "type" to "peerPresenceChanged",
      "deviceId" to event.deviceId,
      "state" to event.state,
      "atMs" to event.atMs
    )
    is BindingEvent.TransferProgress -> mapOf(
      "type" to "transferProgress",
      "transferId" to event.transferId,
      "entryId" to event.entryId,
      "attemptId" to event.attemptId,
      "peerId" to event.peerId,
      "direction" to event.direction.name.lowercase(),
      "completedBytes" to event.completedBytes.toLong(),
      "totalBytes" to event.totalBytes?.toLong()
    )
    is BindingEvent.TransferStatusChanged -> mapOf(
      "type" to "transferStatusChanged",
      "transferId" to event.transferId,
      "entryId" to event.entryId,
      "attemptId" to event.attemptId,
      "status" to event.status,
      "reason" to event.reason
    )
    is BindingEvent.ActiveClipboardChanged -> mapOf(
      "type" to "activeClipboardChanged",
      "snapshotHash" to event.snapshotHash,
      "entryId" to event.entryId,
      "activatedAtMs" to event.activatedAtMs,
      "activatedBy" to event.activatedBy
    )
    is BindingEvent.MemberRevocationChanged -> mapOf(
      "type" to "memberRevocationChanged",
      "revocation" to memberRevocationResultMap(event.revocation)
    )
    is BindingEvent.NetworkRecoveryChanged -> mapOf(
      "type" to "networkRecoveryChanged",
      "phase" to event.phase,
      "retryable" to event.retryable,
      "nextRetryInMs" to event.nextRetryInMs?.toLong()
    )
    is BindingEvent.Changed -> mapOf("type" to "changed", "kind" to event.kind)
  }

  private fun lifecycleActionName(action: BindingLifecycleAction): String = when (action) {
    BindingLifecycleAction.SUSPEND -> "suspend"
    BindingLifecycleAction.RESUME -> "resume"
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

private class AndroidEngineLifecycle(private val engine: MobileEngine) : EngineLifecycle {
  override fun recoverSession(): EngineSessionRecovery {
    val recovery = engine.recoverSession(true)
    return EngineSessionRecovery(recovery.unlocked, recovery.resumed)
  }

  override fun lifecycleState(): EngineLifecycleState = when (engine.lifecycleState()) {
    BindingEngineState.RUNNING -> EngineLifecycleState.RUNNING
    BindingEngineState.QUIESCING -> EngineLifecycleState.QUIESCING
    BindingEngineState.QUIESCED -> EngineLifecycleState.QUIESCED
    BindingEngineState.SUSPENDED -> EngineLifecycleState.SUSPENDED
    BindingEngineState.SHUTTING_DOWN -> EngineLifecycleState.SHUTTING_DOWN
    BindingEngineState.STOPPED -> EngineLifecycleState.STOPPED
  }

  override fun suspend() = engine.suspend()

  override fun resume() = engine.resume()
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
    try {
      val clip = clipDataForSnapshot(context, files, snapshot.representations)
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

internal fun interface SecretKeyProvider {
  fun get(): SecretKey
}

private class AndroidKeyStoreSecretKeyProvider(private val alias: String) : SecretKeyProvider {
  override fun get(): SecretKey {
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
}

internal class KeystoreSecureStorage(
  context: Context,
  private val secretKeyProvider: SecretKeyProvider = AndroidKeyStoreSecretKeyProvider(
    "${context.packageName}.uc-engine.master"
  )
) {
  private val preferences = context.getSharedPreferences("uc_engine_secure", Context.MODE_PRIVATE)
  private val lock = Any()

  fun get(key: String): ByteArray? = synchronized(lock) {
    val encoded = preferences.getString(storageId(key), null) ?: return@synchronized null
    try {
      val payload = Base64.decode(encoded, Base64.NO_WRAP)
      val ivSize = payload.first().toInt() and 0xff
      val iv = payload.copyOfRange(1, ivSize + 1)
      val ciphertext = payload.copyOfRange(ivSize + 1, payload.size)
      val secretKey = try {
        secretKeyProvider.get()
      } catch (_: Exception) {
        throw HostBindingException.Unavailable()
      }
      val cipher = try {
        Cipher.getInstance("AES/GCM/NoPadding").also {
          it.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        }
      } catch (_: KeyPermanentlyInvalidatedException) {
        throw HostBindingException.Unavailable()
      } catch (_: ProviderException) {
        throw HostBindingException.Unavailable()
      } catch (_: Exception) {
        throw HostBindingException.Io()
      }
      try {
        cipher.doFinal(ciphertext)
      } catch (_: Exception) {
        throw HostBindingException.Io()
      }
    } catch (error: HostBindingException) {
      throw error
    } catch (_: Exception) {
      throw HostBindingException.Io()
    }
  }

  fun set(key: String, value: ByteArray) = synchronized(lock) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, secretKeyProvider.get())
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

  private fun storageId(key: String): String = Base64.encodeToString(
    MessageDigest.getInstance("SHA-256").digest(key.toByteArray()),
    Base64.NO_WRAP or Base64.URL_SAFE
  )
}

internal class FileHandleRegistry(private val context: Context) {
  private data class Entry(val uri: Uri, val writable: Boolean, val displayName: String?)
  private val entries = ConcurrentHashMap<String, Entry>()

  fun register(value: String, writable: Boolean, displayName: String? = null): String {
    val parsed = Uri.parse(value)
    val uri = if (parsed.scheme == null) Uri.fromFile(File(value)) else parsed
    val handle = UUID.randomUUID().toString()
    entries[handle] = Entry(uri, writable, displayName)
    return handle
  }

  fun remove(handle: String) { entries.remove(handle) }
  fun removeAll() { entries.clear() }
  fun uri(handle: String): Uri = entry(handle).uri

  fun metadata(handle: String): BindingFileMetadata {
    val target = entry(handle)
    val uri = target.uri
    try {
      var name = target.displayName ?: uri.lastPathSegment ?: "file"
      var size = -1L
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        ?.use { cursor ->
          if (cursor.moveToFirst()) {
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
              .takeIf { target.displayName == null && it >= 0 }?.let {
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
