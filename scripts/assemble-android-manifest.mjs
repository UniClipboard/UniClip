#!/usr/bin/env node
/**
 * assemble-android-manifest — build the R2 update manifest(s) the Android
 * companion app polls to discover new releases.
 *
 * The desktop workspace ships a single Cloudflare R2 bucket
 * (`uniclipboard-releases`) fronted by the update-server Worker at
 * `https://release.uniclipboard.app`. Android reuses the same bucket under an
 * `android/` prefix: APKs land in `android/artifacts/<tag>/`, and the app reads
 * `android/{stable,beta}.json`. This script produces those channel manifests
 * from the freshly built APKs plus the versioned changelog files that
 * `release-notes.mjs` already emits.
 *
 * ## Two version strings, on purpose
 *
 * The APK filenames use the 3-segment marketing version (`expo.version`, e.g.
 * `1.3.0`) — `UniClip-<marketing>-<abi>.apk` — because android-build.yml names
 * them from `expo.version`. But the app compares the 4-segment Android
 * `versionName` (`<marketing>.<versionCode>`, e.g. `1.3.0.164`, which is also
 * the release tag minus its leading `v`). So the manifest `version` field is
 * the 4-segment tag version, while `assets[].name` keeps the 3-segment
 * filename. See plugins/withAndroidBuildVersionName.ts for why the two differ.
 *
 * Channel promotion mirrors the desktop model:
 *   - stable release  → newest stable AND newest overall → write BOTH manifests
 *   - prerelease/beta → newest overall only              → write beta.json only
 *
 * Manifest shape (must stay in sync with UpdateService.ts / worker types.ts):
 *   {
 *     "version": "1.3.0.164",
 *     "tagName": "v1.3.0.164",
 *     "prerelease": false,
 *     "pub_date": "2026-07-18T10:00:00.000Z",
 *     "notes": { "en": "...", "zh": "..." },
 *     "assets": [ { "name": "UniClip-1.3.0-arm64-v8a.apk", "sha256": "hex" }, ... ]
 *   }
 *
 * Usage:
 *   node scripts/assemble-android-manifest.mjs \
 *     --tag v1.3.0.164 \
 *     --marketing-version 1.3.0 \
 *     --prerelease false \
 *     --apk-dir apk \
 *     --out-dir manifests
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The per-ABI APKs android-build.yml renames to `UniClip-<marketing>-<abi>.apk`.
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'universal'];

function fail(message) {
  console.error(`assemble-android-manifest failed: ${message}`);
  process.exit(1);
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readNotes(changelogDir, tag, lang) {
  const path = resolve(changelogDir, `${tag}.android.${lang}.md`);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim();
}

const tag = argValue('--tag');
const marketingVersion = argValue('--marketing-version');
const prerelease = argValue('--prerelease', 'false') === 'true';
const apkDir = resolve(argValue('--apk-dir', 'apk'));
const changelogDir = resolve(argValue('--changelog-dir', 'changelogs'));
const outDir = resolve(argValue('--out-dir', 'manifests'));
const pubDate = argValue('--pub-date', new Date().toISOString());

if (!tag) fail('--tag is required (e.g. v1.3.0.164)');
if (!marketingVersion) fail('--marketing-version is required (e.g. 1.3.0)');

// The compared version: 4-segment tag without its leading `v`.
const version = tag.replace(/^v/, '');

const assets = [];
for (const abi of ABIS) {
  const name = `UniClip-${marketingVersion}-${abi}.apk`;
  const filePath = resolve(apkDir, name);
  if (!existsSync(filePath)) {
    console.warn(`  skip missing APK: ${name}`);
    continue;
  }
  assets.push({ name, sha256: sha256(filePath) });
  console.error(`  [${abi}] ${name} -> ${assets[assets.length - 1].sha256}`);
}

if (assets.length === 0) {
  fail(`no APKs found in ${apkDir} for marketing version ${marketingVersion}`);
}

const manifest = {
  version,
  tagName: tag,
  prerelease,
  pub_date: pubDate,
  notes: {
    en: readNotes(changelogDir, tag, 'en'),
    zh: readNotes(changelogDir, tag, 'zh'),
  },
  assets,
};

// A stable release advances both channels; a prerelease only advances beta.
const channels = prerelease ? ['beta'] : ['stable', 'beta'];

mkdirSync(outDir, { recursive: true });
for (const channel of channels) {
  const outPath = resolve(outDir, `${channel}.json`);
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.error(`wrote ${channel} manifest -> ${outPath}`);
}

console.error('Assembled manifest:');
console.error(JSON.stringify(manifest, null, 2));
