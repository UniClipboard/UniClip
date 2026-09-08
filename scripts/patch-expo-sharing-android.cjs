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
  const parserPath = path.join(path.dirname(sourcePath),
    'dataParsers/ResolvingShareIntentDataParser.kt');
  const parser = fs.readFileSync(parserPath, 'utf8');
  const patchedParser = patchShareParser(parser);
  if (parser !== patchedParser) fs.writeFileSync(parserPath, patchedParser);
  console.log('[Android sharing] Chooser completion patch applied');
}

function patchShareParser(source) {
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
  if (source.includes(after) && source.includes('contentSize = file.length()')) return source;
  if (source.split(before).length !== 2 || source.split('contentSize = fileSize').length !== 2) {
    throw new Error('Unsupported expo-sharing share parser: incoming file patch needs review');
  }
  source = source.replace(before, after)
    .replace('      val fileSize = getFileSize(contentResolver, uri)\n', '')
    .replace('contentSize = fileSize', 'contentSize = file.length()');
  return source;
}

module.exports = { patchSharingModule, patchShareParser };
