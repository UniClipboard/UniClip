'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  patchSharingModule,
  patchShareParser,
  patchSimpleShareParser,
} = require('../patch-expo-sharing-android.cjs');

const source = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/expo-sharing-57.0.19/SharingModule.kt'),
  'utf8'
);

test('Android builds the patched sharing source rather than the precompiled library', () => {
  const pkg = require('../../package.json');
  assert.ok(pkg.expo?.autolinking?.android?.buildFromSource?.includes('expo-sharing'));
});

test('sharing does not stay occupied when Android omits the chooser result', () => {
  const patched = patchSharingModule(source);
  assert.doesNotMatch(patched, /pendingPromise|startActivityForResult|OnActivityResult/);
  assert.match(patched, /startActivity\(intent\)\s+promise.resolve\(null\)/);
});

test('launch errors still reject, and file permissions and incoming sharing are preserved', () => {
  const patched = patchSharingModule(source);
  assert.match(patched, /catch \(e: Exception\) \{\s+throw SharingFailedException/);
  assert.match(patched, /FileProvider.getUriForFile/);
  assert.match(patched, /grantUriPermission\(packageName, contentUri, Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/);
  assert.match(patched, /addFlags\(Intent.FLAG_GRANT_READ_URI_PERMISSION\)/);
  assert.match(patched, /Function\("getSharedPayloads"\)/);
  assert.match(patched, /AsyncFunction\("getResolvedSharedPayloadsAsync"\)/);
});

test('reinstalling is idempotent and unsupported upstream source fails explicitly', () => {
  const patched = patchSharingModule(source);
  assert.equal(patchSharingModule(patched), patched);
  assert.throws(() => patchSharingModule('class SharingModule {}'), /Unsupported/);
});

test('receiving an app-owned file cannot truncate the source or another same-name attachment', () => {
  const parser = fs.readFileSync(path.resolve(__dirname,
    'fixtures/expo-sharing-57.0.19/ResolvingShareIntentDataParser.kt'), 'utf8');
  const patched = patchShareParser(parser);
  assert.doesNotMatch(patched, /File\(context.cacheDir, fileName\)/);
  assert.match(patched, /File.createTempFile\("expo-sharing-", null, context.cacheDir\)/);
  assert.match(patched, /originalName = fileName/);
  assert.match(patched, /contentSize = file.length\(\)/);
  assert.match(patched, /file.delete\(\)\s+throw FailedToResolveSharedDataException/);
  assert.equal(patchShareParser(patched), patched);
  assert.throws(() => patchShareParser('unsupported'), /Unsupported/);
});

test('simple parser prefers an ACTION_SEND stream over text/plain EXTRA_TEXT', () => {
  const parser = fs.readFileSync(path.resolve(__dirname,
    'fixtures/expo-sharing-57.0.19/SimpleShareIntentDataParser.kt'), 'utf8');
  const patched = patchSimpleShareParser(parser);
  assert.match(patched, /val uri = intent\.getParcelableExtraCompat<Uri>\(Intent\.EXTRA_STREAM\)[\s\S]*if \(uri != null\)[\s\S]*createUriPayload\(context, uri, type\)[\s\S]*else if \(type == "text\/plain"\)/);
  assert.match(patched, /getStringExtra\(Intent\.EXTRA_TEXT\)/);
  assert.match(patched, /ShareType\.Url else ShareType\.Text/);
  assert.match(patched, /ACTION_SEND_MULTIPLE[\s\S]*handleSendMultipleAction/);
  assert.equal(patchSimpleShareParser(patched), patched);
  assert.throws(() => patchSimpleShareParser('unsupported'), /Unsupported/);
});

test('resolving parser prefers an ACTION_SEND stream over text/plain EXTRA_TEXT', () => {
  const parser = fs.readFileSync(path.resolve(__dirname,
    'fixtures/expo-sharing-57.0.19/ResolvingShareIntentDataParser.kt'), 'utf8');
  const patched = patchShareParser(parser);
  assert.match(patched, /val uri = intent\.getParcelableExtraCompat<Uri>\(Intent\.EXTRA_STREAM\)[\s\S]*if \(uri != null\)[\s\S]*resolveUri\(context, uri, type\)[\s\S]*else if \(type == "text\/plain"\)/);
  assert.match(patched, /extractTextPayload\(intent\)/);
  assert.match(patched, /resolveUrlContext\(text\)/);
  assert.match(patched, /ACTION_SEND_MULTIPLE[\s\S]*handleSendMultipleAction/);
});
