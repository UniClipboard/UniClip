'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LAUNCH = `        // Android chooser results are not reliable on every device. Completion
        // means the chooser was launched, not that the recipient consumed the file.
        appContext.throwingActivity.startActivity(intent)
        promise.resolve(null)`;

function patchSharingModule(source) {
  if (source.includes(LAUNCH) && !source.includes('pendingPromise')) return source;

  const replacements = [
    ['  private var pendingPromise: Promise? = null\n', ''],
    [`      if (pendingPromise != null) {
        throw SharingInProgressException()
      }
`, ''],
    [`        pendingPromise = promise
        appContext.throwingActivity.startActivityForResult(intent, REQUEST_CODE)`, LAUNCH],
    [`
    OnActivityResult { _, (requestCode) ->
      if (requestCode == REQUEST_CODE && pendingPromise != null) {
        pendingPromise?.resolve(null)
        pendingPromise = null
      }
    }
`, ''],
    [`
  companion object {
    private const val REQUEST_CODE = 8524
  }
`, ''],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) {
      throw new Error('Unsupported expo-sharing SharingModule.kt: Android chooser patch needs review');
    }
    source = source.replace(before, after);
  }
  return source;
}

if (require.main === module) {
  const sourcePath = path.resolve(__dirname,
    '../node_modules/expo-sharing/android/src/main/java/expo/modules/sharing/SharingModule.kt');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchSharingModule(source);
  if (source !== patched) fs.writeFileSync(sourcePath, patched);
  const parserDir = path.join(path.dirname(sourcePath), 'dataParsers');
  const simpleParserPath = path.join(parserDir, 'SimpleShareIntentDataParser.kt');
  const simpleParser = fs.readFileSync(simpleParserPath, 'utf8');
  const patchedSimpleParser = patchSimpleShareParser(simpleParser);
  if (simpleParser !== patchedSimpleParser) fs.writeFileSync(simpleParserPath, patchedSimpleParser);
  const parserPath = path.join(parserDir, 'ResolvingShareIntentDataParser.kt');
  const parser = fs.readFileSync(parserPath, 'utf8');
  const patchedParser = patchShareParser(parser);
  if (parser !== patchedParser) fs.writeFileSync(parserPath, patchedParser);
  console.log('[Android sharing] Chooser and incoming share patches applied');
}

function patchShareParser(source) {
  const sendBefore = `    private fun handleSendAction(context: Context, intent: Intent, type: String): List<ResolvedSharePayload> {
      return if (type == "text/plain") {
        extractTextPayload(intent)
      } else {
        val uri = intent.getParcelableExtraCompat<Uri>(Intent.EXTRA_STREAM)
        listOfNotNull(uri?.let { resolveUri(context, it, type) })
      }
    }`;
  const sendAfter = `    private fun handleSendAction(context: Context, intent: Intent, type: String): List<ResolvedSharePayload> {
      val uri = intent.getParcelableExtraCompat<Uri>(Intent.EXTRA_STREAM)
      return if (uri != null) {
        listOf(resolveUri(context, uri, type))
      } else if (type == "text/plain") {
        extractTextPayload(intent)
      } else {
        emptyList()
      }
    }`;
  if (!source.includes(sendAfter)) {
    if (source.split(sendBefore).length !== 2) {
      throw new Error('Unsupported expo-sharing resolving parser: ACTION_SEND patch needs review');
    }
    source = source.replace(sendBefore, sendAfter);
  }

  const before = `      // Copy to cache dir to ensure access
      val file = File(context.cacheDir, fileName)
      try {
        contentResolver.openInputStream(uri)?.use { input ->
          FileOutputStream(file).use { output ->
            input.copyTo(output)
          }
        }
      } catch (e: Exception) {
        e.printStackTrace()
      }`;
  const after = `      // A self-share can already live in cacheDir under fileName. Never
      // open that source as the output, or FileOutputStream truncates it.
      val file = File.createTempFile("expo-sharing-", null, context.cacheDir)
      try {
        val input = contentResolver.openInputStream(uri)
          ?: throw java.io.IOException("Unable to open shared file")
        input.use {
          FileOutputStream(file).use { output ->
            it.copyTo(output)
          }
        }
      } catch (e: Exception) {
        file.delete()
        throw FailedToResolveSharedDataException("Failed to copy shared file: \${e.message}", e)
      }`;
  if (!source.includes(after) || !source.includes('contentSize = file.length()')) {
    if (source.split(before).length !== 2 || source.split('contentSize = fileSize').length !== 2) {
      throw new Error('Unsupported expo-sharing resolving parser: incoming file patch needs review');
    }
    source = source.replace(before, after)
      .replace('      val fileSize = getFileSize(contentResolver, uri)\n', '')
      .replace('contentSize = fileSize', 'contentSize = file.length()');
  }
  return source;
}

function patchSimpleShareParser(source) {
  const before = `    private fun handleSendAction(context: Context, intent: Intent, type: String): List<SharePayload> {
      return if (type == "text/plain") {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return emptyList()
        val isUrl = android.util.Patterns.WEB_URL.matcher(text).matches()

        listOf(
          SharePayload().apply {
            value = text
            shareType = if (isUrl) ShareType.Url else ShareType.Text
            mimeType = "text/plain"
          }
        )
      } else {
        val uri = intent.getParcelableExtraCompat<Uri>(Intent.EXTRA_STREAM)
        listOfNotNull(uri?.let { createUriPayload(context, it, type) })
      }
    }`;
  const after = `    private fun handleSendAction(context: Context, intent: Intent, type: String): List<SharePayload> {
      val uri = intent.getParcelableExtraCompat<Uri>(Intent.EXTRA_STREAM)
      return if (uri != null) {
        listOf(createUriPayload(context, uri, type))
      } else if (type == "text/plain") {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return emptyList()
        val isUrl = android.util.Patterns.WEB_URL.matcher(text).matches()

        listOf(
          SharePayload().apply {
            value = text
            shareType = if (isUrl) ShareType.Url else ShareType.Text
            mimeType = "text/plain"
          }
        )
      } else {
        emptyList()
      }
    }`;
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) {
    throw new Error('Unsupported expo-sharing simple parser: ACTION_SEND patch needs review');
  }
  return source.replace(before, after);
}

module.exports = { patchSharingModule, patchShareParser, patchSimpleShareParser };
